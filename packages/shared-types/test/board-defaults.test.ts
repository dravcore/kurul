import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS } from '../src/board-defaults.js';
import { ColumnCategory } from '../src/enums.js';

/**
 * These are the invariants the two seeders rely on and neither one checks. The API creates
 * `DEFAULT_COLUMNS` in a single nested write; the web app replays the same list one request
 * at a time as a recovery action; the dashboard finds the completed column by category.
 * Nothing in the type system says the three agree, which is the reason the list was
 * centralised.
 */
describe('DEFAULT_COLUMNS', () => {
  it('seeds a board with at least one column', () => {
    expect(DEFAULT_COLUMNS.length).toBeGreaterThan(0);
  });

  it('orders positions the same way the array is ordered', () => {
    const positions = DEFAULT_COLUMNS.map((column) => column.position);

    // The API writes all three at once and lets `position` order them; the web app seeds them
    // in array order. If the two disagree, the same action produces two different boards.
    expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
  });

  it('gives every column a distinct position', () => {
    const positions = DEFAULT_COLUMNS.map((column) => column.position);

    // `position` is a Float for fractional indexing, so ties are not broken by the column
    // order — two equal positions sort arbitrarily and the board comes out shuffled.
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('leaves room to drop a column between any two neighbours', () => {
    for (const [index, column] of DEFAULT_COLUMNS.entries()) {
      expect(Number.isFinite(column.position)).toBe(true);

      const next = DEFAULT_COLUMNS[index + 1];
      if (!next) continue;
      const midpoint = (column.position + next.position) / 2;
      expect(midpoint).toBeGreaterThan(column.position);
      expect(midpoint).toBeLessThan(next.position);
    }
  });

  it('names every column exactly once', () => {
    const names = DEFAULT_COLUMNS.map((column) => column.name);

    // A duplicate name gives the board two columns a person cannot tell apart, and makes any
    // name-keyed lookup in a client pick one of the two at random.
    expect(new Set(names).size).toBe(names.length);
  });

  it('seeds exactly one column the dashboard counts completions in', () => {
    const completed = DEFAULT_COLUMNS.filter(
      (column) => column.category === ColumnCategory.COMPLETED,
    );

    // Under ADR 0019 completion is read from `category`, never from the name — which is what
    // lets the seed names be translated. A fresh board with no COMPLETED column reports zero
    // throughput forever; with two, every seeded board starts in the multi-completed shape
    // that only a deliberate user split should produce.
    expect(completed).toHaveLength(1);
  });

  it('gives the categories the workflow order the positions already imply', () => {
    // Reading the board left to right should not walk backwards through the workflow. This is
    // the one place the two orderings are stated together, so it is the only place they can be
    // checked against each other.
    const rank: Record<ColumnCategory, number> = {
      [ColumnCategory.BACKLOG]: 0,
      [ColumnCategory.UNSTARTED]: 1,
      [ColumnCategory.STARTED]: 2,
      [ColumnCategory.COMPLETED]: 3,
      [ColumnCategory.CANCELED]: 4,
    };
    const ranks = DEFAULT_COLUMNS.map((column) => rank[column.category]);

    expect(ranks).toStrictEqual([...ranks].sort((a, b) => a - b));
  });
});
