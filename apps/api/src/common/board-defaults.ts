/**
 * The column vocabulary a fresh board starts with, per locale.
 *
 * **Why this is API-side and not in `@kurultay/shared-types`.** These names are data the API
 * writes on the user's behalf, not interface text. ADR 0018 §3 draws the line by renameability:
 * a user can rename a column, so its name is user data — seeded once in the creator's language
 * and owned by the board from then on. Interface text is re-rendered from a catalog in each
 * *viewer's* language on every paint; a seed name is written once and never looked up again.
 *
 * The list used to live in the shared package because both apps seeded: the API on board
 * create, the web by replaying the same list one POST at a time. The web no longer seeds —
 * `POST /workspaces/:workspaceId/boards/:boardId/columns/defaults` does it in one transaction —
 * so the API is the only writer left, and a shared copy would ship every language's seed
 * vocabulary into the browser bundle for a list the browser never renders.
 *
 * What stays shared is which locales exist (`SUPPORTED_LOCALES`), because that genuinely
 * crosses the boundary: the web renders the picker from it and the API validates against it.
 *
 * See docs/decisions/0018-localization-strategy.md and
 * docs/decisions/0019-column-category.md.
 */
import { ColumnCategory, type Locale } from '@kurultay/shared-types';

/**
 * Seed column for a new board; `position` is Float (fractional indexing), never Int.
 *
 * `category` is spelled out per column rather than defaulted, because the seed list is the one
 * place where the intended meaning of each name is actually known — and once the name is
 * translated, the name itself stops being a usable signal (ADR 0019).
 */
export interface DefaultColumn {
  name: string;
  position: number;
  category: ColumnCategory;
}

/**
 * The locale-independent half: order, spacing and meaning.
 *
 * Held apart from the names so a translation cannot accidentally move a column or change what
 * it means. `board-defaults.spec.ts` asserts every locale produces this same structure.
 */
const SEED_COLUMNS = [
  { key: 'todo', position: 1000, category: ColumnCategory.UNSTARTED },
  { key: 'inProgress', position: 2000, category: ColumnCategory.STARTED },
  { key: 'done', position: 3000, category: ColumnCategory.COMPLETED },
] as const;

type SeedColumnKey = (typeof SEED_COLUMNS)[number]['key'];

/**
 * The locale-dependent half: what each column is called.
 *
 * Typed `Record<Locale, …>` deliberately. Adding a language to `SUPPORTED_LOCALES` makes this
 * object fail to compile until its names are supplied, so a new locale cannot ship seeding
 * boards in English by accident. That is the whole reason the two halves are separate tables
 * rather than one list per language: a second language is a list change here, not a change to
 * anything the resolution chain or the metrics layer reads.
 */
const SEED_COLUMN_NAMES: Record<Locale, Record<SeedColumnKey, string>> = {
  en: { todo: 'To Do', inProgress: 'In Progress', done: 'Done' },
};

/**
 * The columns a board is seeded with, named in `locale`.
 *
 * Returns a fresh array of fresh objects: callers hand these straight to Prisma's nested
 * create, and a shared mutable catalog would let one request's edit leak into the next board
 * anyone creates.
 */
export function defaultColumnsFor(locale: Locale): DefaultColumn[] {
  const names = SEED_COLUMN_NAMES[locale];
  return SEED_COLUMNS.map(({ key, position, category }) => ({
    name: names[key],
    position,
    category,
  }));
}
