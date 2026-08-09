export const POSITION_GAP = 1000;
export const MIN_GAP = 0.000001;

export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return POSITION_GAP;
  if (before === null) return after! - POSITION_GAP;
  if (after === null) return before + POSITION_GAP;
  return (before + after) / 2;
}

export function needsRebalance(before: number | null, after: number | null): boolean {
  return before !== null && after !== null && after - before < MIN_GAP;
}

export function rebalancePositions(count: number, gap = POSITION_GAP): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * gap);
}
