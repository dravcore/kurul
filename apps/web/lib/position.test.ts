import { describe, expect, it } from 'vitest';
import { midpoint } from './position';

describe('midpoint', () => {
  it('returns the base position for an empty column', () => {
    expect(midpoint(null, null)).toBe(1000);
  });

  it('places a card dropped at the top strictly below the current first', () => {
    expect(midpoint(null, 1000)).toBeLessThan(1000);
  });

  it('places a card dropped at the bottom strictly above the current last', () => {
    expect(midpoint(3000, null)).toBeGreaterThan(3000);
  });

  it('places a card dropped between neighbours strictly between them', () => {
    const position = midpoint(1000, 2000);

    expect(position).toBeGreaterThan(1000);
    expect(position).toBeLessThan(2000);
  });

  it('mirrors the API helper for the shared inputs', () => {
    // The doc comment promises parity with apps/api fractional-index midpoint.
    expect(midpoint(null, null)).toBe(1000);
    expect(midpoint(null, 500)).toBe(-500);
    expect(midpoint(500, null)).toBe(1500);
    expect(midpoint(1000, 3000)).toBe(2000);
  });
});
