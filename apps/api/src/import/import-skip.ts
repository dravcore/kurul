import { TrelloImportScope, TrelloImportSkipReason } from '@kurul/shared-types';
import type { TrelloImportSkipGroupDto } from '@kurul/shared-types';
import { clampToLength } from './trello-text';

/**
 * Up to this many names per `(scope, reason)` group reach the report.
 *
 * The count is never capped; only the examples are. A 500-card import can skip 500 cards for one
 * reason, and a list of 500 names is not a report — it is the export again. Twenty is enough for
 * a person to recognise the pattern ("ah, the archived ones") and small enough that the response
 * stays a response.
 */
export const SKIP_SAMPLE_LIMIT = 20;

/**
 * The longest a single sample string is allowed to be, whichever `(scope, reason)` it lands in.
 *
 * Most call sites already clamp their sample to the length ceiling the row it describes would
 * have had (SEC-04) before handing it to `add`/`addMany`: a dropped card's name to
 * `MAX_TASK_TITLE_LENGTH`, a dropped list's to `MAX_COLUMN_NAME_LENGTH`, a dropped attachment's
 * filename to `MAX_ATTACHMENT_URL_LENGTH` when it falls back to the (already-clamped) URL, and
 * so on. One path has no row to borrow a ceiling from at all, though: an entry the reader itself
 * rejects before it becomes anything (`readCard`/`readList`/`readLabel`/`readChecklist`
 * returning `null` for a missing `id`, or for a field of the wrong type) is reported straight
 * from `trello-export.ts` with whatever string sat in its `name` field, unclamped, because there
 * is no accepted row's ceiling to reuse.
 *
 * Rather than teach the reader every DTO ceiling in this file for a value it may end up throwing
 * away entirely, the collector holds every sample to this one flat length on the way in. It
 * matches `MAX_ATTACHMENT_URL_LENGTH`, the largest of the per-field ceilings already used for a
 * sample here, so no call site that was already clamping to one of those loses anything: this is
 * the backstop for the one call site that had nothing to clamp to, and for any future one that
 * forgets to.
 */
export const SKIP_SAMPLE_MAX_LENGTH = 2_048;

/**
 * The order groups appear in, taken from the vocabularies themselves rather than written out
 * again here.
 *
 * `Object.values` over a `const` object preserves declaration order, so the report follows the
 * order in which `packages/shared-types/src/entities.ts` lists the scopes and reasons — which is
 * roughly board-outwards, and is at least *one* order rather than "whichever branch the planner
 * happened to reach first".
 */
const SCOPE_ORDER: readonly string[] = Object.values(TrelloImportScope);
const REASON_ORDER: readonly string[] = Object.values(TrelloImportSkipReason);

interface SkipGroup {
  scope: TrelloImportScope;
  reason: TrelloImportSkipReason;
  count: number;
  samples: string[];
}

/**
 * Everything an import did not carry across, gathered into `(scope, reason)` groups.
 *
 * Two things about the shape are decisions rather than convenience.
 *
 * **The order is stable, and that is a product decision rather than a test convenience.** The
 * report is shown to the person who ran the import; someone who imports the same export twice
 * must not be handed the same facts in two different orders and left to work out whether
 * something changed.
 *
 * **`count` and `samples` are counted separately.** `count` is the real number and is never
 * capped — that is the number a user acts on. `samples` is capped at `SKIP_SAMPLE_LIMIT`, so the
 * response size tracks the number of *kinds* of problem rather than the size of the export.
 */
export class SkipCollector {
  private readonly groups = new Map<string, SkipGroup>();

  /** One skipped item, with a name when there was one worth quoting. */
  add(scope: TrelloImportScope, reason: TrelloImportSkipReason, sample?: string | null): void {
    this.addMany(scope, reason, 1, sample === undefined || sample === null ? [] : [sample]);
  }

  /**
   * `count` items at once, for the sections that are counted rather than walked (members and
   * comments, which the reader only ever counts).
   *
   * A `count` of zero adds nothing. A group with `count: 0` in the report would be a line saying
   * "nothing went wrong here", and a report made mostly of those lines is one nobody reads.
   */
  addMany(
    scope: TrelloImportScope,
    reason: TrelloImportSkipReason,
    count: number,
    samples: readonly (string | null | undefined)[] = [],
  ): void {
    if (count <= 0) return;

    const key = `${scope}/${reason}`;
    let group = this.groups.get(key);
    if (group === undefined) {
      group = { scope, reason, count: 0, samples: [] };
      this.groups.set(key, group);
    }
    group.count += count;

    for (const sample of samples) {
      if (group.samples.length >= SKIP_SAMPLE_LIMIT) break;
      // An empty name is not a sample. A card Trello never named contributes to `count` and
      // nothing to the list of examples, because `""` in a list of names reads as a bug in the
      // report rather than as a fact about the board.
      const trimmed = sample?.trim() ?? '';
      if (trimmed === '') continue;
      // Clamped here, not trusted from the caller: this is the one place every sample passes
      // through regardless of call site, so an unbounded string stops being possible at all
      // rather than being one more thing each call site has to remember (SEC-04 round 2).
      group.samples.push(clampToLength(trimmed, SKIP_SAMPLE_MAX_LENGTH).value);
    }
  }

  /** The groups, in the stable order described above. */
  toReport(): TrelloImportSkipGroupDto[] {
    return [...this.groups.values()]
      .sort(
        (a, b) =>
          SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) ||
          REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason),
      )
      .map((group) => ({
        scope: group.scope,
        reason: group.reason,
        count: group.count,
        samples: [...group.samples],
      }));
  }
}
