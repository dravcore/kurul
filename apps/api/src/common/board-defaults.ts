/**
 * The column vocabulary a fresh board starts with, per locale.
 *
 * **Why this is API-side and not in `@kurul/shared-types`.** These names are data the API
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
 * **Where the names actually live now.** `board-templates.ts` holds the catalog, and this
 * module is the one entry it still has a separate name for: the default seed. The structure
 * and name tables this file used to own are the Kanban template's two halves, and keeping a
 * second copy of them here would let the board every client already creates drift from the
 * template the picker calls by the same name.
 *
 * See docs/decisions/0018-localization-strategy.md and
 * docs/decisions/0019-column-category.md.
 */
import type { ColumnCategory, Locale } from '@kurul/shared-types';
import { DEFAULT_BOARD_TEMPLATE, boardTemplateFor } from './board-templates';

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
 * The columns a board is seeded with, named in `locale`.
 *
 * These are the Kanban template's columns, and nothing else: a board created with no template
 * named is a Kanban board that was not asked for by name. What it is *not* is the whole
 * template — the label preset is only written when a client picks a template explicitly, so
 * that every board every existing client has ever created still comes out with an empty label
 * list (`BoardService.create` states the same thing from the other side).
 *
 * Returns a fresh array of fresh objects: callers hand these straight to Prisma's nested
 * create, and a shared mutable catalog would let one request's edit leak into the next board
 * anyone creates.
 */
export function defaultColumnsFor(locale: Locale): DefaultColumn[] {
  return boardTemplateFor(DEFAULT_BOARD_TEMPLATE, locale).columns;
}
