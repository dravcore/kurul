export const POSITION_GAP = 1000;
export const MIN_GAP = 0.000001;

/**
 * The position for a row landing between two neighbors, named in position order: `prev` is
 * the smaller position, `next` the larger. Either may be `null` at the ends of the list.
 */
export function midpoint(prev: number | null, next: number | null): number {
  // Nested rather than flat so `next` narrows on its own: the flat form needed a `!`.
  if (prev === null) {
    return next === null ? POSITION_GAP : next - POSITION_GAP;
  }
  if (next === null) return prev + POSITION_GAP;
  return (prev + next) / 2;
}

export function needsRebalance(prev: number | null, next: number | null): boolean {
  return prev !== null && next !== null && next - prev < MIN_GAP;
}

export function rebalancePositions(count: number, gap = POSITION_GAP): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * gap);
}
