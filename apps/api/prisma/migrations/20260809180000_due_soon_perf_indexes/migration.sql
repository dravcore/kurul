-- Support global due-soon scans (no boardId predicate).
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- At most one unread due_soon per user+task (worker createMany skipDuplicates).
CREATE UNIQUE INDEX "Notification_due_soon_unread_uidx"
ON "Notification" ("userId", "taskId")
WHERE "type" = 'due_soon' AND "readAt" IS NULL AND "taskId" IS NOT NULL;
