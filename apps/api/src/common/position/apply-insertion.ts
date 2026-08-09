import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * The slot a row is going into, expressed the same way for creates and for moves.
 *
 * `before` is the sibling that will precede the row and `after` the one that will follow
 * it, so both call sites can hand the pair straight to `midpoint(before, after)` without
 * having to remember which way round the request's `beforeId`/`afterId` meant it.
 */
export interface InsertionSlot<T> {
  insertionIndex: number;
  before: T | null;
  after: T | null;
}

export function resolveMoveNeighbors<T extends { id: string; position: number }>(
  remaining: T[],
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
  selfId: string,
): InsertionSlot<T> {
  if (beforeId === selfId || afterId === selfId) {
    throw new BadRequestException('Cannot use self as neighbor');
  }

  const beforeIndex =
    beforeId === null || beforeId === undefined
      ? -1
      : remaining.findIndex((item) => item.id === beforeId);
  const afterIndex =
    afterId === null || afterId === undefined
      ? -1
      : remaining.findIndex((item) => item.id === afterId);

  if (
    (beforeId && beforeIndex < 0) ||
    (afterId && afterIndex < 0) ||
    (beforeIndex >= 0 && afterIndex >= 0 && afterIndex !== beforeIndex + 1)
  ) {
    throw new NotFoundException('Neighbor not found');
  }

  const insertionIndex =
    beforeIndex >= 0 ? beforeIndex + 1 : afterIndex >= 0 ? afterIndex : remaining.length;

  return sliceSlot(remaining, insertionIndex);
}

/**
 * Slot for a newly created row.
 *
 * Create takes a single `afterId` — the sibling the new row goes *after* — and appends
 * when it is absent. Callers name the result `before`/`after` like a move does, which is
 * what keeps the two rebalance paths reading alike.
 */
export function resolveCreateNeighbors<T extends { id: string; position: number }>(
  siblings: T[],
  afterId: string | null | undefined,
  notFoundMessage: string,
): InsertionSlot<T> {
  const predecessor = afterId ? siblings.find((item) => item.id === afterId) : siblings.at(-1);
  if (afterId && !predecessor) {
    throw new NotFoundException(notFoundMessage);
  }

  const insertionIndex = predecessor ? siblings.indexOf(predecessor) + 1 : 0;
  return sliceSlot(siblings, insertionIndex);
}

function sliceSlot<T>(items: T[], insertionIndex: number): InsertionSlot<T> {
  return {
    insertionIndex,
    before: items[insertionIndex - 1] ?? null,
    after: items[insertionIndex] ?? null,
  };
}
