import { BadRequestException, NotFoundException } from '@nestjs/common';

export function resolveMoveNeighbors<T extends { id: string; position: number }>(
  remaining: T[],
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
  selfId: string,
): { insertionIndex: number; before: T | null; after: T | null } {
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
  const before = remaining[insertionIndex - 1] ?? null;
  const after = remaining[insertionIndex] ?? null;

  return { insertionIndex, before, after };
}
