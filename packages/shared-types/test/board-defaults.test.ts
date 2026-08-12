import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, DONE_COLUMN_NAME } from '../src/board-defaults.js';

/**
 * These are the invariants the two seeders rely on and neither one checks. The API creates
 * `DEFAULT_COLUMNS` in a single nested write; the web app replays the same list one request
 * at a time as a recovery action; the dashboard finds the completed column by name. Nothing
 * in the type system says the three agree, which is the reason the list was centralised.
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

    // Columns are addressed by name across the stack, `DONE_COLUMN_NAME` included, so a
    // duplicate makes those lookups pick one of two rows at random.
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes the column the dashboard counts completions in', () => {
    const names = DEFAULT_COLUMNS.map((column) => column.name);

    // Renaming the Done column without renaming the constant leaves a board whose completion
    // metrics silently read zero — no type error, no failing query, just wrong numbers.
    expect(names).toContain(DONE_COLUMN_NAME);
  });
});

describe('DONE_COLUMN_NAME', () => {
  it('matches itself under the normalisation the dashboard query applies', () => {
    // `apps/api/src/common/board-defaults.ts` compares `lower(trim(column))` in SQL against
    // `DONE_COLUMN_NAME.toLowerCase()` — which trims nothing. Padding here would make that
    // comparison never match anything.
    expect(DONE_COLUMN_NAME).toBe(DONE_COLUMN_NAME.trim());
    expect(DONE_COLUMN_NAME.length).toBeGreaterThan(0);
  });
});
