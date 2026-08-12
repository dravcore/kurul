/**
 * The column vocabulary a fresh board starts with.
 *
 * Both sides seed it: the API creates these rows with the board, and the web app offers the
 * same set as a one-click recovery for a board whose columns were all deleted. Held here
 * because the two lists were written out by hand in two places and nothing compared them —
 * a rename on one side would have left the other seeding a board the dashboard's completion
 * metrics no longer recognise, with no test or type error saying so.
 */
import { ColumnCategory } from './enums.js';

/**
 * Seed column for a new board; `position` is Float (fractional indexing), never Int.
 *
 * `category` is spelled out per column rather than defaulted, because the seed list is the
 * one place where the intended meaning of each name is actually known — and under
 * [ADR 0018](../../../docs/decisions/0018-localization-strategy.md) these names are
 * translated at the point of seeding, at which point the name stops being a usable signal.
 */
export interface DefaultColumn {
  name: string;
  position: number;
  category: ColumnCategory;
}

/** Ordered: index is the order a client seeding them one at a time must preserve. */
export const DEFAULT_COLUMNS: readonly DefaultColumn[] = [
  { name: 'To Do', position: 1000, category: ColumnCategory.UNSTARTED },
  { name: 'In Progress', position: 2000, category: ColumnCategory.STARTED },
  // No `DONE_COLUMN_NAME` constant any more: nothing matches on this string, so naming it
  // once bought nothing but the impression that something still did.
  { name: 'Done', position: 3000, category: ColumnCategory.COMPLETED },
];
