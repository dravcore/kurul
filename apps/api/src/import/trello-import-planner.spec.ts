import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AttachmentKind, ColumnCategory, LabelColorSlot } from '@kurul/shared-types';
import type { TrelloImportSkipGroupDto } from '@kurul/shared-types';
import { SKIP_SAMPLE_LIMIT } from './import-skip';
import { parseTrelloExport, type TrelloExportReadResult } from './trello-export';
import {
  importedCounts,
  planTrelloImport,
  type TrelloImportContext,
  type TrelloImportPlan,
} from './trello-import-planner';

const FIXTURE_DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'trello');
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const CONTEXT: TrelloImportContext = { actorId: ACTOR_ID };
/** The fixture's first attachment on `Import boards from Trello`, the row the name tests edit. */
const NOTES_URL = 'https://example.invalid/notes/trello-export-format';

type RawExport = Record<string, unknown>;

function rawFixture(name: string): RawExport {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as RawExport;
}

/**
 * A fixture, read through the real reader.
 *
 * The planner is never handed a hand-built `TrelloExport` in this spec. Its input is whatever
 * `parseTrelloExport` produces, so a change in the reader's narrowing shows up here rather than
 * being papered over by a test that constructs the shape it wishes it had.
 */
function readFixture(name: string): TrelloExportReadResult {
  return parseTrelloExport(Buffer.from(JSON.stringify(rawFixture(name))));
}

/** The same, with the raw JSON edited first — the only way to reach cases no fixture holds. */
function readMutated(name: string, mutate: (raw: RawExport) => void): TrelloExportReadResult {
  const raw = rawFixture(name);
  mutate(raw);
  return parseTrelloExport(Buffer.from(JSON.stringify(raw)));
}

function group(
  plan: TrelloImportPlan,
  scope: string,
  reason: string,
): TrelloImportSkipGroupDto | undefined {
  return plan.skipped.find((entry) => entry.scope === scope && entry.reason === reason);
}

