import { NotFoundException } from '@nestjs/common';

/**
 * The slot a row is going into, expressed the same way for creates and for moves.
 *
 * The domain vocabulary is `prev`/`next`, and it means one thing only: **position order**.
 * `prev` is the sibling with the smaller position, `next` the one with the larger, so the
 * pair goes straight into `midpoint(prev, next)`.
 *
 * `before`/`after` is deliberately *not* used here. Those words belong to the client
 * contract — the `beforeTaskId`/`afterTaskId`/`afterColumnId` DTO fields — where `afterX`
 * means the opposite thing on create (the row to insert *after*, i.e. the `prev`) than it
 * does on move (the row that ends up *after*, i.e. the `next`). Keeping the two vocabularies
 * apart is what stops that contradiction from leaking into the ordering math: the DTO name is
 * translated to `prev`/`next` exactly once, at the call site.
 */
export interface InsertionSlot<T> {
  insertionIndex: number;
  prev: T | null;
  next: T | null;
}

/**
 * Slot for a row being moved.
 *
 * `prevId` is the sibling the moved row lands after, `nextId` the one it lands before; the
 * caller maps its DTO fields onto them (`beforeTaskId` → `prevId`, `afterTaskId` → `nextId`).
 *
 * `remaining` is the target list with the moved row already filtered out, so a request that
 * names the row as its own neighbor is rejected by the caller before it gets here — the
 * services own that check because each states it in its own words ("A task cannot be its own
 * neighbor").
 */
export function resolveMoveNeighbors<T extends { id: string; position: number }>(
  remaining: T[],
  prevId: string | null | undefined,
  nextId: string | null | undefined,
): InsertionSlot<T> {
  const prevIndex =
    prevId === null || prevId === undefined
      ? -1
      : remaining.findIndex((item) => item.id === prevId);
  const nextIndex =
    nextId === null || nextId === undefined
      ? -1
      : remaining.findIndex((item) => item.id === nextId);

  if (
    (prevId && prevIndex < 0) ||
    (nextId && nextIndex < 0) ||
    (prevIndex >= 0 && nextIndex >= 0 && nextIndex !== prevIndex + 1)
  ) {
    throw new NotFoundException('Neighbor not found');
  }

  const insertionIndex =
    prevIndex >= 0 ? prevIndex + 1 : nextIndex >= 0 ? nextIndex : remaining.length;

  return sliceSlot(remaining, insertionIndex);
}

/**
 * Slot for a newly created row.
 *
 * Create names a single neighbor — the sibling the new row goes after, which in position
 * order is its `prev` — and appends when it is absent. The result reads `prev`/`next` like a
 * move does, which is what keeps the two rebalance paths alike.
 */
export function resolveCreateNeighbors<T extends { id: string; position: number }>(
  siblings: T[],
  prevId: string | null | undefined,
  notFoundMessage: string,
): InsertionSlot<T> {
  const prev = prevId ? siblings.find((item) => item.id === prevId) : siblings.at(-1);
  if (prevId && !prev) {
    throw new NotFoundException(notFoundMessage);
  }

  const insertionIndex = prev ? siblings.indexOf(prev) + 1 : 0;
  return sliceSlot(siblings, insertionIndex);
}

function sliceSlot<T>(items: T[], insertionIndex: number): InsertionSlot<T> {
  return {
    insertionIndex,
    prev: items[insertionIndex - 1] ?? null,
    next: items[insertionIndex] ?? null,
  };
}
