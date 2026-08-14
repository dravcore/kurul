-- Give the nightly retention sweeps in `retention/cleanup.worker.ts` an index to stand on.
--
-- Measured before writing this, at production-like volume (50k Session, 20k Verification,
-- 50k UsagePing, 120k Activity, 120k Notification) in the state that actually matters: the
-- steady state, where the backlog is already clean and every sweep finds nothing. The batch
-- `LIMIT` bounds how long a row lock is held, not how much of the table is read — each batch
-- is its own scan, so an unindexed sweep pays for the whole table every night forever.
--
--   Session       Seq Scan, 516 buffers, 50000 rows removed by filter
--   Verification  Seq Scan, 206 buffers, 20000 rows removed by filter
--   UsagePing     Seq Scan, 416 buffers, 50000 rows removed by filter
--
-- The other two sweeps named in issue #187 were measured too and are left alone: `Activity`
-- already uses `Activity_workspaceId_createdAt_idx` and `Notification` already uses
-- `Notification_workspaceId_userId_readAt_id_idx`, both by skip scan, despite neither query
-- constraining the leading `workspaceId`. The issue predicted otherwise from the column order;
-- the plans disagree. Adding indexes there would have repeated DB-07's mistake in the other
-- direction — the two fastest-growing tables in the schema were the two that did not need it.
--
-- `UsagePing` gets a second date index rather than having the sweep switch to the `day` column
-- that `UsagePing_day_idx` already covers. `day` is the day being recorded; `createdAt` is when
-- the row was written, and "kept for N days after it was written" is what ADR 0020's window
-- means. The columns agree for every row this code writes today and would diverge under a
-- backfill, which is exactly when a retention policy must not quietly change meaning.

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

-- CreateIndex
CREATE INDEX "UsagePing_createdAt_idx" ON "UsagePing"("createdAt");
