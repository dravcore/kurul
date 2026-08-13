/**
 * Upper bound for a single readiness probe.
 *
 * A readiness endpoint that can hang is worse than one that answers `down`: the caller is an
 * orchestrator (a compose healthcheck, a load balancer), and every hanging probe holds a
 * connection open until *its* timeout fires, then retries into the same wedge. Two seconds is
 * far above a healthy `SELECT 1` / `PING` and far below any sane probe interval.
 */
export const PROBE_TIMEOUT_MS = 2_000;

export class ProbeTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} probe timed out after ${timeoutMs}ms`);
    this.name = 'ProbeTimeoutError';
  }
}

/**
 * Settles with `work`, or rejects once `timeoutMs` has elapsed.
 *
 * The loser is not cancelled — a query already in flight against a wedged Postgres keeps
 * running until the driver gives up on it. What this buys is a bounded *response*: readiness
 * reports the dependency as down instead of leaving the probe hanging on it.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  label: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    // Without this the pending timer keeps the event loop alive for the rest of the budget
    // after a fast, healthy probe — long enough to hold a Jest worker (and a process that is
    // trying to shut down) open on every single request.
    clearTimeout(timer);
  }
}
