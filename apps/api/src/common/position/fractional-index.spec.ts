import {
  MIN_GAP,
  POSITION_GAP,
  midpoint,
  needsRebalance,
  rebalancePositions,
} from './fractional-index';

describe('fractional-index', () => {
  describe('midpoint', () => {
    it('returns the base gap for an empty column', () => {
      expect(midpoint(null, null)).toBe(POSITION_GAP);
    });

    it('places an insert at the top strictly below the current first', () => {
      const first = 1000;

      const position = midpoint(null, first);

      expect(position).toBeLessThan(first);
      expect(position).toBe(0);
    });

    it('places an insert at the bottom strictly above the current last', () => {
      const last = 3000;

      const position = midpoint(last, null);

      expect(position).toBeGreaterThan(last);
      expect(position).toBe(4000);
    });

    it('places an insert between two cards strictly between the neighbours', () => {
      const position = midpoint(1000, 2000);

      expect(position).toBeGreaterThan(1000);
      expect(position).toBeLessThan(2000);
      expect(position).toBe(1500);
    });

    it('keeps producing strictly increasing values when repeatedly inserting in the same gap', () => {
      let prev = 1000;
      const next = 2000;

      // Halve the gap until the rebalance guard would fire; every midpoint must stay strict.
      while (!needsRebalance(prev, next)) {
        const inserted = midpoint(prev, next);
        expect(inserted).toBeGreaterThan(prev);
        expect(inserted).toBeLessThan(next);
        prev = inserted;
      }

      expect(next - prev).toBeLessThan(MIN_GAP);
    });
  });

  describe('needsRebalance', () => {
    it('is false when either boundary is open', () => {
      expect(needsRebalance(null, null)).toBe(false);
      expect(needsRebalance(null, 1000)).toBe(false);
      expect(needsRebalance(1000, null)).toBe(false);
    });

    it('is false while the gap is comfortably above the minimum', () => {
      // The exact MIN_GAP boundary is float-rounding territory at large offsets,
      // so the contract is only asserted away from it.
      expect(needsRebalance(1000, 2000)).toBe(false);
      expect(needsRebalance(1000, 1000 + MIN_GAP * 2)).toBe(false);
    });

    it('is true once the gap drops below the minimum', () => {
      expect(needsRebalance(1000, 1000 + MIN_GAP / 2)).toBe(true);
      expect(needsRebalance(1000, 1000)).toBe(true);
    });
  });

  describe('rebalancePositions', () => {
    it('returns an empty list for zero elements', () => {
      expect(rebalancePositions(0)).toEqual([]);
    });

    it('places a single element at the base gap', () => {
      expect(rebalancePositions(1)).toEqual([POSITION_GAP]);
    });

    it('spaces elements evenly at the default gap', () => {
      expect(rebalancePositions(3)).toEqual([1000, 2000, 3000]);
    });

    it('honors a custom gap', () => {
      expect(rebalancePositions(2, 10)).toEqual([10, 20]);
    });

    it('produces strictly increasing positions that no longer need rebalancing', () => {
      const positions = rebalancePositions(50);

      for (let index = 1; index < positions.length; index += 1) {
        expect(positions[index]!).toBeGreaterThan(positions[index - 1]!);
        expect(needsRebalance(positions[index - 1]!, positions[index]!)).toBe(false);
      }
    });
  });
});
