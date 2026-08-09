import {
  MIN_GAP,
  POSITION_GAP,
  midpoint,
  needsRebalance,
  rebalancePositions,
} from './fractional-index';

describe('fractional index helpers', () => {
  it('calculates positions at both unbounded edges and between neighbors', () => {
    expect(midpoint(null, null)).toBe(POSITION_GAP);
    expect(midpoint(2000, null)).toBe(3000);
    expect(midpoint(null, 1000)).toBe(0);
    expect(midpoint(1000, 2000)).toBe(1500);
  });

  it('detects when neighboring positions can no longer be safely subdivided', () => {
    expect(needsRebalance(1000, 1000 + MIN_GAP / 2)).toBe(true);
    expect(needsRebalance(1000, 1001)).toBe(false);
    expect(needsRebalance(null, 1000)).toBe(false);
  });

  it('rebalances positions at a consistent gap', () => {
    expect(rebalancePositions(3)).toEqual([1000, 2000, 3000]);
    expect(rebalancePositions(2, 10)).toEqual([10, 20]);
  });
});
