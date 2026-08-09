import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MIN_GAP } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from './task.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const OTHER_BOARD_COLUMN = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

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
  };
}

describe('TaskService', () => {
  function buildService() {
    const prisma = {
      board: { findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID, workspaceId: WORKSPACE_ID }) },
      column: {
        findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
      },
      task: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    return { service: new TaskService(prisma as unknown as PrismaService), prisma };
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
    await expect(service.get(WORKSPACE_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
      service.move(WORKSPACE_ID, 't1', { columnId: OTHER_BOARD_COLUMN }),
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
      service.move(WORKSPACE_ID, 't1', { columnId: COLUMN_ID, afterTaskId: 't1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rebalances when the insertion gap is exhausted', async () => {
    const { service, prisma } = buildService();
    const tight = [
      taskRow({ id: 'a', position: 1000 }),
      taskRow({ id: 'b', position: 1000 + MIN_GAP / 2 }),
    ];
    const moving = taskRow({ id: 'c', position: 5000, columnId: 'other' });

    const updates: Array<{ id: string; position: number; columnId?: string }> = [];
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(moving),
          findMany: jest.fn().mockResolvedValue(tight),
          update: jest.fn().mockImplementation(({ where, data }) => {
            updates.push({ id: where.id as string, ...data });
            return Promise.resolve({ ...moving, ...data, id: where.id });
          }),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
        },
      }),
    );

    const result = await service.move(WORKSPACE_ID, 'c', {
      columnId: COLUMN_ID,
      beforeTaskId: 'a',
    });

    expect(updates).toHaveLength(3);
    expect(updates.map((row) => row.position)).toEqual([1000, 2000, 3000]);
    expect(result.position).toBe(2000);
    expect(result.columnId).toBe(COLUMN_ID);
  });
});
