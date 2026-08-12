/**
 * Server-side view of the default board columns.
 *
 * The list itself lives in `@kurultay/shared-types` because the web app seeds the same
 * columns when a board is left with none, and it now carries each column's
 * {@link ColumnCategory} with it — so nothing Prisma-shaped is left to derive here.
 *
 * This file previously exported `DONE_COLUMN_NAME`, `DONE_COLUMN_NAME_NORMALIZED` and
 * `doneColumnNameFilter`, the vocabulary that let the dashboard find the Done column by name.
 * All three are gone: completion is `category: 'COMPLETED'` now
 * (docs/decisions/0019-column-category.md). The re-export stays so callers keep one import
 * path for board seeding.
 */
import { DEFAULT_COLUMNS } from '@kurultay/shared-types';

export { DEFAULT_COLUMNS };
