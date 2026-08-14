import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLEANUP_BATCH_SIZE,
  CleanupWorker,
  MAX_BATCHES_PER_TABLE,
  cutoffFor,
  retentionSettings,
} from './cleanup.worker';

// Same stub as the due-soon worker's spec: the registration tests need to see what the worker
// asks BullMQ for, without a Redis for it to ask against.
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    upsertJobScheduler: jest.fn().mockResolvedValue({ id: 'retention-cleanup' }),
    close: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

const RETENTION_ENV = [
  'CLEANUP_ENABLED',
  'NOTIFICATION_RETENTION_DAYS',
  'ACTIVITY_RETENTION_DAYS',
  'REDIS_URL',
] as const;

/** A frozen "now" so every cutoff in these tests is arithmetic, not a race with the clock. */
const NOW = new Date('2026-08-14T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

type ExecuteRawCall = [TemplateStringsArray, ...unknown[]];

function statementOf(call: ExecuteRawCall): string {
  return call[0].join('?').replace(/\s+/g, ' ').trim();
}

describe('CleanupWorker', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of RETENTION_ENV) saved.set(key, process.env[key]);
  });

  afterEach(() => {
    for (const key of RETENTION_ENV) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.clearAllMocks();
  });

  function buildWorker(deleted: number[] = []): {
    worker: CleanupWorker;
    executeRaw: jest.Mock;
    lines: string[];
  } {
    const executeRaw = jest.fn().mockResolvedValue(0);
    for (const count of deleted) executeRaw.mockResolvedValueOnce(count);

    const prisma = { $executeRaw: executeRaw } as unknown as PrismaService;
    const worker = new CleanupWorker(prisma);
    const lines: string[] = [];
    worker.setLogWriter((line) => lines.push(line));

    return { worker, executeRaw, lines };
  }

  function callsFor(executeRaw: jest.Mock, table: string): ExecuteRawCall[] {
    return (executeRaw.mock.calls as ExecuteRawCall[]).filter((call) =>
      statementOf(call).includes(`DELETE FROM "${table}"`),
    );
  }

  describe('what it selects', () => {
    it('sweeps all five tables in one run and reports each table separately', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker([3, 2, 7, 5, 4]);

      await expect(worker.runCleanup(NOW)).resolves.toEqual({
        sessions: 3,
        verifications: 2,
        notifications: 7,
        activities: 5,
        usagePings: 4,
      });

      // One statement per table: each batch came back short, so no table looped.
      expect(executeRaw).toHaveBeenCalledTimes(5);
      for (const table of ['Session', 'Verification', 'Notification', 'Activity', 'UsagePing']) {
        expect(callsFor(executeRaw, table)).toHaveLength(1);
      }
    });

    /**
     * Usage pings share ACTIVITY_RETENTION_DAYS rather than carrying a window of their own —
     * same class of row, one decision for the operator to make. The window runs from
     * `createdAt`, which is what "kept for N days after it was written" means.
     */
    it('sweeps UsagePing on the activity window, measured from createdAt', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.ACTIVITY_RETENTION_DAYS = '30';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'UsagePing');
      expect(statementOf(call!)).toContain('WHERE "createdAt" < ?');
      expect(call![1]).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
    });

    /** `0` means "keep forever" for pings exactly as it does for the activity rows. */
    it('issues no UsagePing statement when the activity window is disabled', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.ACTIVITY_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'UsagePing')).toHaveLength(0);
    });

    it('deletes a Session strictly before its own expiry, never one expiring exactly now', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Session');
      // `<`, not `<=`: a session whose expiresAt is exactly the sweep instant is still a live
      // session for that instant, and deleting it would sign somebody out a beat early.
      expect(statementOf(call!)).toContain('WHERE "expiresAt" < ?');
      expect(call![1]).toEqual(NOW);
      expect(call![2]).toBe(CLEANUP_BATCH_SIZE);
    });

    it('deletes a Verification on the same strict expiry comparison', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Verification');
      expect(statementOf(call!)).toContain('WHERE "expiresAt" < ?');
      expect(call![1]).toEqual(NOW);
    });

    it('only ever deletes a read Notification, and only one read before the cutoff', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.NOTIFICATION_RETENTION_DAYS;
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Notification');
      // Unread is untouched at any age: it is still the thing the user was told is waiting.
      expect(statementOf(call!)).toContain('WHERE "readAt" IS NOT NULL AND "readAt" < ?');
      // Default window, measured from readAt: 90 days.
      expect(call![1]).toEqual(new Date(NOW.getTime() - 90 * DAY_MS));
    });

    it('honours NOTIFICATION_RETENTION_DAYS, to the second', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.NOTIFICATION_RETENTION_DAYS = '30';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const cutoff = callsFor(executeRaw, 'Notification')[0]![1] as Date;
      expect(cutoff).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
      // A row read exactly at the cutoff is outside `readAt < cutoff` and survives; a row read
      // one second earlier is inside it. Nothing between those two instants is ambiguous.
      expect(cutoff.getTime()).toBeGreaterThan(
        new Date(NOW.getTime() - 30 * DAY_MS - 1000).getTime(),
      );
    });

    it('measures the Activity window from createdAt, since an activity is never "read"', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.ACTIVITY_RETENTION_DAYS;
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Activity');
      expect(statementOf(call!)).toContain('WHERE "createdAt" < ?');
      expect(call![1]).toEqual(new Date(NOW.getTime() - 365 * DAY_MS));
    });

    it('bounds every statement with the batch size', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      for (const call of executeRaw.mock.calls as ExecuteRawCall[]) {
        expect(statementOf(call)).toContain('LIMIT ?');
        expect(call[call.length - 1]).toBe(CLEANUP_BATCH_SIZE);
      }
    });
  });

  describe('retention windows that mean "keep forever"', () => {
    it('issues no Notification statement when NOTIFICATION_RETENTION_DAYS is 0', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.NOTIFICATION_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      const counts = await worker.runCleanup(NOW);

      expect(counts.notifications).toBe(0);
      expect(callsFor(executeRaw, 'Notification')).toHaveLength(0);
      // The expiry sweeps are not configurable and keep running.
      expect(callsFor(executeRaw, 'Session')).toHaveLength(1);
    });

    it('issues no Activity statement when ACTIVITY_RETENTION_DAYS is 0', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.ACTIVITY_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      const counts = await worker.runCleanup(NOW);

      expect(counts.activities).toBe(0);
      expect(callsFor(executeRaw, 'Activity')).toHaveLength(0);
    });

    it('refuses a negative window instead of turning it into a cutoff in the future', () => {
      process.env.ACTIVITY_RETENTION_DAYS = '-1';

      // A future cutoff would delete live rows. Boot loudly rather than sweep wrongly.
      expect(() => retentionSettings()).toThrow(/ACTIVITY_RETENTION_DAYS/);
    });
  });

  describe('CLEANUP_ENABLED=false', () => {
    it('deletes nothing and issues no statement', async () => {
      process.env.CLEANUP_ENABLED = 'false';
      const { worker, executeRaw, lines } = buildWorker([10, 10, 10, 10]);

      await expect(worker.runCleanup(NOW)).resolves.toEqual({
        sessions: 0,
        verifications: 0,
        notifications: 0,
        activities: 0,
        usagePings: 0,
      });
      expect(executeRaw).not.toHaveBeenCalled();
      expect(lines).toEqual([]);
    });

    it('starts no queue and no scheduler', async () => {
      process.env.CLEANUP_ENABLED = 'false';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { worker } = buildWorker();

      await worker.onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
      await worker.onModuleDestroy();
    });
  });

  describe('batching', () => {
    it('keeps deleting a table while its batches come back full', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      // Session: full, full, short. Then one short batch for each remaining table.
      const { worker, executeRaw } = buildWorker([CLEANUP_BATCH_SIZE, CLEANUP_BATCH_SIZE, 4]);

      const counts = await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'Session')).toHaveLength(3);
      expect(counts.sessions).toBe(CLEANUP_BATCH_SIZE * 2 + 4);
      // The short batch is the exit condition, so the other tables are still swept.
      expect(callsFor(executeRaw, 'Verification')).toHaveLength(1);
    });

    it('stops at the per-table ceiling rather than looping against the database forever', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      // Always a full batch — the shape a broken predicate would produce.
      const executeRaw = jest.fn().mockResolvedValue(CLEANUP_BATCH_SIZE);
      const worker = new CleanupWorker({ $executeRaw: executeRaw } as unknown as PrismaService);
      worker.setLogWriter(() => {});

      await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'Session')).toHaveLength(MAX_BATCHES_PER_TABLE);
    });
  });

  describe('the log line', () => {
    it('emits one JSON line carrying the per-table counts and nothing from the rows', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, lines } = buildWorker([3, 2, 7, 5, 4]);

      await worker.runCleanup(NOW);

      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(line).toMatchObject({
        level: 'info',
        event: 'retention.cleanup',
        sessions: 3,
        verifications: 2,
        notifications: 7,
        activities: 5,
        usagePings: 4,
      });
      expect(typeof line.ts).toBe('string');
      expect(typeof line.durationMs).toBe('number');
      // Counts only. Anything identifying — an IP, a user agent, an e-mail, a task title —
      // would be the very data this job exists to delete, copied into a log aggregator on its
      // way out. The field list is closed for that reason.
      expect(Object.keys(line).sort()).toEqual([
        'activities',
        'durationMs',
        'event',
        'level',
        'notifications',
        'sessions',
        'ts',
        'usagePings',
        'verifications',
      ]);
    });

    it('still reports a run that deleted nothing', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, lines } = buildWorker();

      await worker.runCleanup(NOW);

      // A silent job and an unscheduled job look identical in a log; the zero line is what
      // tells them apart.
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ sessions: 0, activities: 0 });
    });
  });

  describe('registration', () => {
    it('registers a daily job scheduler, not a deprecated repeatable job', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { worker } = buildWorker();

      await worker.onModuleInit();

      const queue = (Queue as unknown as jest.Mock).mock.results[0]!.value as {
        add: jest.Mock;
        upsertJobScheduler: jest.Mock;
      };
      expect(queue.add).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'retention-cleanup',
        { every: 24 * 60 * 60 * 1000 },
        { name: 'purge-expired', opts: { removeOnComplete: 100, removeOnFail: 50 } },
      );

      await worker.onModuleDestroy();
    });

    it('starts nothing when REDIS_URL is unset', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.REDIS_URL;

      await buildWorker().worker.onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
    });

    it('starts nothing when REDIS_URL cannot be parsed', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.REDIS_URL = 'not-a-url';

      await buildWorker().worker.onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
    });
  });

  describe('cutoffFor', () => {
    it('subtracts whole days from the given instant', () => {
      expect(cutoffFor(NOW, 90)).toEqual(new Date('2026-05-16T00:00:00.000Z'));
    });

    it('is the identity at zero days, so a zero window can never mean "delete everything"', () => {
      // The callers skip the sweep entirely at 0; this guards the arithmetic behind that.
      expect(cutoffFor(NOW, 0)).toEqual(NOW);
    });
  });
});
