import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeWorkerWithinTimeout, WORKER_CLOSE_TIMEOUT_MS } from './close-worker';
import type { ClosableWorker } from './close-worker';

function loggerStub() {
  return { warn: jest.fn() };
}

describe('closeWorkerWithinTimeout', () => {
  it('awaits a worker that closes on its own and never escalates', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const logger = loggerStub();

    await closeWorkerWithinTimeout(
      { close } as unknown as ClosableWorker,
      logger,
      'test worker',
      50,
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('resolves within the timeout and stops waiting when the job never finishes', async () => {
    // The shape this exists for: BullMQ's `close()` waits for the running job with no ceiling
    // of its own, so a retention sweep mid-run leaves this promise pending indefinitely.
    //
    // The `close(true)` below is asserted as a request, not as proof the run was aborted: this
    // is a plain mock, and against the real BullMQ a forced close during a close already in
    // flight returns that pending promise untouched. What the helper guarantees, and what the
    // elapsed-time assertion pins, is that the shutdown stops waiting.
    const close = jest.fn().mockReturnValue(new Promise<void>(() => {}));
    const logger = loggerStub();

    const started = Date.now();
    await closeWorkerWithinTimeout(
      { close } as unknown as ClosableWorker,
      logger,
      'test worker',
      40,
    );
    const elapsed = Date.now() - started;

    // Bounded near the 40ms budget, not "eventually": generous scheduler slack, still far
    // short of a hang.
    expect(elapsed).toBeLessThan(2_000);
    expect(close).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenLastCalledWith(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![0]).toContain('test worker');
  });

  it('does not let a rejected close escape the shutdown', async () => {
    const close = jest.fn().mockRejectedValue(new Error('redis gone'));
    const logger = loggerStub();

    await expect(
      closeWorkerWithinTimeout({ close } as unknown as ClosableWorker, logger, 'test worker', 50),
    ).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is a no-op for a worker that was never started', async () => {
    const logger = loggerStub();

    await expect(
      closeWorkerWithinTimeout(null, logger, 'test worker', 50),
    ).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps the default budget under the api container stop grace period', () => {
    // Read out of docker-compose.yml rather than hardcoded, so lowering `stop_grace_period`
    // without lowering this timeout fails here: the timeout has to leave the rest of the
    // shutdown (pool, Redis, mail, storage) room inside the grace period.
    const compose = readFileSync(join(__dirname, '../../../../docker-compose.yml'), 'utf8');
    const apiStart = compose.indexOf('\n  api:\n');
    expect(apiStart).toBeGreaterThan(-1);
    // Bounded at the next service key so the value cannot be read off a different service.
    const nextService = /\n {2}[a-z][a-z0-9_-]*:\n/.exec(compose.slice(apiStart + 1));
    const apiService = compose.slice(
      apiStart,
      nextService ? apiStart + 1 + nextService.index : undefined,
    );
    const graceSeconds = /\n {4}stop_grace_period: (\d+)s\n/.exec(apiService)?.[1];

    expect(graceSeconds).toBeDefined();
    expect(WORKER_CLOSE_TIMEOUT_MS).toBeLessThan(Number(graceSeconds) * 1_000);
  });
});
