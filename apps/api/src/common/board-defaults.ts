/**
 * The column vocabulary a fresh board starts with.
 *
 * Dashboard completion metrics key off the Done column, so the name lives here rather than
 * inline at each call site — a rename only has to happen once.
 */

export const DONE_COLUMN_NAME = 'Done';

/** Seed columns for a new board; positions are Float (fractional indexing). */
export const DEFAULT_COLUMNS: ReadonlyArray<{ name: string; position: number }> = [
  { name: 'To Do', position: 1000 },
  { name: 'In Progress', position: 2000 },
  { name: DONE_COLUMN_NAME, position: 3000 },
];

/**
 * Users rename and re-case their columns freely, so "done" is matched loosely everywhere:
 * this is the lowercased form the SQL and Prisma filters compare against.
 */
export const DONE_COLUMN_NAME_NORMALIZED = DONE_COLUMN_NAME.toLowerCase();

/** Prisma `where` fragment selecting the Done column(s) of a board. */
export const doneColumnNameFilter = {
  equals: DONE_COLUMN_NAME,
  mode: 'insensitive',
} as const;

export function isDoneColumnName(name: string): boolean {
  return name.trim().toLowerCase() === DONE_COLUMN_NAME_NORMALIZED;
}
