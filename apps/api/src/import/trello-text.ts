/**
 * The one place a Trello export's free-text fields are cut down to a length something else has
 * already promised to hold.
 *
 * Lives apart from `trello-import-planner.ts` so that `import-skip.ts` can clamp a report sample
 * without importing the planner that imports it (`SkipCollector` is what the planner uses to
 * build the report in the first place, so the other direction would be circular).
 */

/** The UTF-16 range a surrogate pair's first half falls in; its second half never does. */
const LEAD_SURROGATE_MIN = 0xd800;
const LEAD_SURROGATE_MAX = 0xdbff;

/**
 * A string held to the same length ceiling the HTTP write path enforces (SEC-04), with whether
 * anything had to be cut.
 *
 * class-validator's `@MaxLength` counts UTF-16 code units, `String.prototype.length`, and
 * `.slice` counts the same unit, so a value this function passes through unclamped is one the
 * DTO would also have accepted, and one it clamps is cut to the exact length the DTO allows.
 * Without this, a Trello export is the one door into this database `CreateTaskDto` and
 * `CreateBoardDto` do not guard.
 *
 * A character outside the Basic Multilingual Plane (most emoji included) is two UTF-16 code
 * units, and `.slice` has no notion of that pairing: cutting at exactly `maxLength` can land
 * between the two, leaving a lone lead surrogate as the last character. Nothing downstream
 * rejects that, it round-trips through Postgres as a replacement character, so the trailing
 * lead surrogate is dropped here rather than stored.
 */
export function clampToLength(
  value: string,
  maxLength: number,
): { value: string; truncated: boolean } {
  if (value.length <= maxLength) return { value, truncated: false };
  const sliced = value.slice(0, maxLength);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  const clean =
    lastCode >= LEAD_SURROGATE_MIN && lastCode <= LEAD_SURROGATE_MAX ? sliced.slice(0, -1) : sliced;
  return { value: clean, truncated: true };
}

/** `clampToLength`, through the `null` a description or board description already carries. */
export function clampNullable(
  value: string | null,
  maxLength: number,
): { value: string | null; truncated: boolean } {
  if (value === null) return { value: null, truncated: false };
  return clampToLength(value, maxLength);
}
