/**
 * Server-side view of the default board columns.
 *
 * The list itself lives in `@kurultay/shared-types` because the web app seeds the same
 * columns when a board is left with none; only the Prisma-shaped derivations below are
 * server concerns and stay here.
 */
import { DEFAULT_COLUMNS, DONE_COLUMN_NAME } from '@kurultay/shared-types';

export { DEFAULT_COLUMNS, DONE_COLUMN_NAME };

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
