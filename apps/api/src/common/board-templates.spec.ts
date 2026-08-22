import {
  ColumnCategory,
  DEFAULT_LOCALE,
  LabelColorSlot,
  SUPPORTED_LOCALES,
} from '@kurul/shared-types';
import { defaultColumnsFor } from './board-defaults';
import {
  BOARD_TEMPLATE_SLUGS,
  DEFAULT_BOARD_TEMPLATE,
  boardTemplateFor,
  boardTemplatesFor,
  isBoardTemplateSlug,
} from './board-templates';

/**
 * The invariants every template has to hold and nothing enforces at runtime.
 *
 * `board-defaults.spec.ts` makes these assertions about one list. A template is another list
 * written to the same rules by whoever adds it, months later, without reading them — so the
 * cases run over the whole catalog in every supported locale, and a new template inherits the
 * checks by existing rather than by someone remembering to copy them.
 */
describe('board templates', () => {
  const SLOTS = new Set<string>(Object.values(LabelColorSlot));

  it('offers at least three templates', () => {
    // The product's own acceptance bar. A catalog that quietly shrank to one is a picker with
    // nothing to pick.
    expect(BOARD_TEMPLATE_SLUGS.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every template a distinct slug', () => {
    expect(new Set(BOARD_TEMPLATE_SLUGS).size).toBe(BOARD_TEMPLATE_SLUGS.length);
  });

  it('opens on a slug that exists', () => {
    expect(BOARD_TEMPLATE_SLUGS).toContain(DEFAULT_BOARD_TEMPLATE);
  });

  it('accepts exactly the slugs it publishes', () => {
    for (const slug of BOARD_TEMPLATE_SLUGS) {
      expect(isBoardTemplateSlug(slug)).toBe(true);
    }
    // The guard runs on a value off the network, so the things a caller can actually send have
    // to be rejected rather than merely absent from the catalog.
    for (const impostor of ['', 'Kanban', 'kanban ', 'constructor', 'toString', '__proto__']) {
      expect(isBoardTemplateSlug(impostor)).toBe(false);
    }
    expect(isBoardTemplateSlug(undefined)).toBe(false);
    expect(isBoardTemplateSlug(null)).toBe(false);
    expect(isBoardTemplateSlug(1)).toBe(false);
  });

  describe.each(SUPPORTED_LOCALES)('locale %s', (locale) => {
    it('names every template and describes it, never blankly', () => {
      for (const template of boardTemplatesFor(locale)) {
        expect(template.name.trim()).not.toBe('');
        expect(template.description.trim()).not.toBe('');
      }
    });

    it('gives every template a name no other template shares', () => {
      // Two identically named cards in the picker are two cards nobody can choose between.
      const names = boardTemplatesFor(locale).map((template) => template.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('lists the templates in catalog order', () => {
      expect(boardTemplatesFor(locale).map((template) => template.slug)).toStrictEqual(
        BOARD_TEMPLATE_SLUGS,
      );
    });

    describe.each(BOARD_TEMPLATE_SLUGS)('%s', (slug) => {
      it('starts the board with at least two columns', () => {
        // One column is a list, not a board. Every template here is a workflow.
        expect(boardTemplateFor(slug, locale).columns.length).toBeGreaterThanOrEqual(2);
      });

      it('orders positions the same way the array is ordered', () => {
        const positions = boardTemplateFor(slug, locale).columns.map((column) => column.position);

        expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
      });

      it('gives every column a distinct position', () => {
        const positions = boardTemplateFor(slug, locale).columns.map((column) => column.position);

        // `position` is a Float for fractional indexing, so ties are not broken by array order
        // — two equal positions sort arbitrarily and the board comes out shuffled.
        expect(new Set(positions).size).toBe(positions.length);
      });

      it('leaves room to drop a column between any two neighbours', () => {
        const { columns } = boardTemplateFor(slug, locale);
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
        const names = boardTemplateFor(slug, locale).columns.map((column) => column.name);

        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
          expect(name.trim()).not.toBe('');
        }
      });

      it('has exactly one column the dashboard counts completions in', () => {
        const completed = boardTemplateFor(slug, locale).columns.filter(
          (column) => column.category === ColumnCategory.COMPLETED,
        );

        // Under ADR 0019 completion is read from `category`, never from the name. A template
        // with no COMPLETED column reports zero throughput forever; with two, every board made
        // from it starts in the multi-completed shape only a deliberate user split should
        // produce.
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
        const ranks = boardTemplateFor(slug, locale).columns.map((column) => rank[column.category]);

        expect(ranks).toStrictEqual([...ranks].sort((a, b) => a - b));
      });

      it('presets at least one label, painted from a slot and never a hex value', () => {
        const { labels } = boardTemplateFor(slug, locale);

        // The acceptance bar again: a template sets columns *and* labels. The colour check is
        // the repo-wide rule — `Label.color` is a theme-resolved token, so a hex here would
        // render as an unknown slot and fall back to slot-1 on every board made from it.
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
          expect(SLOTS.has(label.color)).toBe(true);
        }
      });

      it('names every label exactly once, and never blankly', () => {
        const names = boardTemplateFor(slug, locale).labels.map((label) => label.name);

        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
          expect(name.trim()).not.toBe('');
        }
      });

      it('paints every label a different slot', () => {
        const colors = boardTemplateFor(slug, locale).labels.map((label) => label.color);

        // Two chips in one colour is a preset that reads as a mistake on the first board that
        // uses it, and there are eight slots against a preset of at most six labels.
        expect(new Set(colors).size).toBe(colors.length);
      });

      it('carries the same structure as every other locale', () => {
        // Translation changes the label and nothing else. If a locale could shift a category
        // or repaint a chip, the same template would produce different boards depending on who
        // created them — the failure ADR 0019 exists to prevent, one level up.
        const structure = (tag: typeof locale) => ({
          columns: boardTemplateFor(slug, tag).columns.map(({ position, category }) => ({
            position,
            category,
          })),
          labels: boardTemplateFor(slug, tag).labels.map(({ color }) => color),
        });

        expect(structure(locale)).toStrictEqual(structure(DEFAULT_LOCALE));
      });

      it('returns fresh objects each call, so a caller cannot mutate the catalog', () => {
        const first = boardTemplateFor(slug, locale);
        first.columns[0]!.name = 'mutated';
        first.labels[0]!.name = 'mutated';

        const second = boardTemplateFor(slug, locale);
        expect(second.columns[0]?.name).not.toBe('mutated');
        expect(second.labels[0]?.name).not.toBe('mutated');
      });
    });
  });

  describe('the default template', () => {
    it.each(SUPPORTED_LOCALES)('is the seed every board already gets, in %s', (locale) => {
      // The load-bearing assertion of this file. `defaultColumnsFor` is now a call into the
      // catalog, so a change to the Kanban entry is a change to every board created without a
      // template — including the ones `board.e2e-spec.ts` and the Trello importer make. If
      // this ever needs updating, the update is a product decision, not a refactor.
      expect(boardTemplateFor(DEFAULT_BOARD_TEMPLATE, locale).columns).toStrictEqual(
        defaultColumnsFor(locale),
      );
    });

    it('names the English columns the way the empty state advertises them', () => {
      // `messages/en.json`'s `app.board.column.emptyBody` tells the user they are about to get
      // "To Do, In Progress, and Done".
      expect(
        boardTemplateFor(DEFAULT_BOARD_TEMPLATE, 'en').columns.map((column) => column.name),
      ).toStrictEqual(['To Do', 'In Progress', 'Done']);
    });

    it('names the Turkish columns the way the Turkish empty state advertises them', () => {
      // The mirror, against `messages/tr.json`'s `app.board.column.emptyBody`.
      expect(
        boardTemplateFor(DEFAULT_BOARD_TEMPLATE, 'tr').columns.map((column) => column.name),
      ).toStrictEqual(['Yapılacak', 'Devam Ediyor', 'Bitti']);
    });
  });

  it('gives the triage template somewhere to put a report it will not act on', () => {
    // The only CANCELED column in the catalog, and the reason ADR 0019 shipped the value with
    // no consumer. Without it a "won't fix" is either counted as throughput or left open.
    const canceled = boardTemplateFor('bug-triage', 'en').columns.filter(
      (column) => column.category === ColumnCategory.CANCELED,
    );

    expect(canceled).toHaveLength(1);
  });

  it('translates a completed column into a name no substring match could find', () => {
    // ADR 0019's own example, applied to the templates that added a Turkish "Bitti"/"Kapandı".
    for (const slug of BOARD_TEMPLATE_SLUGS) {
      const completed = boardTemplateFor(slug, 'tr').columns.find(
        (column) => column.category === ColumnCategory.COMPLETED,
      );

      expect(completed?.name.toLowerCase()).not.toContain('done');
      expect(completed?.name.toLowerCase()).not.toContain('complete');
    }
  });
});
