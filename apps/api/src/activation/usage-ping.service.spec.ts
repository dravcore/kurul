import { Logger } from '@nestjs/common';
import { UsagePingKind } from '@kurul/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { UsagePingService, utcDayStart } from './usage-ping.service';

function buildService(): { service: UsagePingService; createMany: jest.Mock } {
  const createMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { usagePing: { createMany } } as unknown as PrismaService;
  return { service: new UsagePingService(prisma), createMany };
}

describe('utcDayStart', () => {
  it('truncates to UTC midnight of the same UTC day', () => {
    expect(utcDayStart(new Date('2026-08-14T13:45:12.345Z')).toISOString()).toBe(
      '2026-08-14T00:00:00.000Z',
    );
  });

  /**
   * The bug this function exists to prevent. `setHours(0,0,0,0)` on a machine running
   * `TZ=Europe/Istanbul` (UTC+3) turns 01:00 UTC into the *previous* day's midnight local —
   * so two replicas of one deployment in different zones would write two rows for one visit
   * and the unique constraint would stop deduplicating anything.
   *
   * Both instants below are the same UTC day and must produce one bucket regardless of what
   * the host's clock calls them.
   */
  it('buckets by UTC, not by the host timezone', () => {
    const lateNight = utcDayStart(new Date('2026-08-14T23:59:59.999Z'));
    const earlyMorning = utcDayStart(new Date('2026-08-14T00:00:00.000Z'));

    expect(lateNight.getTime()).toBe(earlyMorning.getTime());
    expect(lateNight.toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('puts one UTC second past midnight in the new day, not the old one', () => {
    expect(utcDayStart(new Date('2026-08-15T00:00:01.000Z')).toISOString()).toBe(
      '2026-08-15T00:00:00.000Z',
    );
  });
});

describe('UsagePingService', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * `skipDuplicates` is the dedupe. Without it the unique index turns the second view of a day
   * into a thrown unique-violation — which `recordQuietly` would swallow, leaving a warning per
   * page view and no clue why. Asserted explicitly because it is a single word that a refactor
   * to `create()` would drop silently.
   */
  it('inserts one deduplicated row for the UTC day', async () => {
    const { service, createMany } = buildService();

    await service.record('u1', 'w1', UsagePingKind.BoardView, new Date('2026-08-14T22:10:00.000Z'));

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u1',
          workspaceId: 'w1',
          kind: UsagePingKind.BoardView,
          day: new Date('2026-08-14T00:00:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });

  /**
   * The row's whole content is its key: user, workspace, kind, day. Anything else — a board id,
   * a path, a count, a timestamp of the visit — would turn a "did they show up" answer into a
   * browsing history, which is the promise `model UsagePing` makes.
   */
  it('records nothing beyond the four columns that are its key', async () => {
    const { service, createMany } = buildService();

    await service.record('u1', 'w1', UsagePingKind.DashboardView);

    const [row] = (createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }])[0].data;
    expect(Object.keys(row!).sort()).toEqual(['day', 'kind', 'userId', 'workspaceId']);
  });

  /**
   * The fire-and-forget contract, and the reason a `GET` is allowed to write here at all: a
   * metrics table that is full, locked or missing must not be able to stop a team seeing their
   * board. Reverting the `.catch()` in `recordQuietly` turns this into an unhandled rejection.
   */
  it('swallows a failed write and logs it instead of rejecting', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, createMany } = buildService();
    createMany.mockRejectedValue(new Error('relation "UsagePing" does not exist'));

    expect(() => service.recordQuietly('u1', 'w1', UsagePingKind.BoardView)).not.toThrow();

    // Let the rejected promise settle so the assertion sees the handler, not the scheduling.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('usage ping'));
  });

  /** Not awaited: the handler returns before the insert has resolved. */
  it('returns before the write completes', () => {
    const { service, createMany } = buildService();
    let settled = false;
    createMany.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ count: 1 });
          }, 5),
        ),
    );

    service.recordQuietly('u1', 'w1', UsagePingKind.BoardView);

    expect(settled).toBe(false);
  });
});
