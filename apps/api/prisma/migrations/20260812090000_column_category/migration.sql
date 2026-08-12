-- Column completion becomes a category instead of a name
-- (docs/decisions/0019-column-category.md).
--
-- Dashboard completion and throughput metrics matched the Done column by name. A user who
-- renamed it to "Shipped" silently zeroed their metrics, and ADR 0018 (seed columns in the
-- creator's locale) would have made that the default for every non-English board.

-- CreateEnum
CREATE TYPE "ColumnCategory" AS ENUM ('BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED');

-- AlterTable
-- UNSTARTED rather than BACKLOG as the default: a freshly created column is active work in
-- WIP terms, which is how people actually use one.
ALTER TABLE "Column" ADD COLUMN "category" "ColumnCategory" NOT NULL DEFAULT 'UNSTARTED';

-- Backfill: the only intent recoverable from existing data is the name the old matcher
-- itself keyed off, so the rule here is exactly the predicate being retired —
-- `equals: 'Done', mode: 'insensitive'`, plus the trim the throughput SQL applied. A board
-- whose done column was already renamed to something else cannot be recovered: an arbitrary
-- name carries no intent, and guessing at synonyms would reintroduce the matching this
-- migration exists to remove. Those boards report zero completions until someone sets the
-- category by hand; CHANGELOG.md flags that as a one-time upgrade step.
UPDATE "Column" SET "category" = 'COMPLETED' WHERE lower(btrim("name")) = 'done';

-- CreateIndex
-- Every dashboard read resolves the board's completed columns; without this the category
-- predicate is a heap filter on top of the boardId index.
CREATE INDEX "Column_boardId_category_idx" ON "Column"("boardId", "category");
