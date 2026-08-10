-- Notification list (notification.service.ts `list`): `workspaceId` + `userId` are always
-- equality predicates, `id` carries both the cursor (`id < cursor`) and the sort
-- (`orderBy: id desc`). Equality columns first, ordering column last, so a page is a
-- backwards index range scan rather than a full fetch-and-sort of the user's notifications.
-- CreateIndex
CREATE INDEX "Notification_workspaceId_userId_id_idx" ON "Notification"("workspaceId", "userId", "id");

-- Same list with `unreadOnly: true`. `readAt IS NULL` is an equality match, so it goes
-- between the equality columns and the ordering column. The
-- (workspaceId, userId, readAt) prefix also serves `unreadCount` and `markAllRead`.
-- CreateIndex
CREATE INDEX "Notification_workspaceId_userId_readAt_id_idx" ON "Notification"("workspaceId", "userId", "readAt", "id");

-- Redundant: a strict prefix of Notification_workspaceId_userId_id_idx, which also keeps
-- the workspace foreign key's cascade delete indexed.
-- DropIndex
DROP INDEX "Notification_workspaceId_idx";

-- Redundant: every notification query is workspace-scoped (multi-tenant isolation rule), so
-- Notification_workspaceId_userId_readAt_id_idx covers everything this served.
-- Notification_userId_type_taskId_idx still leads with "userId" for the user cascade.
-- DropIndex
DROP INDEX "Notification_userId_readAt_idx";

-- Activity throughput aggregates (dashboard.service.ts `countActivitiesByDay`:
-- `workspaceId = ? AND type = ? AND createdAt >= ?`, grouped by day). Equality columns
-- lead, the range column is last, so the 14-day dashboard window touches only its own
-- workspace+type slice of the fastest-growing table in the schema.
-- CreateIndex
CREATE INDEX "Activity_workspaceId_type_createdAt_idx" ON "Activity"("workspaceId", "type", "createdAt");
