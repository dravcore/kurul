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
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'n', ...data })),
      },
    };
    const notifications = new NotificationService(prisma as unknown as PrismaService);
    const worker = new DueSoonWorker(prisma as unknown as PrismaService, notifications);

    const created = await worker.runScan();

    expect(created).toBe(2);
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: NotificationType.DueSoon,
          userId: 'u1',
          taskId: 't1',
        }),
      }),
    );
  });
});
