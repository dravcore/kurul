import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CommentService } from './comment.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const COMMENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';
const AUTHOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const OTHER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const MENTIONED_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';

describe('CommentService', () => {
  function buildService() {
    const prisma = {
      comment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue({
          id: TASK_ID,
          title: 'Ship',
          boardId: 'board-1',
        }),
      },
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const activityService = { record: jest.fn().mockResolvedValue({ id: 'activity-1' }) };
    const notificationService = { createMentionBatch: jest.fn().mockResolvedValue(0) };
    const realtime = { emitToBoard: jest.fn() };

    return {
      service: new CommentService(
        prisma as unknown as PrismaService,
        activityService as unknown as ActivityService,
        notificationService as unknown as NotificationService,
        realtime as unknown as RealtimeService,
      ),
      prisma,
      notificationService,
    };
  }

  it('lists comments for a task in the workspace', async () => {
    const { service, prisma } = buildService();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.comment.findMany.mockResolvedValue([
      {
        id: COMMENT_ID,
        taskId: TASK_ID,
        userId: AUTHOR_ID,
        body: 'hello',
        createdAt,
        user: { id: AUTHOR_ID, name: 'Ada', avatarUrl: null },
      },
    ]);

    await expect(service.list(WORKSPACE_ID, TASK_ID)).resolves.toEqual({
      items: [
        {
          id: COMMENT_ID,
          taskId: TASK_ID,
          userId: AUTHOR_ID,
          body: 'hello',
          createdAt: createdAt.toISOString(),
          author: { id: AUTHOR_ID, name: 'Ada', avatarUrl: null },
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('paginates comments by cursor with a bounded page size', async () => {
    const { service, prisma } = buildService();
    prisma.comment.findMany.mockResolvedValue([]);

    await service.list(WORKSPACE_ID, TASK_ID, { limit: 20, cursor: COMMENT_ID });

    expect(prisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID, id: { gt: COMMENT_ID } },
        orderBy: { id: 'asc' },
        take: 21,
      }),
    );
  });

  it('batches mention notifications for a comment instead of one call per mention', async () => {
    const { service, prisma, notificationService } = buildService();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.comment.create.mockResolvedValue({
      id: COMMENT_ID,
      taskId: TASK_ID,
      userId: AUTHOR_ID,
      body: `hey @[Bob](${MENTIONED_ID})`,
      createdAt,
      user: { id: AUTHOR_ID, name: 'Ada', avatarUrl: null },
    });
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: MENTIONED_ID }]);

    await service.create(WORKSPACE_ID, TASK_ID, AUTHOR_ID, {
      body: `hey @[Bob](${MENTIONED_ID})`,
    });

    expect(notificationService.createMentionBatch).toHaveBeenCalledTimes(1);
    expect(notificationService.createMentionBatch).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        actorId: AUTHOR_ID,
        taskId: TASK_ID,
        userIds: [MENTIONED_ID],
      }),
    );
  });

  it('skips the notification batch call when a comment has no mentions', async () => {
    const { service, prisma, notificationService } = buildService();
    prisma.comment.create.mockResolvedValue({
      id: COMMENT_ID,
      taskId: TASK_ID,
      userId: AUTHOR_ID,
      body: 'no mentions here',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      user: { id: AUTHOR_ID, name: 'Ada', avatarUrl: null },
    });

    await service.create(WORKSPACE_ID, TASK_ID, AUTHOR_ID, { body: 'no mentions here' });

    expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled();
    expect(notificationService.createMentionBatch).not.toHaveBeenCalled();
  });

  it('allows the author to delete their comment', async () => {
    const { service, prisma } = buildService();
    prisma.comment.findFirst.mockResolvedValue({
      id: COMMENT_ID,
      userId: AUTHOR_ID,
      taskId: TASK_ID,
    });

    await expect(
      service.remove(WORKSPACE_ID, COMMENT_ID, AUTHOR_ID, MemberRole.MEMBER),
    ).resolves.toBeUndefined();
    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
  });

  it('allows OWNER to delete another member comment', async () => {
    const { service, prisma } = buildService();
    prisma.comment.findFirst.mockResolvedValue({
      id: COMMENT_ID,
      userId: AUTHOR_ID,
      taskId: TASK_ID,
    });

    await expect(
      service.remove(WORKSPACE_ID, COMMENT_ID, OTHER_ID, MemberRole.OWNER),
    ).resolves.toBeUndefined();
  });

  it('forbids a non-author MEMBER from deleting another comment', async () => {
    const { service, prisma } = buildService();
    prisma.comment.findFirst.mockResolvedValue({
      id: COMMENT_ID,
      userId: AUTHOR_ID,
      taskId: TASK_ID,
    });

    await expect(
      service.remove(WORKSPACE_ID, COMMENT_ID, OTHER_ID, MemberRole.MEMBER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 when the comment is outside the workspace', async () => {
    const { service } = buildService();
    await expect(
      service.remove(WORKSPACE_ID, COMMENT_ID, AUTHOR_ID, MemberRole.OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
