import { NotificationType } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { DueSoonWorker } from './due-soon.worker';
import { NotificationService } from './notification.service';

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
});
