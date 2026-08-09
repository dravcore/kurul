import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const RECIPIENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const NOTIFICATION_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70';

function notificationRow(
  overrides: Partial<{ id: string; readAt: Date | null; payload: unknown }> = {},
) {
  return {
    id: overrides.id ?? NOTIFICATION_ID,
    workspaceId: WORKSPACE_ID,
    userId: RECIPIENT_ID,
    type: NotificationType.Assignment,
    taskId: TASK_ID,
    activityId: null,
    payload: 'payload' in overrides ? overrides.payload : { title: 'Card' },
    readAt: overrides.readAt ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

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

  it('returns unread count for the current user', async () => {
    const { service, prisma } = buildService();
    prisma.notification.count.mockResolvedValue(3);

    await expect(service.unreadCount(WORKSPACE_ID, RECIPIENT_ID)).resolves.toEqual({ count: 3 });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, userId: RECIPIENT_ID, readAt: null },
    });
  });

  describe('markRead', () => {
    it('marks a notification read only for the owner', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markRead(WORKSPACE_ID, RECIPIENT_ID, NOTIFICATION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Scoped by workspace and recipient, so another member's row reads as missing.
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: NOTIFICATION_ID, workspaceId: WORKSPACE_ID, userId: RECIPIENT_ID },
      });
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('stamps readAt and returns the DTO', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findFirst.mockResolvedValue(notificationRow());
      const readAt = new Date('2026-02-01T10:00:00.000Z');
      prisma.notification.update.mockResolvedValue(notificationRow({ readAt }));

      await expect(service.markRead(WORKSPACE_ID, RECIPIENT_ID, NOTIFICATION_ID)).resolves.toEqual({
        id: NOTIFICATION_ID,
        workspaceId: WORKSPACE_ID,
        userId: RECIPIENT_ID,
        type: NotificationType.Assignment,
        taskId: TASK_ID,
        activityId: null,
        payload: { title: 'Card' },
        readAt: readAt.toISOString(),
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const call = prisma.notification.update.mock.calls[0]![0] as {
        where: { id: string };
        data: { readAt: Date };
      };
      expect(call.where).toEqual({ id: NOTIFICATION_ID });
      expect(call.data.readAt).toBeInstanceOf(Date);
    });

    it('is idempotent — an already read notification is returned untouched', async () => {
      const { service, prisma } = buildService();
      const readAt = new Date('2026-01-15T09:00:00.000Z');
      prisma.notification.findFirst.mockResolvedValue(notificationRow({ readAt }));

      await expect(
        service.markRead(WORKSPACE_ID, RECIPIENT_ID, NOTIFICATION_ID),
      ).resolves.toMatchObject({ readAt: readAt.toISOString() });

      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('touches only the caller unread rows and reports the count', async () => {
      const { service, prisma } = buildService();
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });

      await expect(service.markAllRead(WORKSPACE_ID, RECIPIENT_ID)).resolves.toEqual({
        updated: 4,
      });

      const call = prisma.notification.updateMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        data: { readAt: Date };
      };
      expect(call.where).toEqual({
        workspaceId: WORKSPACE_ID,
        userId: RECIPIENT_ID,
        readAt: null,
      });
      expect(call.data.readAt).toBeInstanceOf(Date);
    });

    it('reports zero when nothing was unread', async () => {
      const { service, prisma } = buildService();
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markAllRead(WORKSPACE_ID, RECIPIENT_ID)).resolves.toEqual({
        updated: 0,
      });
    });
  });

  describe('list', () => {
    it('walks newest-first by id and hands back the last id of the page as the cursor', async () => {
      const { service, prisma } = buildService();
      const rows = [
        notificationRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d73' }),
        notificationRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d72' }),
        notificationRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d71' }),
      ];
      prisma.notification.findMany.mockResolvedValue(rows);

      const page = await service.list(WORKSPACE_ID, RECIPIENT_ID, { limit: 2 });

      expect(page.items.map((item) => item.id)).toEqual([
        '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d73',
        '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d72',
      ]);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d72');
      // limit + 1 is the peek row that decides hasMore.
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID, userId: RECIPIENT_ID },
        orderBy: { id: 'desc' },
        take: 3,
      });
    });

    it('ends the walk when the page is not full', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findMany.mockResolvedValue([notificationRow()]);

      const page = await service.list(WORKSPACE_ID, RECIPIENT_ID, { limit: 50 });

      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('applies the unreadOnly, type and cursor filters together', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list(WORKSPACE_ID, RECIPIENT_ID, {
        limit: 10,
        unreadOnly: true,
        type: NotificationType.Mention,
        cursor: NOTIFICATION_ID,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: WORKSPACE_ID,
          userId: RECIPIENT_ID,
          readAt: null,
          type: NotificationType.Mention,
          // Descending walk, so the next page is strictly older ids.
          id: { lt: NOTIFICATION_ID },
        },
        orderBy: { id: 'desc' },
        take: 11,
      });
    });

    it('maps a null payload to an empty object', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findMany.mockResolvedValue([notificationRow({ payload: null })]);

      const page = await service.list(WORKSPACE_ID, RECIPIENT_ID, { limit: 50 });

      expect(page.items[0]!.payload).toEqual({});
    });
  });
});
