import type { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';

/**
 * How long a shutdown waits for a BullMQ worker to hand back the job it is running.
 *
 * `worker.close()` resolves only once the processor currently in flight returns, and BullMQ
 * puts no ceiling on that wait. The retention sweep is the case that matters: a first run on
 * an instance with years of history walks six tables in batches plus an orphan file sweep, so
 * it is measured in minutes, not seconds. Waiting it out would hold the whole shutdown open
 * past the container's stop grace period and turn an ordinary `docker compose up -d` into a
 * SIGKILL, which skips every remaining hook (the pg pool, the Redis clients, the mail
 * transport) instead of releasing them.
 *
 * Five seconds is sized as "long enough for a job that is already finishing", not as a budget
 * for a whole run: a short job wins the race, a long one is abandoned. It has to stay well
 * under `stop_grace_period` on the `api` service in docker-compose.yml, which is what gives
 * the rest of the shutdown room to finish after this timeout fires.
 */
export const WORKER_CLOSE_TIMEOUT_MS = 5_000;

/** The slice of BullMQ's `Worker` this helper drives, so a spec can hand it a plain object. */
export type ClosableWorker = Pick<Worker, 'close'>;

/**
 * Closes a BullMQ worker without letting an in-flight job hold the shutdown open.
 *
 * Abandoning a run is safe because both scheduled jobs in this codebase are idempotent by
 * construction, and BullMQ re-delivers the interrupted attempt rather than losing it: the job
 * stays `active` with no worker renewing its lock, the stalled check moves it back to `wait`,
 * and the next instance picks it up from the top. `CleanupWorker.process` re-selects whatever
 * is still eligible (`DELETE ... WHERE expiresAt < now`), so rows an abandoned attempt already
 * removed simply match nothing the second time; `DueSoonWorker.process` inserts with
 * `skipDuplicates`, so a re-run creates no second notification. Neither double-counts, and
 * neither leaves a partial write a retry cannot land on top of.
 *
 * On timeout the forced close is requested but deliberately not awaited. `Worker.close(force)`
 * returns the close already in flight when one exists (bullmq 6.1.2 `worker.js`), so awaiting
 * it here would simply re-enter the same unbounded wait this helper exists to escape. What
 * actually unblocks the run is the rest of the shutdown phase continuing behind this call:
 * once the shared pg pool is ended the sweep's next query rejects, the processor unwinds, and
 * the worker's own connections close on their way out.
 */
export async function closeWorkerWithinTimeout(
  worker: ClosableWorker | null | undefined,
  logger: Pick<Logger, 'warn'>,
  label: string,
  timeoutMs: number = WORKER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (!worker) return;

  // Settled either way: a worker that fails to close must not strand the rest of the shutdown,
  // and an unobserved rejection here would surface as an unhandled rejection during exit.
  const graceful = worker.close().then(
    () => true,
    () => true,
  );

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  const closed = await Promise.race([graceful, deadline]);
  clearTimeout(timer);
  if (closed) return;

  logger.warn(
    `${label} did not stop within ${timeoutMs}ms; abandoning the run so shutdown can finish. ` +
      'BullMQ re-delivers the interrupted attempt on the next start.',
  );
  void worker.close(true).catch(() => undefined);
}
