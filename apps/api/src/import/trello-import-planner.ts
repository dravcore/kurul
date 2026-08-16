import { uuidv7 } from 'uuidv7';
import {
  AttachmentKind,
  ColumnCategory,
  TrelloImportScope,
  TrelloImportSkipReason,
} from '@kurul/shared-types';
import type { LabelColorSlot, TrelloImportSkipGroupDto } from '@kurul/shared-types';
import { POSITION_GAP, rebalancePositions } from '../common/position/fractional-index';
import { SkipCollector } from './import-skip';
import type {
  TrelloCard,
  TrelloChecklist,
  TrelloExportReadResult,
  TrelloList,
} from './trello-export';
import { trelloColorToSlot } from './trello-label-color';

/** Who ran the import. Every row written records them (ADR 0025 — accountability, not mapping). */
export interface TrelloImportContext {
  actorId: string;
}

/**
 * Every row an import will write, plus the report of everything it will not.
 *
 * Flat arrays of plain objects rather than a nested graph, because the writer's job is a
 * sequence of `createMany` calls and the order of those calls is a foreign-key constraint
 * (`Task.column` is composite on `(boardId, columnId)`), not a preference.
 */
export interface TrelloImportPlan {
  board: { id: string; name: string; description: string | null };
  columns: Array<{
    id: string;
    boardId: string;
    name: string;
    position: number;
    category: ColumnCategory;
  }>;
  labels: Array<{ id: string; boardId: string; name: string; color: LabelColorSlot }>;
  tasks: Array<{
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    description: string | null;
    position: number;
    dueDate: Date | null;
    createdById: string;
  }>;
  taskLabels: Array<{ id: string; taskId: string; labelId: string }>;
  checklists: Array<{ id: string; taskId: string; title: string; position: number }>;
  checklistItems: Array<{
    id: string;
    checklistId: string;
    content: string;
    isDone: boolean;
    position: number;
  }>;
  attachments: Array<{
    id: string;
    taskId: string;
    uploadedById: string;
    kind: AttachmentKind;
    filename: string;
    url: string;
    storageKey: null;
    mimeType: null;
    size: null;
  }>;
  skipped: TrelloImportSkipGroupDto[];
}

/** A board Trello left unnamed still needs something in `Board.name`, which is not nullable. */
const BOARD_NAME_FALLBACK = 'Imported board';

/** ADR 0025: an unnamed, uncoloured label has nothing left to be named after. */
const LABEL_NAME_FALLBACK = 'Label';

/** The same two schemes `AttachmentService.requireStorableUrl` accepts (ADR 0024, K1). */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);

/**
 * Trello's ordering, re-expressed in this repository's positions (ADR 0025).
 *
 * `pos` is read and then thrown away. Trello writes large floats (`65535`, `131071`), sometimes
 * repeats them, and on some exports writes the string `"bottom"` — which reaches here as `null`,
 * the reader having already decided that a non-numeric `pos` is not a surprise worth reporting.
 * Carrying those numbers into `Column.position` / `Task.position` would seed a brand-new board
 * with whatever gap pattern the old one had drifted into, including gaps already narrowed towards
 * `MIN_GAP` (`fractional-index.ts:2`). Re-issuing costs nothing and starts clean.
 *
 * Ties, and entries with no usable `pos` at all, fall back to the Trello id, whose leading eight
 * hex digits are a creation timestamp — so the fallback is "the order they were made", not a coin
 * flip. Entries with no `pos` sort *after* every entry that has one: a missing sort key is an
 * absence of information, and inventing a place for it among the ordered ones would be a guess.
 *
 * The comparator is total on `(pos, id)` and Trello ids are unique within an export, so this does
 * not lean on `Array.prototype.sort` being stable — two runs over the same export produce the
 * same board, which is what the idempotency of the *plan* rests on.
 */
function orderedByPos<T extends { id: string; pos: number | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.pos !== null && b.pos !== null) {
      if (a.pos !== b.pos) return a.pos - b.pos;
    } else if (a.pos !== null) {
      return -1;
    } else if (b.pos !== null) {
      return 1;
    }
    if (a.id < b.id) return -1;
    return a.id > b.id ? 1 : 0;
  });
}

/**
 * `rebalancePositions` for a sibling set, indexed.
 *
 * The `??` arm is unreachable — `rebalancePositions(n)` returns exactly `n` numbers — and exists
 * only because `noUncheckedIndexedAccess` cannot know that. It repeats that function's own
 * formula rather than inventing a different one, so the unreachable branch could not disagree
 * with the reachable one even if it ever ran.
 */
