-- Backs `q` free-text search (title/description `contains`, case-insensitive) in
-- task.service.ts with trigram GIN indexes instead of a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Task_title_idx" ON "Task" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Task_description_idx" ON "Task" USING GIN ("description" gin_trgm_ops);
