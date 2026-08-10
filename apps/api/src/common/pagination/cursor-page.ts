import type { CursorPage } from '@kurultay/shared-types';

/**
 * Splits an over-fetched result set into a cursor page.
 *
 * Every cursor list queries `take: limit + 1`: the extra row is the probe that answers
 * "is there another page?" without a second count query. This turns that probe into the
 * `CursorPage<T>` shape — the probe row is dropped from `items`, `hasMore` reports whether
 * it existed, and `nextCursor` is the id of the last row the client actually received.
 *
 * The cursor is always the row `id` (UUIDv7, monotonic) and never `position` — a Float that
 * a drag can move behind the cursor, silently hiding rows. See
 * docs/api-conventions.md#the-cursor-key-is-always-id-never-position.
 *
 * `rows` must already be ordered by `id` in the direction the caller pages in; this helper
 * does not sort.
 */
export function toCursorPage<TRow extends { id: string }, TDto>(
  rows: TRow[],
  limit: number,
  map: (row: TRow) => TDto,
): CursorPage<TDto> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // `at(-1)` narrows instead of asserting: an empty page has no last row, and a `limit` of 0
  // can produce `hasMore` with nothing to hand back as a cursor.
  const last = page.at(-1);

  return {
    items: page.map((row) => map(row)),
    nextCursor: hasMore && last ? last.id : null,
    hasMore,
  };
}
