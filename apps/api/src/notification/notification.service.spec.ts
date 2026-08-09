import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const RECIPIENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

describe('NotificationService', () => {
  function buildService() {
    const prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    return { service: new NotificationService(prisma as unknown as PrismaService), prisma };
  }

  it('does not create a notification when actor equals recipient', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.create(prisma as unknown as PrismaService, {
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        actorId: ACTOR_ID,
        type: NotificationType.Assignment,
        taskId: TASK_ID,
        payload: {},
      }),
    ).resolves.toBeNull();

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('creates an assignment notification for another user', async () => {
    const { service, prisma } = buildService();
    prisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.createAssignment(prisma as unknown as PrismaService, {
      workspaceId: WORKSPACE_ID,
      userId: RECIPIENT_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
      payload: { title: 'Card' },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: NotificationType.Assignment,
          userId: RECIPIENT_ID,
        }),
      }),
    );
  });

  it('skips due_soon when an unread or recent notification exists', async () => {
    const { service, prisma } = buildService();
    prisma.notification.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.shouldSkipDueSoon(prisma as unknown as PrismaService, RECIPIENT_ID, TASK_ID),
    ).resolves.toBe(true);

    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(
      service.shouldSkipDueSoon(prisma as unknown as PrismaService, RECIPIENT_ID, TASK_ID),
    ).resolves.toBe(false);
  });

  it('marks a notification read only for the owner', async () => {
    const { service, prisma } = buildService();
    prisma.notification.findFirst.mockResolvedValue(null);

    await expect(
      service.markRead(WORKSPACE_ID, RECIPIENT_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns unread count for the current user', async () => {
    const { service, prisma } = buildService();
    prisma.notification.count.mockResolvedValue(3);

    await expect(service.unreadCount(WORKSPACE_ID, RECIPIENT_ID)).resolves.toEqual({ count: 3 });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, userId: RECIPIENT_ID, readAt: null },
    });
  });
});
