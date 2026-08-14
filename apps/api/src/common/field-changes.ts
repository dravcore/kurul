/** One field's audit entry: what it held, and what the write put there. */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

/**
 * The fields a write actually altered, each as `{ from, to }`.
 *
 * ## Why administrative events carry `from` and task events do not
 *
 * `planTaskUpdate` records `changes` as `{ field: newValue }`, and for the task feed that is
 * the right shape: the feed is read forwards, the reader is looking at the current card, and
 * the previous title is one row further down the same list.
 *
 * An audit entry is read backwards, once, by someone reconstructing what a compromised or
 * departing account did — and for them the interesting half is almost always the value that is
 * *gone*. "Renamed the board to Archive" does not say which board was hidden; "Archive ← Q3
 * Launch" does. The extra field costs one JSON key on writes that happen a handful of times a
 * day, against the ones per second the task feed absorbs, which is why the two shapes are
 * allowed to differ instead of being unified on the cheaper one.
 *
 * Unchanged fields are omitted entirely, so an empty result means the request re-sent what was
 * already stored. Callers pass values that survive `JSON.stringify` — the payload column is
 * `Json`, so a `Date` would arrive as a string nobody declared.
 */
export function fieldChanges<K extends string>(
  before: { [P in K]: unknown },
  after: { [P in K]: unknown },
  fields: readonly K[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};

  for (const field of fields) {
    const from = before[field];
    const to = after[field];
    if (from !== to) {
      changes[field] = { from, to };
    }
  }

  return changes;
}