function positionsFor(count: number): (index: number) => number {
  const positions = rebalancePositions(count);
  return (index) => positions[index] ?? (index + 1) * POSITION_GAP;
}

/** Trello writes `""` for an empty description; the column is nullable, so `null` is the truth. */
function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  return value.trim() === '' ? null : value;
}

/**
 * A Trello `due` string as a `Date`.
 *
 * An unparseable value becomes `null` and is *not* reported, following the same line the reader
 * draws for the board's own description: the report's vocabulary counts *things* — cards, labels,
 * checklists — and a `(card, malformed)` row for a card that was imported anyway would make
 * `count` mean two different things in the same list. What is lost is one date on one card, and
 * a wrongly *typed* `due` was already reported by the reader.
 */
function parseDueDate(raw: string | null): Date | null {
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type UrlVerdict =
  { storable: true; url: string } | { storable: false; reason: TrelloImportSkipReason };

/**
 * An attachment URL, held to the rule the rest of the API uses.
 *
 * The two failures are told apart because they are different facts about the export: something
 * that is not a URL at all is `malformed`, and a perfectly well-formed `javascript:` or `file:`
 * URL is `unsupportedScheme` — the second is the one ADR 0024's K7 is about, and collapsing them
 * would hide it inside a bucket that also holds typos.
 */
function classifyUrl(raw: string): UrlVerdict {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { storable: false, reason: TrelloImportSkipReason.Malformed };
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    return { storable: false, reason: TrelloImportSkipReason.UnsupportedScheme };
  }
  return { storable: true, url: parsed.toString() };
}

/**
 * A name that is the only thing identifying a row, missing.
 *
 * Applied to lists, cards, checklists and checklist items — and deliberately *not* to labels. A
 * label's identity is its colour; Trello users routinely make unnamed labels and use them as
 * colours, which is why ADR 0025 invents a name for one rather than dropping it. A column, a
 * card, a checklist and a checklist item are read by their text and nothing else, so an empty one
 * is a row that says nothing, and `TrelloImportSkipReason.Malformed` names exactly that case
 * ("present but unusable", `entities.ts`).
 */
function isUnnamed(value: string): boolean {
  return value.trim() === '';
}

/** Row counts, the `imported` half of the report. */
export function importedCounts(plan: TrelloImportPlan): {
  columns: number;
  tasks: number;
  labels: number;
  checklists: number;
  checklistItems: number;
  attachments: number;
} {
  return {
    columns: plan.columns.length,
    tasks: plan.tasks.length,
    labels: plan.labels.length,
    checklists: plan.checklists.length,
    checklistItems: plan.checklistItems.length,
    attachments: plan.attachments.length,
  };
}

/**
 * A read Trello export, mapped onto the rows this repository would write — and a report of
 * everything it would not.
 *
 * **Pure: no database, no clock, no HTTP.** That is the load-bearing property rather than a
 * stylistic one. ADR 0025 splits an import into an atomic *write* and a partial *scope*, and the
 * only way the write can be branch-free is if every decision about what to skip has already been
 * made. Everything in the returned plan is a row that is known to be writable; there is no "this
 * one failed, carry on" left for the transaction to do.
 *
 * It takes the reader's whole result, issues included, rather than just the narrowed export. The
 * reader's `issues` and the planner's own skips are the same list to the person reading the
 * report — "what did not come across" — and handing back two lists would make them add up counts
 * from two places to answer one question.
 *
 * Ids are generated here (`uuidv7`), not by the database. `createMany` does not return generated
 * ids, and this import has to join a card to its column, a checklist to its card and an item to
 * its checklist; issuing the ids up front is what makes a bulk write possible at all (ADR 0025).
 * The schema default stays where it is — this writer skips it, not every writer.
 */
