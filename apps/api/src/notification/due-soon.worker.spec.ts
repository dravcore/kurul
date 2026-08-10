import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationType } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
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
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const notifications = new NotificationService(prisma as unknown as PrismaService);
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    const created = await worker.runScan();

    expect(created).toBe(2);
    expect(prisma.notification.findMany).toHaveBeenCalled();
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
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', taskId: 't1' }]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const notifications = new NotificationService(prisma as unknown as PrismaService);
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
