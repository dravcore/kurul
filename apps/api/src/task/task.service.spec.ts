import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { MIN_GAP } from '../common/position/fractional-index';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskAssigneeService } from './task-assignee.service';
import { TaskLabelService } from './task-label.service';
import { TaskService } from './task.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const OTHER_BOARD_COLUMN = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

function taskRow(
  overrides: Partial<{
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    position: number;
  }> = {},
) {
  const now = new Date('2026-01-01');
  return {
    id: overrides.id ?? '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
    boardId: overrides.boardId ?? BOARD_ID,
    columnId: overrides.columnId ?? COLUMN_ID,
    title: overrides.title ?? 'Task',
    description: null,
    priority: 'MEDIUM' as const,
    position: overrides.position ?? 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: USER_ID,
    createdAt: now,
    updatedAt: now,
    assignees: [] as Array<{ user: { id: string; name: string; avatarUrl: string | null } }>,
    labels: [] as Array<{ label: { id: string; boardId: string; name: string; color: string } }>,
  };
}

describe('TaskService', () => {
  function buildService() {
    const activityService = {
      record: jest.fn().mockResolvedValue({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80' }),
    };
    const notificationService = {
      createAssignment: jest.fn().mockResolvedValue(null),
      createMention: jest.fn().mockResolvedValue(null),
    };
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID, workspaceId: WORKSPACE_ID }),
      },
      column: {
        findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
      },
      task: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      taskAssignee: {
        create: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      taskLabel: {
        create: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      label: {
        findFirst: jest.fn(),
      },
      workspaceMember: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const realtime = {
      emitToBoard: jest.fn(),
    } as unknown as import('../realtime/realtime.service').RealtimeService;
    const prismaService = prisma as unknown as PrismaService;
    const activity = activityService as unknown as ActivityService;
    const notifications = notificationService as unknown as NotificationService;
    const assignees = new TaskAssigneeService(prismaService, activity, notifications, realtime);
    const labels = new TaskLabelService(prismaService, realtime);
    return {
      service: new TaskService(prismaService, activity, realtime, assignees, labels),
      prisma,
      activityService,
      notificationService,
      realtime,
    };
  }

  it('appends a created task after the final existing position', async () => {
    const { service, prisma } = buildService();
    prisma.task.findMany.mockResolvedValue([taskRow({ id: 'last', position: 3000 })]);
    prisma.task.create.mockResolvedValue(taskRow({ id: 'new', position: 4000, title: 'New' }));

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'New',
        columnId: COLUMN_ID,
      }),
    ).resolves.toMatchObject({ position: 4000, title: 'New' });

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 4000, createdById: USER_ID }),
      }),
    );
  });

  it('places the first task in an empty column at the base gap', async () => {
    const { service, prisma } = buildService();
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.create.mockResolvedValue(taskRow({ id: 'solo', position: 1000 }));

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'Solo',
        columnId: COLUMN_ID,
      }),
    ).resolves.toMatchObject({ position: 1000 });

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1000 }) }),
    );
  });

  it('inserts between neighbors on create when afterTaskId is set', async () => {
    const { service, prisma } = buildService();
    const a = taskRow({ id: 'a', position: 1000 });
    const b = taskRow({ id: 'b', position: 2000 });
    prisma.task.findMany.mockResolvedValue([a, b]);
    prisma.task.create.mockResolvedValue(taskRow({ id: 'mid', position: 1500 }));

    await service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
      title: 'Mid',
      columnId: COLUMN_ID,
      afterTaskId: 'a',
    });

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1500 }) }),
    );
  });

  it('returns 404 when a task is outside the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(
      service.get(WORKSPACE_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects moving a task onto a column from another board', async () => {
    const { service, prisma } = buildService();
    const task = taskRow({ id: 't1' });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(task),
          findMany: jest.fn().mockResolvedValue([task]),
          update: jest.fn(),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({
            id: OTHER_BOARD_COLUMN,
            boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70',
          }),
        },
      }),
    );

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: OTHER_BOARD_COLUMN }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a task as its own neighbor', async () => {
    const { service, prisma } = buildService();
    const task = taskRow({ id: 't1' });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(task),
          findMany: jest.fn().mockResolvedValue([task]),
          update: jest.fn(),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
        },
      }),
    );

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: COLUMN_ID, afterTaskId: 't1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rebalances when the insertion gap is exhausted', async () => {
    const { service, prisma } = buildService();
    const tight = [
      taskRow({ id: 'a', position: 1000 }),
      taskRow({ id: 'b', position: 1000 + MIN_GAP / 2 }),
    ];
    const moving = taskRow({ id: 'c', position: 5000, columnId: 'other' });

    let updateCall: { where: { id: string }; data: { position: number; columnId: string } } | null =
      null;
    const executeRaw = jest.fn().mockResolvedValue(2);
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(moving),
          findMany: jest.fn().mockResolvedValue(tight),
          update: jest.fn().mockImplementation(({ where, data }) => {
            updateCall = { where, data };
            return Promise.resolve({ ...moving, ...data, id: where.id });
          }),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
        },
        $executeRaw: executeRaw,
      }),
    );

    const result = await service.move(WORKSPACE_ID, 'c', ACTOR_ID, {
      columnId: COLUMN_ID,
      beforeTaskId: 'a',
    });

    expect(updateCall).toEqual({
      where: { id: 'c' },
      data: { position: 2000, columnId: COLUMN_ID },
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, ids, positions, columnId] = executeRaw.mock.calls[0]!;
    expect(ids).toEqual(['a', 'b']);
    expect(positions).toEqual([1000, 3000]);
    expect(columnId).toBe(COLUMN_ID);
    expect(result.position).toBe(2000);
    expect(result.columnId).toBe(COLUMN_ID);
  });

  /** Wire up the $transaction mock the way move() consumes it. */
  function mockMoveTx(
    prisma: ReturnType<typeof buildService>['prisma'],
    options: {
      task?: ReturnType<typeof taskRow> | null;
      siblings?: Array<ReturnType<typeof taskRow>>;
      column?: { id: string; boardId: string } | null;
    } = {},
  ): { updates: Array<{ id: string; position?: number; columnId?: string }> } {
    const updates: Array<{ id: string; position?: number; columnId?: string }> = [];
    const movedTask = options.task === undefined ? taskRow({ id: 't1' }) : options.task;
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(movedTask),
          findMany: jest.fn().mockResolvedValue(options.siblings ?? []),
          update: jest.fn().mockImplementation(({ where, data }) => {
            updates.push({ id: where.id as string, ...data });
            return Promise.resolve({ ...(movedTask ?? taskRow({ id: 't1' })), ...data });
          }),
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            updates.push({ id: where.id as string, ...data });
            return Promise.resolve({ count: 1 });
          }),
        },
        column: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              options.column === undefined ? { id: COLUMN_ID, boardId: BOARD_ID } : options.column,
            ),
        },
      }),
    );
    return { updates };
  }

  it('returns 404 on create when afterTaskId does not exist in the target column', async () => {
    const { service, prisma } = buildService();
    prisma.task.findMany.mockResolvedValue([taskRow({ id: 'a', position: 1000 })]);

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'Orphan',
        columnId: COLUMN_ID,
        afterTaskId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rebalances the whole column when a create hits an exhausted gap', async () => {
    const { service, prisma } = buildService();
    const a = taskRow({ id: 'a', position: 1000 });
    const b = taskRow({ id: 'b', position: 1000 + MIN_GAP / 2 });
    prisma.task.findMany.mockResolvedValue([a, b]);

    let createdPosition: number | undefined;
    const executeRaw = jest.fn().mockResolvedValue(2);
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          create: jest.fn().mockImplementation(({ data }) => {
            createdPosition = data.position as number;
            return Promise.resolve(taskRow({ id: 'new', position: data.position as number }));
          }),
        },
        $executeRaw: executeRaw,
      }),
    );

    const result = await service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
      title: 'Wedge',
      columnId: COLUMN_ID,
      afterTaskId: 'a',
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, ids, positions, columnId] = executeRaw.mock.calls[0]!;
    expect(ids).toEqual(['a', 'b']);
    expect(positions).toEqual([1000, 3000]);
    expect(columnId).toBe(COLUMN_ID);
    expect(createdPosition).toBe(2000);
    expect(result.position).toBe(2000);
  });

  it('appends to the end of the target column when no neighbors are given', async () => {
    const { service, prisma } = buildService();
    const moving = taskRow({ id: 'moving', position: 500, columnId: 'other' });
    const { updates } = mockMoveTx(prisma, {
      task: moving,
      siblings: [taskRow({ id: 'a', position: 1000 })],
    });

    const result = await service.move(WORKSPACE_ID, 'moving', ACTOR_ID, { columnId: COLUMN_ID });

    expect(updates).toEqual([{ id: 'moving', columnId: COLUMN_ID, position: 2000 }]);
    expect(result.position).toBe(2000);
  });

  it('moves into an empty column at the base gap', async () => {
    const { service, prisma } = buildService();
    const moving = taskRow({ id: 'moving', position: 500, columnId: 'other' });
    const { updates } = mockMoveTx(prisma, { task: moving, siblings: [] });

    const result = await service.move(WORKSPACE_ID, 'moving', ACTOR_ID, { columnId: COLUMN_ID });

    expect(updates).toEqual([{ id: 'moving', columnId: COLUMN_ID, position: 1000 }]);
    expect(result.position).toBe(1000);
  });

  it('inserts between the before neighbor and its successor without touching siblings', async () => {
    const { service, prisma } = buildService();
    const moving = taskRow({ id: 'moving', position: 9000 });
    const { updates } = mockMoveTx(prisma, {
      task: moving,
      siblings: [
        taskRow({ id: 'a', position: 1000 }),
        taskRow({ id: 'b', position: 2000 }),
        moving,
      ],
    });

    const result = await service.move(WORKSPACE_ID, 'moving', ACTOR_ID, {
      columnId: COLUMN_ID,
      beforeTaskId: 'a',
      afterTaskId: 'b',
    });

    expect(updates).toEqual([{ id: 'moving', columnId: COLUMN_ID, position: 1500 }]);
    expect(result.position).toBe(1500);
  });

  it('returns 404 on move when the task is outside the workspace', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, { task: null });

    await expect(
      service.move(WORKSPACE_ID, 'ghost', ACTOR_ID, { columnId: COLUMN_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 on move when the target column is outside the workspace', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, { column: null });

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: COLUMN_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 on move when a neighbor id is not in the target column', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, {
      task: taskRow({ id: 't1' }),
      siblings: [taskRow({ id: 't1' }), taskRow({ id: 'a', position: 2000 })],
    });

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: COLUMN_ID, beforeTaskId: 'foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 on move when beforeTaskId and afterTaskId are not adjacent', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, {
      task: taskRow({ id: 'moving', position: 9000 }),
      siblings: [
        taskRow({ id: 'a', position: 1000 }),
        taskRow({ id: 'b', position: 2000 }),
        taskRow({ id: 'c', position: 3000 }),
      ],
    });

    await expect(
      service.move(WORKSPACE_ID, 'moving', ACTOR_ID, {
        columnId: COLUMN_ID,
        beforeTaskId: 'a',
        afterTaskId: 'c',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears dueDate and estimatedMinutes when the payload sets them to null', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.task.update.mockResolvedValue(taskRow({ id: 't1' }));

    await service.update(WORKSPACE_ID, 't1', ACTOR_ID, { dueDate: null, estimatedMinutes: null });

    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { dueDate: null, estimatedMinutes: null },
      }),
    );
  });

  it('leaves omitted fields out of the update payload entirely', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.task.update.mockResolvedValue(taskRow({ id: 't1', title: 'Renamed' }));

    await service.update(WORKSPACE_ID, 't1', ACTOR_ID, { title: 'Renamed' });

    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'Renamed' } }),
    );
  });

  it('rejects assigning a user who is not a workspace member with 422', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.workspaceMember.findFirst.mockResolvedValue(null);

    await expect(
      service.addAssignee(WORKSPACE_ID, 't1', ACTOR_ID, { userId: USER_ID }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.taskAssignee.create).not.toHaveBeenCalled();
  });

  it('maps a duplicate assignee to 409', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.workspaceMember.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.taskAssignee.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.addAssignee(WORKSPACE_ID, 't1', ACTOR_ID, { userId: USER_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when removing an assignee who is not assigned', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.taskAssignee.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.removeAssignee(WORKSPACE_ID, 't1', ACTOR_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taskAssignee.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 't1', userId: USER_ID },
    });
  });

  it('rejects attaching a label from another board with 422', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.label.findFirst.mockResolvedValue(null);

    await expect(
      service.addLabel(WORKSPACE_ID, 't1', USER_ID, {
        labelId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.taskLabel.create).not.toHaveBeenCalled();
  });

  it('maps a duplicate task label to 409', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.label.findFirst.mockResolvedValue({ id: 'l1', boardId: BOARD_ID });
    prisma.taskLabel.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.addLabel(WORKSPACE_ID, 't1', USER_ID, {
        labelId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when removing a label that is not attached to the task', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.taskLabel.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.removeLabel(WORKSPACE_ID, 't1', USER_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taskLabel.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 't1', labelId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80' },
    });
  });

  describe('list filters and cursor', () => {
    it('returns a cursor page and walks by id', async () => {
      const { service, prisma } = buildService();
      const a = taskRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61' });
      const b = taskRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d62' });
      const c = taskRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d63' });
      prisma.task.findMany.mockResolvedValue([a, b, c]);

      const page = await service.list(WORKSPACE_ID, BOARD_ID, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(b.id);
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { boardId: BOARD_ID },
          orderBy: { id: 'asc' },
          take: 3,
        }),
      );
    });

    it('builds AND filters for q, priority, assignee, label, and due range', async () => {
      const { service, prisma } = buildService();
      prisma.task.findMany.mockResolvedValue([]);

      await service.list(WORKSPACE_ID, BOARD_ID, {
        limit: 50,
        q: 'login',
        priority: ['HIGH', 'URGENT'],
        assigneeId: ['null', USER_ID],
        labelId: ['0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80'],
        dueDate: 'null',
        'dueDate[gte]': '2026-01-01T00:00:00.000Z',
        'dueDate[lte]': '2026-12-31T00:00:00.000Z',
        cursor: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
      });

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            boardId: BOARD_ID,
            AND: expect.arrayContaining([
              { id: { gt: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60' } },
              {
                OR: [
                  { title: { contains: 'login', mode: 'insensitive' } },
                  { description: { contains: 'login', mode: 'insensitive' } },
                ],
              },
              { priority: { in: ['HIGH', 'URGENT'] } },
              {
                OR: [
                  { assignees: { none: {} } },
                  { assignees: { some: { userId: { in: [USER_ID] } } } },
                ],
              },
              {
                labels: {
                  some: { labelId: { in: ['0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80'] } },
                },
              },
              { dueDate: null },
              {
                dueDate: {
                  gte: new Date('2026-01-01T00:00:00.000Z'),
                  lte: new Date('2026-12-31T00:00:00.000Z'),
                },
              },
            ]),
          },
        }),
      );
    });
  });
});
