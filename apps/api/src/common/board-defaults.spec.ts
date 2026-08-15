import { ColumnCategory, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@kurultay/shared-types';
import { defaultColumnsFor } from './board-defaults';

/**
 * These are the invariants the seeding paths rely on and none of them checks. `BoardService`
 * writes this list in the nested create that makes a board; `ColumnService.createDefaults`
 * writes the same list into a board that lost its columns; the dashboard finds the completed
 * column by category. Nothing in the type system says the three agree.
 *
 * Every case runs against every supported locale: a translation that drops a column, reorders
 * the workflow or duplicates a name is a broken board in that language only, which is exactly
 * the kind of defect nobody sees until someone switches languages.
 */
describe('defaultColumnsFor', () => {
  describe.each(SUPPORTED_LOCALES)('locale %s', (locale) => {
    it('seeds a board with at least one column', () => {
      expect(defaultColumnsFor(locale).length).toBeGreaterThan(0);
    });

    it('seeds the same number of columns as every other locale', () => {
      // A translator who leaves an entry out must not produce a board with fewer stages.
      expect(defaultColumnsFor(locale)).toHaveLength(defaultColumnsFor(DEFAULT_LOCALE).length);
    });

    it('orders positions the same way the array is ordered', () => {
      const positions = defaultColumnsFor(locale).map((column) => column.position);

      expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
    });

    it('gives every column a distinct position', () => {
      const positions = defaultColumnsFor(locale).map((column) => column.position);

      // `position` is a Float for fractional indexing, so ties are not broken by array order
      // — two equal positions sort arbitrarily and the board comes out shuffled.
      expect(new Set(positions).size).toBe(positions.length);
    });

    it('leaves room to drop a column between any two neighbours', () => {
      const columns = defaultColumnsFor(locale);
      for (const [index, column] of columns.entries()) {
        expect(Number.isFinite(column.position)).toBe(true);

        const next = columns[index + 1];
        if (!next) continue;
        const midpoint = (column.position + next.position) / 2;
        expect(midpoint).toBeGreaterThan(column.position);
        expect(midpoint).toBeLessThan(next.position);
      }
    });

    it('names every column exactly once, and never blankly', () => {
      const names = defaultColumnsFor(locale).map((column) => column.name);

      // A duplicate gives the board two columns a person cannot tell apart; an empty string
      // gives them a column with no header at all.
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        expect(name.trim()).not.toBe('');
      }
    });

    it('seeds exactly one column the dashboard counts completions in', () => {
      const completed = defaultColumnsFor(locale).filter(
        (column) => column.category === ColumnCategory.COMPLETED,
      );

      // Under ADR 0019 completion is read from `category`, never from the name — which is
      // what lets these names be translated at all. A fresh board with no COMPLETED column
      // reports zero throughput forever; with two, every seeded board starts in the
      // multi-completed shape only a deliberate user split should produce.
      expect(completed).toHaveLength(1);
    });

    it('gives the categories the workflow order the positions already imply', () => {
      const rank: Record<ColumnCategory, number> = {
        [ColumnCategory.BACKLOG]: 0,
        [ColumnCategory.UNSTARTED]: 1,
        [ColumnCategory.STARTED]: 2,
        [ColumnCategory.COMPLETED]: 3,
        [ColumnCategory.CANCELED]: 4,
      };
      const ranks = defaultColumnsFor(locale).map((column) => rank[column.category]);

      expect(ranks).toStrictEqual([...ranks].sort((a, b) => a - b));
    });

    it('carries the same positions and categories as every other locale', () => {
      // Translation changes the label and nothing else. If a locale could shift a category,
      // the same board would report different metrics depending on who created it — the
      // precise failure ADR 0019 exists to prevent.
      const structure = defaultColumnsFor(locale).map(({ position, category }) => ({
        position,
        category,
      }));
      const reference = defaultColumnsFor(DEFAULT_LOCALE).map(({ position, category }) => ({
        position,
        category,
      }));

      expect(structure).toStrictEqual(reference);
    });
  });

  it('names the English seed columns the way the empty state advertises them', () => {
    // `messages/en.json`'s `app.board.column.emptyBody` tells the user they are about to get
    // "To Do, In Progress, and Done". This is the only assertion tying the promise to the
    // rows actually written.
    expect(defaultColumnsFor('en').map((column) => column.name)).toStrictEqual([
      'To Do',
      'In Progress',
      'Done',
    ]);
  });

  it('names the Turkish seed columns the way the Turkish empty state advertises them', () => {
    // The mirror of the assertion above, against `messages/tr.json`'s
    // `app.board.column.emptyBody` ("Yapılacak, Devam Ediyor ve Bitti"). Spelled out rather
    // than derived, because the two files cannot import one another and a promise the product
    // makes in one language is not checked by the other language's test.
    expect(defaultColumnsFor('tr').map((column) => column.name)).toStrictEqual([
      'Yapılacak',
      'Devam Ediyor',
      'Bitti',
    ]);
  });

  it('seeds a Turkish board with a completed column no name match could find', () => {
    // ADR 0019's own example. `Bitti` shares no substring with `done`, `complete` or
    // `finished`, so any reintroduced name-matching heuristic fails this test rather than
    // silently reporting zero throughput on every Turkish board.
    const completed = defaultColumnsFor('tr').find(
      (column) => column.category === ColumnCategory.COMPLETED,
    );

    expect(completed?.name).toBe('Bitti');
    expect(completed?.name.toLowerCase()).not.toContain('done');
  });

  it('returns a fresh array each call, so a caller cannot mutate the catalog', () => {
    const first = defaultColumnsFor(DEFAULT_LOCALE);
    first[0]!.name = 'mutated';

    expect(defaultColumnsFor(DEFAULT_LOCALE)[0]?.name).not.toBe('mutated');
  });
});
