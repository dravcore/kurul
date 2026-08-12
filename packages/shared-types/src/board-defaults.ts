/**
 * The column vocabulary a fresh board starts with.
 *
 * Both sides seed it: the API creates these rows with the board, and the web app offers the
 * same set as a one-click recovery for a board whose columns were all deleted. Held here
 * because the two lists were written out by hand in two places and nothing compared them —
 * a rename on one side would have left the other seeding a board the dashboard's completion
 * metrics no longer recognise, with no test or type error saying so.
 */

/** Seed column for a new board; `position` is Float (fractional indexing), never Int. */
export interface DefaultColumn {
  name: string;
  position: number;
}

/**
 * Dashboard completion metrics key off the Done column by name, so it is named once and
 * referenced — a rename only has to happen here.
 */
export const DONE_COLUMN_NAME = 'Done';

/** Ordered: index is the order a client seeding them one at a time must preserve. */
export const DEFAULT_COLUMNS: readonly DefaultColumn[] = [
  { name: 'To Do', position: 1000 },
  { name: 'In Progress', position: 2000 },
  { name: DONE_COLUMN_NAME, position: 3000 },
];
