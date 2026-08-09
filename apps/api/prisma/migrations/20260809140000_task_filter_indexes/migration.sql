-- CreateIndex
CREATE INDEX "Task_boardId_priority_idx" ON "Task"("boardId", "priority");

-- CreateIndex
CREATE INDEX "Task_boardId_dueDate_idx" ON "Task"("boardId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_boardId_id_idx" ON "Task"("boardId", "id");