export function planTrelloImport(
  read: TrelloExportReadResult,
  context: TrelloImportContext,
): TrelloImportPlan {
  const { source, issues } = read;
  const skips = new SkipCollector();
  for (const issue of issues) skips.add(issue.scope, issue.reason, issue.sample);

  const boardId = uuidv7();

  // ## Lists → columns
  const liveLists: TrelloList[] = [];
  const archivedListIds = new Set<string>();
  for (const list of source.lists) {
    if (list.closed) {
      // ADR 0025: Kurul has no archive, so an archived list could only arrive as a live one —
      // putting back in front of the user what they deliberately removed.
      archivedListIds.add(list.id);
      skips.add(TrelloImportScope.List, TrelloImportSkipReason.Archived, list.name);
    } else if (isUnnamed(list.name)) {
      skips.add(TrelloImportScope.List, TrelloImportSkipReason.Malformed, null);
    } else {
      liveLists.push(list);
    }
  }

  const orderedLists = orderedByPos(liveLists);
  const columnPosition = positionsFor(orderedLists.length);
  const columnIdByTrelloId = new Map<string, string>();
  const columns = orderedLists.map((list, index) => {
    const id = uuidv7();
    columnIdByTrelloId.set(list.id, id);
    return {
      id,
      boardId,
      name: list.name,
      position: columnPosition(index),
      // ADR 0019 rejects inferring completion from a name and from a position by name, and a
      // Trello export offers nothing else. So there is no `if` here at all, and its absence *is*
      // the rule — which is why the report carries a row saying how many columns are waiting for
      // a human in the column settings dialog.
      category: ColumnCategory.UNSTARTED,
    };
  });
  skips.addMany(
    TrelloImportScope.Column,
    TrelloImportSkipReason.Defaulted,
    columns.length,
    columns.map((column) => column.name),
  );

  // ## Labels
  const labelIdByTrelloId = new Map<string, string>();
  const labels = source.labels.map((label) => {
    const mapping = trelloColorToSlot(label.color);
    const trelloColorName = label.color?.trim() ?? '';
    const name = isUnnamed(label.name)
      ? trelloColorName === ''
        ? LABEL_NAME_FALLBACK
        : trelloColorName
      : label.name;
    const id = uuidv7();
    labelIdByTrelloId.set(label.id, id);

    // One row per label that arrived *changed*, not one per changed field. A label with no name
    // and an unknown colour is one label the user will not recognise, not two problems — the same
    // arithmetic the reader applies to its own entries (`trello-export.ts`, `EntryFields`).
    //
    // ADR 0025 spells out the colour half of this; the name half is here for the same reason it
    // gives for the colour half — the question after an import is "why does my board look
    // different", and a label that was renamed answers it just as much as one that was recoloured.
    if (mapping.defaulted || isUnnamed(label.name)) {
      skips.add(TrelloImportScope.Label, TrelloImportSkipReason.Defaulted, name);
    }

    return { id, boardId, name, color: mapping.slot };
  });

  // ## Cards → tasks
  //
  // Skipped cards are remembered with the reason they were skipped, so a checklist hanging off
  // one can be reported with the *same* reason. A checklist on an archived card is not malformed;
  // saying so would send the user looking for a corrupt export.
  const skippedCardReasons = new Map<string, TrelloImportSkipReason>();
  const cardsByColumnId = new Map<string, TrelloCard[]>();
  for (const card of source.cards) {
    const skip = (reason: TrelloImportSkipReason): void => {
      skippedCardReasons.set(card.id, reason);
      skips.add(TrelloImportScope.Card, reason, card.name);
    };

    if (card.closed) {
      skip(TrelloImportSkipReason.Archived);
      continue;
    }
    if (isUnnamed(card.name)) {
      skip(TrelloImportSkipReason.Malformed);
      continue;
    }

    const columnId = card.idList === null ? undefined : columnIdByTrelloId.get(card.idList);
    if (columnId === undefined) {
      // A card whose list was archived is archived content too; a card pointing at a list this
      // export does not contain is a hole in the file.
      skip(
        card.idList !== null && archivedListIds.has(card.idList)
          ? TrelloImportSkipReason.Archived
          : TrelloImportSkipReason.Malformed,
      );
      continue;
    }

    const siblings = cardsByColumnId.get(columnId);
    if (siblings === undefined) cardsByColumnId.set(columnId, [card]);
    else siblings.push(card);
  }

  const tasks: TrelloImportPlan['tasks'] = [];
  const taskLabels: TrelloImportPlan['taskLabels'] = [];
  const attachments: TrelloImportPlan['attachments'] = [];
  const taskIdByTrelloCardId = new Map<string, string>();

  for (const column of columns) {
    const cards = orderedByPos(cardsByColumnId.get(column.id) ?? []);
    const cardPosition = positionsFor(cards.length);

    cards.forEach((card, index) => {
      const taskId = uuidv7();
      taskIdByTrelloCardId.set(card.id, taskId);
      tasks.push({
        id: taskId,
        boardId,
        columnId: column.id,
        title: card.name,
        description: emptyToNull(card.desc),
        position: cardPosition(index),
        dueDate: parseDueDate(card.due),
        // `estimatedMinutes` is absent, so the schema default (`null`) stands. Trello has no such
        // field and `dueDate` is not it (CLAUDE.md). `priority` is absent for the same kind of
        // reason: Trello has no priority, and reading one off a label's *name* would be exactly
        // the guess ADR 0025 refuses.
        createdById: context.actorId,
      });

      // `@@unique([taskId, labelId])`: Trello can list the same label id twice on one card, and
      // a duplicate would abort the whole transaction — an atomic board lost to a duplicate row.
      const attached = new Set<string>();
      for (const trelloLabelId of card.idLabels) {
        const labelId = labelIdByTrelloId.get(trelloLabelId);
        if (labelId === undefined) {
          skips.add(TrelloImportScope.Label, TrelloImportSkipReason.Malformed, card.name);
          continue;
        }
        if (attached.has(labelId)) continue;
        attached.add(labelId);
        taskLabels.push({ id: uuidv7(), taskId, labelId });
      }

      for (const attachment of card.attachments) {
        const verdict = classifyUrl(attachment.url);
        if (!verdict.storable) {
          skips.add(TrelloImportScope.Attachment, verdict.reason, attachment.name);
          continue;
        }
        attachments.push({
          id: uuidv7(),
          taskId,
          uploadedById: context.actorId,
          // LINK and nothing else, always. The server has never requested this URL and never
          // will (ADR 0024 K7) — which is also why `storageKey`, `mimeType` and `size` are null:
          // there are no bytes, so there is nothing true to put in them.
          kind: AttachmentKind.Link,
          filename: isUnnamed(attachment.name) ? verdict.url : attachment.name,
          url: verdict.url,
          storageKey: null,
          mimeType: null,
          size: null,
        });
      }
    });
  }

  // ## Checklists
  //
  // One `Checklist` row per Trello checklist, never flattened — the reason ADR 0023 chose a
  // multi-list model in the first place (`0023-checklist-data-model.md:122-127`).
  const checklistsByTaskId = new Map<string, TrelloChecklist[]>();
  for (const checklist of source.checklists) {
    const taskId =
      checklist.idCard === null ? undefined : taskIdByTrelloCardId.get(checklist.idCard);
    if (taskId === undefined) {
      const inherited =
        checklist.idCard === null ? undefined : skippedCardReasons.get(checklist.idCard);
      skips.add(
        TrelloImportScope.Checklist,
        inherited ?? TrelloImportSkipReason.Malformed,
        checklist.name,
      );
      continue;
    }
    if (isUnnamed(checklist.name) || checklist.checkItems.length === 0) {
      skips.add(TrelloImportScope.Checklist, TrelloImportSkipReason.Malformed, checklist.name);
      continue;
    }

    const siblings = checklistsByTaskId.get(taskId);
    if (siblings === undefined) checklistsByTaskId.set(taskId, [checklist]);
    else siblings.push(checklist);
  }

  const checklists: TrelloImportPlan['checklists'] = [];
  const checklistItems: TrelloImportPlan['checklistItems'] = [];
  for (const task of tasks) {
    const cardChecklists = orderedByPos(checklistsByTaskId.get(task.id) ?? []);
    const checklistPosition = positionsFor(cardChecklists.length);

    cardChecklists.forEach((checklist, checklistIndex) => {
      const checklistId = uuidv7();
      checklists.push({
        id: checklistId,
        taskId: task.id,
        title: checklist.name,
        position: checklistPosition(checklistIndex),
      });

      const usableItems = orderedByPos(checklist.checkItems).filter((item) => {
        if (isUnnamed(item.name)) {
          skips.add(TrelloImportScope.ChecklistItem, TrelloImportSkipReason.Malformed, null);
          return false;
        }
        return true;
      });
      const itemPosition = positionsFor(usableItems.length);

      usableItems.forEach((item, itemIndex) => {
        checklistItems.push({
          id: uuidv7(),
          checklistId,
          content: item.name,
          // Trello writes `'complete'` / `'incomplete'`; anything else is not "done".
          isDone: item.state === 'complete',
          position: itemPosition(itemIndex),
        });
      });
    });
  }

  // ## Counted, never carried (ADR 0025)
  skips.addMany(TrelloImportScope.Member, TrelloImportSkipReason.Unmappable, source.memberCount);
  skips.addMany(TrelloImportScope.Comment, TrelloImportSkipReason.OutOfScope, source.commentCount);

  return {
    board: {
      id: boardId,
      name: isUnnamed(source.name) ? BOARD_NAME_FALLBACK : source.name,
      description: emptyToNull(source.desc),
    },
    columns,
    labels,
    tasks,
    taskLabels,
    checklists,
    checklistItems,
    attachments,
    skipped: skips.toReport(),
  };
}