describe('planTrelloImport', () => {
  describe('columns', () => {
    it('gives every imported column the default category and reports how many', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(plan.columns.length).toBeGreaterThan(0);
      expect(plan.columns.every((column) => column.category === ColumnCategory.UNSTARTED)).toBe(
        true,
      );
      expect(group(plan, 'column', 'defaulted')).toMatchObject({ count: plan.columns.length });
    });

    it('re-issues positions instead of carrying Trello values across', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const positions = plan.columns.map((column) => column.position);

      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(positions[0]).toBe(1000);
      // The claim that matters: no Trello `pos` survived. The fixture's smallest is 16384, well
      // above anything `rebalancePositions` can produce for a board this size.
      expect(Math.max(...positions)).toBe(positions.length * 1000);
    });

    it('preserves Trello order while replacing the values', () => {
      const read = readFixture('synthetic-full-board');
      const trelloOrder = read.source.lists
        .filter((list) => !list.closed)
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
        .map((list) => list.name);
      const plan = planTrelloImport(read, CONTEXT);

      // The fixture deliberately writes `In Progress` (32768) before `Backlog` (16384), so a
      // planner that returned the array untouched would fail here and only here.
      expect(plan.columns.map((column) => column.name)).toEqual(trelloOrder);
      expect(trelloOrder[0]).toBe('Backlog');
    });

    it('falls back to Trello id order when `pos` is missing or non-numeric', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        for (const list of raw.lists as Array<Record<string, unknown>>) {
          list.pos = 'bottom';
        }
      });
      const plan = planTrelloImport(read, CONTEXT);

      // Ids ascend ...310 (Backlog) < ...311 (In Progress) < ...312 (Shipped); ...313 is the
      // archived one. A Trello id's leading hex digits are its creation time, so this is
      // "the order they were made", which is the fallback ADR 0025 chose over a coin flip.
      expect(plan.columns.map((column) => column.name)).toEqual([
        'Backlog',
        'In Progress',
        'Shipped',
      ]);
    });

    it('sorts entries with no `pos` after every entry that has one', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const lists = raw.lists as Array<Record<string, unknown>>;
        // `Backlog`, which sorts first on `pos`, loses its `pos` entirely.
        const backlog = lists.find((list) => list.name === 'Backlog');
        delete backlog?.pos;
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.columns.map((column) => column.name)).toEqual([
        'In Progress',
        'Shipped',
        'Backlog',
      ]);
    });

    it('skips an archived list and reports it', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(plan.columns.map((column) => column.name)).not.toContain('Old Sprint');
      expect(group(plan, 'list', 'archived')).toMatchObject({
        count: 1,
        samples: ['Old Sprint'],
      });
    });

    it('skips a list with no name at all, because a column is read by its heading', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.lists as Array<Record<string, unknown>>)[0]!.name = '   ';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.columns).toHaveLength(2);
      expect(group(plan, 'list', 'malformed')).toMatchObject({ count: 1 });
    });

    // SEC-04: the importer used to write `list.name` verbatim, with no ceiling: the one write
    // path into `Column` that skipped the length gate `CreateColumnDto` enforces on every other.
    it('clamps an oversized list name to the same ceiling CreateColumnDto enforces', () => {
      const longName = 'F'.repeat(10_000);
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.lists as Array<Record<string, unknown>>)[0]!.name = longName;
      });
      const plan = planTrelloImport(read, CONTEXT);
      const clamped = plan.columns.find((column) => column.name.startsWith('F'));

      expect(clamped?.name).toHaveLength(120);
      expect(clamped?.name).toBe(longName.slice(0, 120));
      // Every column is already reported as `defaulted` for its category; this asserts the
      // *sample* text for that row is the clamped name, not the 10000-character original: a
      // report about an oversized field must not itself carry an unbounded string.
      expect(group(plan, 'column', 'defaulted')?.samples).toContain(clamped?.name);
      expect(JSON.stringify(plan.skipped)).not.toContain(longName);
    });
  });

  describe('cards', () => {
    it('carries live cards into the right column, in Trello order, with fresh positions', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const backlog = plan.columns.find((column) => column.name === 'Backlog');
      const backlogTasks = plan.tasks.filter((task) => task.columnId === backlog?.id);

      expect(backlogTasks.map((task) => task.title)).toEqual([
        'Import boards from Trello',
        'Board drag and drop jumps on Safari',
      ]);
      expect(backlogTasks.map((task) => task.position)).toEqual([1000, 2000]);
    });

    it('restarts positions per column rather than numbering the board through', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const firstOfEachColumn = plan.columns.map(
        (column) => plan.tasks.find((task) => task.columnId === column.id)?.position,
      );

      // Every column's first card is at 1000. A planner that numbered the whole board would give
      // the second column's first card 3000, and every board would open with an odd gap.
      expect(firstOfEachColumn).toEqual([1000, 1000, 1000]);
    });

    it('skips an archived card and reports it separately from archived lists', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(plan.tasks.map((task) => task.title)).not.toContain('Spike: BullMQ for long imports');
      expect(group(plan, 'card', 'archived')).toMatchObject({
        count: 1,
        samples: ['Spike: BullMQ for long imports'],
      });
      expect(group(plan, 'list', 'archived')?.count).toBe(1);
    });

    it('skips an unnamed card', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(group(plan, 'card', 'malformed')).toMatchObject({ count: 1 });
      // Nothing to quote: an empty name is not a sample a user could look for.
      expect(group(plan, 'card', 'malformed')?.samples).toEqual([]);
    });

    it('skips an archived card that sits in a live list', () => {
      // The fixture's archived card also sits in the archived list, so the assertion above stays
      // green when the `closed` check on a *card* is deleted — measured, not assumed. This is the
      // case that isolates it: the list is live, so only the card's own flag can skip it.
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const archived = cards.find((card) => card.closed === true);
        if (archived) archived.idList = '6512a1b1c3d4e5f601020310';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.tasks.map((task) => task.title)).not.toContain('Spike: BullMQ for long imports');
      expect(group(plan, 'card', 'archived')).toMatchObject({
        count: 1,
        samples: ['Spike: BullMQ for long imports'],
      });
    });

    it('reports a card in an archived list as archived, not as malformed', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const archived = cards.find((card) => card.closed === true);
        // Un-archive the card itself; only its list stays archived.
        if (archived) archived.closed = false;
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(group(plan, 'card', 'archived')).toMatchObject({
        count: 1,
        samples: ['Spike: BullMQ for long imports'],
      });
      // The distinction is the whole point: `malformed` would send the user looking for a corrupt
      // export when what actually happened is that they archived the list.
      expect(group(plan, 'card', 'malformed')?.count).toBe(1);
    });

    it('reports a card pointing at a list this export does not contain as malformed', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.cards as Array<Record<string, unknown>>)[0]!.idList = 'ffffffffffffffffffffffff';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(group(plan, 'card', 'malformed')?.count).toBe(2);
      expect(group(plan, 'card', 'malformed')?.samples).toContain(
        'Board drag and drop jumps on Safari',
      );
    });

    it('carries the due date and leaves estimatedMinutes and priority to the schema', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const dated = plan.tasks.find((task) => task.title === 'Board drag and drop jumps on Safari');

      expect(dated?.dueDate).toEqual(new Date('2026-09-01T17:00:00.000Z'));
      // Two fields the plan must not invent: Trello has no priority, and `dueDate` is not
      // `estimatedMinutes` (CLAUDE.md). Neither appears in a planned row at all.
      expect(Object.keys(dated ?? {})).not.toContain('priority');
      expect(Object.keys(dated ?? {})).not.toContain('estimatedMinutes');
    });

    it('stores an empty Trello description as null, not as an empty string', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const blank = plan.tasks.find((task) => task.title === 'Column category settings dialog');
      const written = plan.tasks.find((task) => task.title === 'Import boards from Trello');

      // `Task.description` is nullable, so `""` and `null` are two representations of the same
      // fact and only one of them is the one every other writer in this codebase produces.
      expect(blank?.description).toBeNull();
      // The control half: a real description is not nulled out on the way through.
      expect(written?.description).toBe('One-way. Attachments come across as links.');
    });

    it('drops an unparseable due date without inventing one', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.cards as Array<Record<string, unknown>>)[0]!.due = 'next tuesday';
      });
      const plan = planTrelloImport(read, CONTEXT);
      const card = plan.tasks.find((task) => task.title === 'Board drag and drop jumps on Safari');

      expect(card).toBeDefined();
      expect(card?.dueDate).toBeNull();
    });

    it('records the importer as the author of every row', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(plan.tasks.every((task) => task.createdById === ACTOR_ID)).toBe(true);
      expect(plan.attachments.every((row) => row.uploadedById === ACTOR_ID)).toBe(true);
    });

    // SEC-04: the importer used to write `card.name` / `card.desc` verbatim, with no ceiling:
    // the one write path into `Task` that skipped the length gate `CreateTaskDto` enforces on
    // every other one.
    describe('field length ceilings', () => {
      it('clamps an oversized title to the same ceiling CreateTaskDto enforces, and reports it', () => {
        const longTitle = 'A'.repeat(10_000);
        const read = readMutated('synthetic-full-board', (raw) => {
          (raw.cards as Array<Record<string, unknown>>)[0]!.name = longTitle;
        });
        const plan = planTrelloImport(read, CONTEXT);
        const clamped = plan.tasks.find((task) => task.title.startsWith('A'));

        expect(clamped?.title).toHaveLength(500);
        expect(clamped?.title).toBe(longTitle.slice(0, 500));
        // The sample is the *clamped* title, not the 10000-character original: a report about an
        // oversized field must not itself carry an unbounded string back to the caller.
        expect(group(plan, 'card', 'defaulted')).toMatchObject({
          count: 1,
          samples: [clamped?.title],
        });
      });

      it('does not report a title within the limit as a substitution', () => {
        // The control for the row above. Without it, "clamps and reports" would pass just as
        // happily if every card were reported, and the report would call an untouched title
        // changed.
        const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

        expect(group(plan, 'card', 'defaulted')).toBeUndefined();
      });

      it('clamps an oversized description to the DTO ceiling', () => {
        const longDescription = 'B'.repeat(25_000);
        const read = readMutated('synthetic-full-board', (raw) => {
          (raw.cards as Array<Record<string, unknown>>)[0]!.desc = longDescription;
        });
        const plan = planTrelloImport(read, CONTEXT);
        const clamped = plan.tasks.find((task) => task.description?.startsWith('B'));

        expect(clamped?.description).toHaveLength(20_000);
        expect(clamped?.description).toBe(longDescription.slice(0, 20_000));
        expect(group(plan, 'card', 'defaulted')).toMatchObject({ count: 1 });
      });

      it('reports a card once even when both its title and description are clamped', () => {
        // The same arithmetic the labels loop already applies (`defaulted` there covers both
        // an unnamed name and an unknown colour in one row): a card is one thing the user does
        // not recognise, not two, however many of its fields were cut.
        const read = readMutated('synthetic-full-board', (raw) => {
          const card = (raw.cards as Array<Record<string, unknown>>)[0]!;
          card.name = 'A'.repeat(10_000);
          card.desc = 'B'.repeat(25_000);
        });
        const plan = planTrelloImport(read, CONTEXT);

        expect(group(plan, 'card', 'defaulted')).toMatchObject({ count: 1 });
      });

      it('drops a trailing lone surrogate rather than splitting a character pair at the cut', () => {
        // U+1F600 is a surrogate pair, two UTF-16 code units. `.slice(0, 500)` on 499 `A`s
        // followed by it lands exactly between the two halves, leaving a lone lead surrogate
        // as the last character unless the clamp drops it.
        const longTitle = 'A'.repeat(499) + '\u{1F600}';
        const read = readMutated('synthetic-full-board', (raw) => {
          (raw.cards as Array<Record<string, unknown>>)[0]!.name = longTitle;
        });
        const plan = planTrelloImport(read, CONTEXT);
        const clamped = plan.tasks.find((task) => task.title.startsWith('A'));

        expect(clamped?.title).toBe('A'.repeat(499));
        expect(clamped?.title).toHaveLength(499);
        expect(clamped?.title?.isWellFormed()).toBe(true);
      });
    });
  });

  describe('labels', () => {
    it('maps colours to slots and never writes a hex', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const slots = new Set<string>(Object.values(LabelColorSlot));

      expect(plan.labels.length).toBeGreaterThan(0);
      expect(plan.labels.every((label) => slots.has(label.color))).toBe(true);
      expect(plan.labels.find((label) => label.name === 'Bug')?.color).toBe('slot-8');
      // `purple_dark` is a shade of purple, and this repository has one slot per colour.
      expect(plan.labels.find((label) => label.name === 'Design')?.color).toBe('slot-7');
    });

    it('names an unnamed label after its Trello colour, because Label.name cannot be empty', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(plan.labels.every((label) => label.name.trim() !== '')).toBe(true);
      expect(plan.labels.map((label) => label.name)).toContain('green');
    });

    it('falls back to "Label" when there is no colour to name it after either', () => {
      const plan = planTrelloImport(readFixture('edge-unknown-color'), CONTEXT);

      expect(plan.labels.map((label) => label.name)).toEqual(['Citrus', 'Label', 'sky_light']);
      expect(plan.labels.map((label) => label.color)).toEqual(['slot-1', 'slot-1', 'slot-1']);
    });

    it('reports every label that arrived changed, once per label', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      // Three of the five: one unnamed, one uncoloured, one both unnamed and unknown-coloured.
      // The last is one label the user will not recognise, not two problems — the same
      // arithmetic the reader applies to its own entries.
      expect(group(plan, 'label', 'defaulted')).toMatchObject({ count: 3 });
    });

    it('does not report a label that really is blue as a substitution', () => {
      // The control test for the row above. Without it, "report every label" would pass just as
      // happily, and the report would tell a user that a correctly imported label was defaulted.
      const read = readMutated('synthetic-full-board', (raw) => {
        raw.labels = [{ id: '6512a1b2c3d4e5f601020320', name: 'Bug', color: 'blue' }];
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.labels[0]).toMatchObject({ name: 'Bug', color: 'slot-1' });
      expect(group(plan, 'label', 'defaulted')).toBeUndefined();
    });

    it('links cards to labels without repeating a pair', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        if (card) {
          // Trello can list the same label twice; `@@unique([taskId, labelId])` would abort the
          // whole transaction, losing an atomic board to a duplicate row.
          card.idLabels = [
            '6512a1b2c3d4e5f601020322',
            '6512a1b2c3d4e5f601020322',
            '6512a1b2c3d4e5f601020321',
          ];
        }
      });
      const plan = planTrelloImport(read, CONTEXT);
      const task = plan.tasks.find((entry) => entry.title === 'Import boards from Trello');
      const pairs = plan.taskLabels
        .filter((row) => row.taskId === task?.id)
        .map((row) => row.labelId);

      expect(pairs).toHaveLength(2);
      expect(new Set(pairs).size).toBe(2);
    });

    it('reports a card pointing at a label the export does not contain', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.cards as Array<Record<string, unknown>>)[0]!.idLabels = ['ffffffffffffffffffffffff'];
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(group(plan, 'label', 'malformed')).toMatchObject({ count: 1 });
      // The other three cards keep their labels: one bad reference costs one pairing, not a card.
      expect(plan.taskLabels).toHaveLength(3);
    });

    // SEC-04: the importer used to write `label.name` verbatim, with no ceiling: the one write
    // path into `Label` that skipped the length gate `CreateLabelDto` enforces on every other.
    it('clamps an oversized label name to the same ceiling CreateLabelDto enforces, and reports it', () => {
      const longName = 'G'.repeat(10_000);
      const read = readMutated('synthetic-full-board', (raw) => {
        raw.labels = [{ id: '6512a1b2c3d4e5f601020320', name: longName, color: 'blue' }];
      });
      const plan = planTrelloImport(read, CONTEXT);
      const clamped = plan.labels[0];

      expect(clamped?.name).toHaveLength(50);
      expect(clamped?.name).toBe(longName.slice(0, 50));
      // A well-formed colour, so nothing else about this label was defaulted: the clamp is the
      // only reason it is reported.
      expect(group(plan, 'label', 'defaulted')).toMatchObject({
        count: 1,
        samples: [clamped?.name],
      });
    });

    it('does not report a label within the limit as a substitution', () => {
      // The control for the row above. Without it, "clamps and reports" would pass just as
      // happily if every label were reported.
      const read = readMutated('synthetic-full-board', (raw) => {
        raw.labels = [{ id: '6512a1b2c3d4e5f601020320', name: 'F'.repeat(50), color: 'blue' }];
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(group(plan, 'label', 'defaulted')).toBeUndefined();
    });
  });

  describe('checklists', () => {
    it('carries every checklist as its own list, never flattened (ADR 0023)', () => {
      const read = readFixture('synthetic-full-board');
      const plan = planTrelloImport(read, CONTEXT);

      // One `Checklist` row per Trello checklist. A flattening bug produces fewer rows and more
      // items per row, which a total-item count alone would not notice.
      expect(plan.checklists).toHaveLength(read.source.checklists.length);
      expect(plan.checklistItems).toHaveLength(
        read.source.checklists.reduce((total, list) => total + list.checkItems.length, 0),
      );
      expect(plan.checklistItems.filter((item) => item.isDone)).toHaveLength(
        read.source.checklists
          .flatMap((list) => list.checkItems)
          .filter((item) => item.state === 'complete').length,
      );
    });

    it('orders a cards checklists and their items by pos, with fresh positions', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);
      const task = plan.tasks.find((entry) => entry.title === 'Import boards from Trello');
      const lists = plan.checklists.filter((entry) => entry.taskId === task?.id);

      // `Mapping` is written second in the fixture and has the smaller `pos`.
      expect(lists.map((entry) => entry.title)).toEqual(['Mapping', 'Reader']);
      expect(lists.map((entry) => entry.position)).toEqual([1000, 2000]);

      const items = plan.checklistItems.filter((item) => item.checklistId === lists[0]?.id);
      expect(items.map((item) => item.content)).toEqual([
        'Colours to slots',
        'Positions re-issued',
      ]);
      expect(items.map((item) => item.position)).toEqual([1000, 2000]);
    });

    it('treats only "complete" as done', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const lists = raw.checklists as Array<Record<string, unknown>>;
        const items = lists[0]!.checkItems as Array<Record<string, unknown>>;
        items[1]!.state = 'completed';
      });
      const plan = planTrelloImport(read, CONTEXT);

      // `completed` is not `complete`. A truthiness check, or a `startsWith`, would tick a box
      // nobody ticked — the one checklist bug a user cannot tell from their own memory.
      expect(plan.checklistItems.filter((item) => item.isDone)).toHaveLength(2);
    });

    it('skips a checklist whose card was archived, with the card s own reason', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.checklists as Array<Record<string, unknown>>)[0]!.idCard = '6512a1b3c3d4e5f601020334';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.checklists).toHaveLength(2);
      expect(group(plan, 'checklist', 'archived')).toMatchObject({ count: 1, samples: ['Reader'] });
      expect(group(plan, 'checklist', 'malformed')).toBeUndefined();
    });

    it('skips a checklist pointing at no card at all as malformed', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.checklists as Array<Record<string, unknown>>)[0]!.idCard = null;
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(group(plan, 'checklist', 'malformed')).toMatchObject({ count: 1 });
    });

    it('skips a checklist with no items and one with no title', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const lists = raw.checklists as Array<Record<string, unknown>>;
        lists[0]!.checkItems = [];
        lists[1]!.name = '';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.checklists).toHaveLength(1);
      expect(group(plan, 'checklist', 'malformed')).toMatchObject({ count: 2 });
    });

    it('skips an unnamed item without losing the rest of its list', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const lists = raw.checklists as Array<Record<string, unknown>>;
        (lists[0]!.checkItems as Array<Record<string, unknown>>)[0]!.name = '';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.checklists).toHaveLength(3);
      expect(plan.checklistItems).toHaveLength(4);
      expect(group(plan, 'checklistItem', 'malformed')).toMatchObject({ count: 1 });
    });

    it('clamps an oversized checklist title to the DTO ceiling, and reports it (SEC-04)', () => {
      const longTitle = 'C'.repeat(1_000);
      const read = readMutated('synthetic-full-board', (raw) => {
        (raw.checklists as Array<Record<string, unknown>>)[0]!.name = longTitle;
      });
      const plan = planTrelloImport(read, CONTEXT);
      const clamped = plan.checklists.find((entry) => entry.title.startsWith('C'));

      expect(clamped?.title).toHaveLength(255);
      expect(clamped?.title).toBe(longTitle.slice(0, 255));
      expect(group(plan, 'checklist', 'defaulted')).toMatchObject({
        count: 1,
        samples: [clamped?.title],
      });
    });

    // SEC-04: the importer used to write `checkItem.name` verbatim, with no ceiling: the one
    // write path into `ChecklistItem` that skipped the length gate `CreateChecklistItemDto`
    // enforces on every other.
    it('clamps an oversized checklist item content to the DTO ceiling, and reports it', () => {
      const longContent = 'H'.repeat(10_000);
      const read = readMutated('synthetic-full-board', (raw) => {
        const lists = raw.checklists as Array<Record<string, unknown>>;
        (lists[0]!.checkItems as Array<Record<string, unknown>>)[0]!.name = longContent;
      });
      const plan = planTrelloImport(read, CONTEXT);
      const clamped = plan.checklistItems.find((item) => item.content.startsWith('H'));

      expect(clamped?.content).toHaveLength(1_000);
      expect(clamped?.content).toBe(longContent.slice(0, 1_000));
      expect(group(plan, 'checklistItem', 'defaulted')).toMatchObject({
        count: 1,
        samples: [clamped?.content],
      });
    });

    it('does not report a checklist item within the limit as a substitution', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(group(plan, 'checklistItem', 'defaulted')).toBeUndefined();
    });
  });

  describe('attachments', () => {
    it('turns card attachments into LINK rows and never anything else', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(plan.attachments.length).toBeGreaterThan(0);
      for (const row of plan.attachments) {
        expect(row.kind).toBe(AttachmentKind.Link);
        expect(row.storageKey).toBeNull();
        expect(row.mimeType).toBeNull();
        expect(row.size).toBeNull();
        expect(row.url.startsWith('http')).toBe(true);
      }
    });

    it('skips a non-http attachment URL and reports the scheme', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      // The fixture's third attachment is a `file:` URL.
      expect(plan.attachments).toHaveLength(2);
      expect(group(plan, 'attachment', 'unsupportedScheme')).toMatchObject({
        count: 1,
        samples: ['Local spec copy'],
      });
    });

    it('reports a javascript: URL as an unsupported scheme, not as a malformed one', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.url = 'javascript:alert(1)';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.attachments).toHaveLength(1);
      expect(group(plan, 'attachment', 'unsupportedScheme')).toMatchObject({ count: 2 });
    });

    it('reports something that is not a URL at all as malformed', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.url = 'not a url';
      });
      const plan = planTrelloImport(read, CONTEXT);

      // Told apart from the scheme case on purpose: `unsupportedScheme` is the ADR 0024 rule, and
      // burying it in a bucket that also holds typos would hide the one that matters.
      expect(group(plan, 'attachment', 'malformed')).toMatchObject({ count: 1 });
      expect(group(plan, 'attachment', 'unsupportedScheme')).toMatchObject({ count: 1 });
    });

    /**
     * The link label goes through the same cleaning `AttachmentService.createLink` applies, and
     * the expected strings below are the ones `attachment.service.spec.ts` asserts for that
     * path. An export is a file somebody else wrote, and a bidi override in an attachment name
     * renders the same way in the panel whether the row came from a form or from an import.
     */
    it('cleans a link name exactly as createLink cleans one', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.name =
          'inv\u202egnp.exe\r\nX-Injected: 1';
      });
      const plan = planTrelloImport(read, CONTEXT);

      const row = plan.attachments.find((entry) => entry.url === NOTES_URL);
      expect(row?.filename).toBe('invgnp.exeX-Injected: 1');
    });

    it('clamps a link name to 255 characters', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.name = 'a'.repeat(300);
      });
      const plan = planTrelloImport(read, CONTEXT);

      const row = plan.attachments.find((entry) => entry.url === NOTES_URL);
      expect(row?.filename).toBe('a'.repeat(255));
    });

    it('falls back to the URL when the name was made only of stripped characters', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.name = '\u202e\u202a\u0000';
      });
      const plan = planTrelloImport(read, CONTEXT);

      const row = plan.attachments.find((entry) => entry.url === NOTES_URL);
      // The same fallback an empty name gets, and the same one `createLink` uses: a URL is the
      // one label that is always true of a link.
      expect(row?.filename).toBe(NOTES_URL);
    });

    // The control: a rule that dropped every non-ASCII character would pass the three above.
    it('leaves an ordinary non-ASCII link name intact', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.name = 'ölçüm notları';
      });
      const plan = planTrelloImport(read, CONTEXT);

      const row = plan.attachments.find((entry) => entry.url === NOTES_URL);
      expect(row?.filename).toBe('ölçüm notları');
    });

    // SEC-04: the importer used to write `attachment.url` verbatim, with no ceiling: the one
    // write path into `Attachment` that skipped the length gate `CreateAttachmentDto` enforces
    // on every other.
    it('clamps an oversized attachment URL to the DTO ceiling, and reports it', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        const card = cards.find((entry) => entry.name === 'Import boards from Trello');
        (card?.attachments as Array<Record<string, unknown>>)[0]!.url =
          `https://example.invalid/${'I'.repeat(3_000)}`;
      });
      const plan = planTrelloImport(read, CONTEXT);
      const row = plan.attachments.find((entry) =>
        entry.url.startsWith('https://example.invalid/I'),
      );

      expect(row?.url).toHaveLength(2_048);
      expect(group(plan, 'attachment', 'defaulted')).toMatchObject({ count: 1 });
    });

    it('does not report an attachment URL within the limit as a substitution', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(group(plan, 'attachment', 'defaulted')).toBeUndefined();
    });
  });

  describe('the report', () => {
    it('drops members and comments, and counts both', () => {
      const read = readFixture('synthetic-full-board');
      const plan = planTrelloImport(read, CONTEXT);

      expect(group(plan, 'member', 'unmappable')).toMatchObject({
        count: read.source.memberCount,
      });
      expect(group(plan, 'comment', 'outOfScope')).toMatchObject({
        count: read.source.commentCount,
      });
      // The negative half: no member id reaches any planned row. The fixture's cards carry
      // `idMembers`, so this would fail on a planner that copied a card object across wholesale.
      expect(JSON.stringify(plan)).not.toContain('6512a1b9c3d4e5f601020401');
    });

    it('counts comments rather than actions', () => {
      const read = readFixture('synthetic-full-board');

      // The fixture carries three actions, one of which is an `updateCard`. A planner reporting
      // `actions.length` would say three, and the user would go looking for a third comment.
      expect(group(planTrelloImport(read, CONTEXT), 'comment', 'outOfScope')?.count).toBe(2);
    });

    it('merges the reader s own issues into the same list', () => {
      const read = readFixture('edge-unknown-shape');
      const plan = planTrelloImport(read, CONTEXT);

      expect(read.issues.length).toBeGreaterThan(0);
      const reported = plan.skipped.reduce((total, entry) => total + entry.count, 0);
      const plannerOwn = plan.skipped
        .filter((entry) => entry.reason === 'defaulted')
        .reduce((total, entry) => total + entry.count, 0);

      // Every issue the reader raised is somewhere in the report. Two lists — one from the reader
      // and one from the planner — would make the user add up counts from two places to answer
      // one question.
      expect(reported - plannerOwn).toBeGreaterThanOrEqual(read.issues.length);
    });

    it('caps samples at the limit but never caps the count', () => {
      const read = readMutated('synthetic-full-board', (raw) => {
        const cards = raw.cards as Array<Record<string, unknown>>;
        raw.cards = Array.from({ length: 57 }, (_unused, index) => ({
          ...cards[0],
          id: `6512a1b3c3d4e5f6010207${index.toString(16).padStart(2, '0')}`,
          name: `Archived card ${index}`,
          closed: true,
        }));
      });
      const plan = planTrelloImport(read, CONTEXT);
      const archived = group(plan, 'card', 'archived');

      expect(archived?.count).toBe(57);
      expect(archived?.samples).toHaveLength(SKIP_SAMPLE_LIMIT);
    });

    it('produces an identical plan twice, id fields aside', () => {
      const read = readFixture('synthetic-full-board');
      const strip = (plan: TrelloImportPlan): string =>
        JSON.stringify(plan, (key, value: unknown) =>
          key === 'id' || key.endsWith('Id') ? '·' : value,
        );

      expect(strip(planTrelloImport(read, CONTEXT))).toBe(strip(planTrelloImport(read, CONTEXT)));
    });

    it('issues a fresh set of ids on every run, so two imports are two boards', () => {
      // The control half of the test above: stripping ids would also make two *identical* plans
      // compare equal, and ADR 0025's "no idempotency" decision says they must not be.
      const read = readFixture('synthetic-full-board');
      const first = planTrelloImport(read, CONTEXT);
      const second = planTrelloImport(read, CONTEXT);

      expect(first.board.id).not.toBe(second.board.id);
      expect(first.tasks.map((task) => task.id)).not.toEqual(second.tasks.map((task) => task.id));
    });

    it('counts what it planned', () => {
      const plan = planTrelloImport(readFixture('synthetic-full-board'), CONTEXT);

      expect(importedCounts(plan)).toEqual({
        columns: 3,
        tasks: 4,
        labels: 5,
        checklists: 3,
        checklistItems: 5,
        attachments: 2,
      });
    });
  });

  describe('edges', () => {
    it('handles an empty board without producing anything or throwing', () => {
      const plan = planTrelloImport(readFixture('edge-empty-board'), CONTEXT);

      expect(plan.columns).toEqual([]);
      expect(plan.tasks).toEqual([]);
      expect(plan.board.name).toBe('Nothing here yet');
      expect(plan.board.description).toBeNull();
      // No columns means no "we defaulted N categories" row either. A row saying zero is noise.
      expect(plan.skipped).toEqual([]);
    });

    it('handles a list with no cards', () => {
      const plan = planTrelloImport(readFixture('edge-empty-list'), CONTEXT);

      expect(plan.columns).toHaveLength(1);
      expect(plan.tasks).toEqual([]);
    });

    it('names a board Trello left unnamed', () => {
      const read = readMutated('edge-empty-board', (raw) => {
        raw.name = '   ';
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.board.name).toBe('Imported board');
    });

    it('clamps an oversized board name and description to the DTO ceilings (SEC-04)', () => {
      const read = readMutated('edge-empty-board', (raw) => {
        raw.name = 'D'.repeat(500);
        raw.desc = 'E'.repeat(3_000);
      });
      const plan = planTrelloImport(read, CONTEXT);

      expect(plan.board.name).toHaveLength(120);
      expect(plan.board.description).toHaveLength(2_000);
      // No `board` scope exists in `TrelloImportScope` (a board is one row, not a class of
      // rows): `trello-export.ts` makes the same call for the board's own description already.
      // The clamp is silent, the same way that one already is.
      expect(plan.skipped).toEqual([]);
    });

    it('survives a drifted export, reporting rather than throwing', () => {
      const plan = planTrelloImport(readFixture('edge-unknown-shape'), CONTEXT);

      expect(plan.skipped.length).toBeGreaterThan(0);
      // The readable half still comes across — that is what makes this a report and not a failure.
      expect(plan.columns.length).toBeGreaterThan(0);
    });
  });
});
