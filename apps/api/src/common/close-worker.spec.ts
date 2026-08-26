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

  it('resolves within the timeout and forces the close when the job never finishes', async () => {
    // The shape this exists for: BullMQ's `close()` waits for the running job with no ceiling
    // of its own, so a retention sweep mid-run leaves this promise pending indefinitely.
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
    // docker-compose.yml gives `api` `stop_grace_period: 30s`; this timeout has to leave the
    // rest of the shutdown (pool, Redis, mail, storage) room inside it.
    expect(WORKER_CLOSE_TIMEOUT_MS).toBeLessThan(30_000);
  });
});
