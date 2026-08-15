import { NotFoundException } from '@nestjs/common';
import { ActivityType } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from './activity.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

function activityRow(id: string, deletedAt: Date | null = null) {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    userId: USER_ID,
    type: ActivityType.TaskCreated,
    payload: { title: 'Card' },
    createdAt: new Date('2026-01-01'),
    user: { id: USER_ID, name: 'Owner', avatarUrl: null, deletedAt },
  };
}

describe('ActivityService', () => {
  function buildService() {
    const prisma = {
      activity: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      task: {
        findFirst: jest.fn(),
      },
    };
    return { service: new ActivityService(prisma as unknown as PrismaService), prisma };
  }

  it('records via the provided db client', async () => {
    const { service, prisma } = buildService();
    prisma.activity.create.mockResolvedValue({ id: 'a1' });

    await service.record(prisma as unknown as PrismaService, {
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      type: ActivityType.TaskCreated,
      payload: { title: 'Card' },
    });

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        type: ActivityType.TaskCreated,
        payload: { title: 'Card' },
      },
    });
  });

  it('lists workspace activities newest-first with author and cursor', async () => {
    const { service, prisma } = buildService();
    const a = activityRow('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70');
    const b = activityRow('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d69');
    const c = activityRow('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d68');
    prisma.activity.findMany.mockResolvedValue([a, b, c]);

    const page = await service.listWorkspace(WORKSPACE_ID, { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.author).toEqual({
      id: USER_ID,
      name: 'Owner',
      avatarUrl: null,
      deleted: false,
    });
    expect(page.nextCursor).toBe(b.id);
    expect(page.hasMore).toBe(true);
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID },
        orderBy: { id: 'desc' },
        take: 3,
      }),
    );
  });

  /**
   * The feed is one of the two surfaces that can name an anonymised account — the memberships,
   * assignments and rosters are all gone by then, so an activity row and a comment are the only
   * places a tombstone still appears.
   *
   * The DTO reports the state and **not** the timestamp: this route is `@WorkspaceScoped()`, so
   * every member down to GUEST reads it, and when a named person asked to be erased is a fact
   * about them that nothing here needs (`common/author.ts`).
   */
  it('reports an anonymised author as deleted, without publishing when it happened', async () => {
    const { service, prisma } = buildService();
    prisma.activity.findMany.mockResolvedValue([
      activityRow('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d71', new Date('2026-08-15')),
    ]);

    const page = await service.listWorkspace(WORKSPACE_ID, { limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.author.deleted).toBe(true);
    // The stored tombstone still travels, for an API consumer that is not the web app.
    expect(page.items[0]!.author.name).toBe('Owner');
    expect(page.items[0]!.author).not.toHaveProperty('deletedAt');
  });

  it('returns 404 when listing activities for a missing task', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(service.listForTask(WORKSPACE_ID, TASK_ID, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists a task activities once the tenant-scoped lookup finds it', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue({ id: TASK_ID });
    const row = activityRow('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d71');
    prisma.activity.findMany.mockResolvedValue([row]);

    const page = await service.listForTask(WORKSPACE_ID, TASK_ID, { limit: 10 });

    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: TASK_ID, board: { workspaceId: WORKSPACE_ID } },
      select: { id: true },
    });
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, taskId: TASK_ID },
      }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(row.id);
  });
});
