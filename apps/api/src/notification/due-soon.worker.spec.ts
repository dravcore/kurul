import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationType, SocketEvents } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DueSoonWorker } from './due-soon.worker';
import { NotificationService } from './notification.service';

/** Every migration's SQL, whitespace-normalised so statements can be matched as one line. */
function allMigrationSql(): string {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(dir, entry.name, 'migration.sql');
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    })
    .join('\n')
    .replace(/\s+/g, ' ');
}

describe('DueSoonWorker', () => {
  it('creates due_soon notifications for assignees in the window', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    const created = await worker.runScan();

    expect(created).toBe(2);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: NotificationType.DueSoon,
            userId: 'u1',
            taskId: 't1',
          }),
          expect.objectContaining({
            type: NotificationType.DueSoon,
            userId: 'u2',
            taskId: 't1',
          }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('skips pairs that already have a recent or unread due_soon', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ userId: 'u1', taskId: 't1' }]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    const created = await worker.runScan();

    expect(created).toBe(1);
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            userId: 'u2',
            taskId: 't1',
          }),
        ],
      }),
    );
  });

  it('signals each assignee once for the whole scan, not once per inserted row', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
          {
            id: 't2',
            title: 'Review',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }],
          },
          {
            id: 't3',
            title: 'Other tenant',
            dueDate: due,
            board: { workspaceId: 'w2' },
            assignees: [{ userId: 'u1' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    await worker.runScan();

    // Four rows, three signals: u1/w1 is collapsed, and u1/w2 stays separate because the badge
    // it feeds is a different tenant's.
    expect(realtime.emitToUser).toHaveBeenCalledTimes(3);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'w1',
      'u1',
      SocketEvents.NOTIFICATION_UNREAD_CHANGED,
      { workspaceId: 'w1', userId: 'u1' },
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'w1',
      'u2',
      SocketEvents.NOTIFICATION_UNREAD_CHANGED,
      { workspaceId: 'w1', userId: 'u2' },
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'w2',
      'u1',
      SocketEvents.NOTIFICATION_UNREAD_CHANGED,
      { workspaceId: 'w2', userId: 'u1' },
    );
  });

  it('publishes nothing when the scan inserted nothing', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Already notified — every pair is skipped, so `createMany` is never reached.
      $queryRaw: jest.fn().mockResolvedValue([{ userId: 'u1', taskId: 't1' }]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    await expect(worker.runScan()).resolves.toBe(0);
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('looks the batch up by (taskId, userId) pairs, not by their cross product', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }],
          },
          {
            id: 't2',
            title: 'Review',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    await worker.runScan();

    const [fragments, taskIds, userIds] = prisma.$queryRaw.mock.calls[0]!;
    // Two positionally-matched arrays, not two independent `IN` lists: (t1,u1) and (t2,u2)
    // are searched, while (t1,u2) and (t2,u1) — which no assignment produced — are not.
    expect(taskIds).toEqual(['t1', 't2']);
    expect(userIds).toEqual(['u1', 'u2']);
    expect((fragments as string[]).join('?')).toContain('unnest(');
    // The re-notify predicate is what the partial unique index backs up; widening it would
    // turn a skipped pair into a swallowed insert conflict.
    expect((fragments as string[]).join('?')).toContain('n."readAt" IS NULL OR n."createdAt" >= ');
  });

  // `skipDuplicates` compiles to `INSERT ... ON CONFLICT DO NOTHING`, which is a no-op unless
  // a unique index exists for it to conflict on. The app-level check above only closes the
  // single-scanner case; the constraint is what stops two concurrent scans from both
  // inserting the same due_soon. Prisma cannot express a partial unique index, so it is raw
  // SQL in a migration — which makes it easy to lose to a regenerated migration.
  it('is backed by a partial unique index so skipDuplicates has something to conflict on', () => {
    const sql = allMigrationSql();

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "Notification_due_soon_unread_uidx" ON "Notification" ' +
        `("userId", "taskId") WHERE "type" = '${NotificationType.DueSoon}' ` +
        'AND "readAt" IS NULL AND "taskId" IS NOT NULL;',
    );
    expect(sql).not.toMatch(/DROP INDEX[^;]*Notification_due_soon_unread_uidx/);
  });
});
