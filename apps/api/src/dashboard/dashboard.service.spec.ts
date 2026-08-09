import { NotFoundException } from '@nestjs/common';
import { Priority } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

describe('DashboardService', () => {
  function buildService() {
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID, workspaceId: WORKSPACE_ID }),
      },
      task: {
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      taskAssignee: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      column: {
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return { service: new DashboardService(prisma as unknown as PrismaService), prisma };
  }

  it('returns zero-filled priorities and null byColumn without boardId', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.task.groupBy.mockResolvedValue([{ priority: Priority.HIGH, _count: { _all: 2 } }]);

    const summary = await service.summary(WORKSPACE_ID, {});

    expect(summary.totalTasks).toBe(3);
    expect(summary.overdueCount).toBe(1);
    expect(summary.byColumn).toBeNull();
    expect(summary.byPriority).toEqual([
      { priority: Priority.LOW, count: 0 },
      { priority: Priority.MEDIUM, count: 0 },
      { priority: Priority.HIGH, count: 2 },
      { priority: Priority.URGENT, count: 0 },
    ]);
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
  });

  it('fills byColumn including zero-count columns when boardId is set', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValue(0);
    prisma.task.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ columnId: 'c1', _count: { _all: 4 } }]);
    prisma.column.findMany.mockResolvedValue([
      { id: 'c1', name: 'To Do', position: 1000 },
      { id: 'c2', name: 'Done', position: 2000 },
    ]);

    const summary = await service.summary(WORKSPACE_ID, { boardId: BOARD_ID });

    expect(summary.byColumn).toEqual([
      { columnId: 'c1', name: 'To Do', position: 1000, count: 4 },
      { columnId: 'c2', name: 'Done', position: 2000, count: 0 },
    ]);
  });

  it('keeps top 8 assignees and folds the rest into Other', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValue(0);
    prisma.task.groupBy.mockResolvedValue([]);
    const rows = Array.from({ length: 10 }, (_, index) => ({
      userId: `0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d${String(60 + index).padStart(2, '0')}`,
      _count: { _all: 10 - index },
    }));
    prisma.taskAssignee.groupBy.mockResolvedValue(rows);
    prisma.user.findMany.mockResolvedValue(
      rows.map((row, index) => ({ id: row.userId, name: `User ${index}` })),
    );

    const summary = await service.summary(WORKSPACE_ID, {});

    expect(summary.byAssignee).toHaveLength(9);
    expect(summary.byAssignee.slice(0, 8).every((row) => row.userId !== null)).toBe(true);
    expect(summary.byAssignee[8]).toEqual({ userId: null, name: 'Other', count: 1 + 2 });
  });

  it('returns 404 when boardId is outside the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.board.findFirst.mockResolvedValue(null);

    await expect(service.summary(WORKSPACE_ID, { boardId: BOARD_ID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
