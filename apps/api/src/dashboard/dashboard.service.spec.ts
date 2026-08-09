import { NotFoundException } from '@nestjs/common';
import { Priority } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyThroughputCounts,
  applyThroughputDayCounts,
  emptyThroughputSeries,
  isCompletedMove,
  THROUGHPUT_DAYS,
} from './dashboard-throughput';
import { DashboardService } from './dashboard.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

describe('dashboard-throughput helpers', () => {
  it('fills 14 UTC days ending today with zeros', () => {
    const series = emptyThroughputSeries(new Date('2026-08-09T15:30:00.000Z'));
    expect(series).toHaveLength(THROUGHPUT_DAYS);
    expect(series[0]).toEqual({ date: '2026-07-27', created: 0, completed: 0 });
    expect(series[THROUGHPUT_DAYS - 1]).toEqual({
      date: '2026-08-09',
      created: 0,
      completed: 0,
    });
  });

  it('detects Done via toColumnName or toColumnId', () => {
    const doneIds = new Set(['col-done']);
    expect(isCompletedMove({ toColumnName: 'Done' }, doneIds)).toBe(true);
    expect(isCompletedMove({ toColumnName: 'done' }, doneIds)).toBe(true);
    expect(isCompletedMove({ toColumnId: 'col-done' }, doneIds)).toBe(true);
    expect(isCompletedMove({ toColumnId: 'col-todo', toColumnName: 'To Do' }, doneIds)).toBe(false);
  });

  it('buckets created and completed into the series window', () => {
    const series = emptyThroughputSeries(new Date('2026-08-09T12:00:00.000Z'));
    const result = applyThroughputCounts(
      series,
      [new Date('2026-08-09T01:00:00.000Z'), new Date('2026-07-20T01:00:00.000Z')],
      [new Date('2026-08-08T23:00:00.000Z')],
    );
    expect(result.find((day) => day.date === '2026-08-09')!.created).toBe(1);
    expect(result.find((day) => day.date === '2026-08-08')!.completed).toBe(1);
    expect(result.reduce((sum, day) => sum + day.created, 0)).toBe(1);
  });

  it('applies pre-aggregated day counts', () => {
    const series = emptyThroughputSeries(new Date('2026-08-09T12:00:00.000Z'));
    const result = applyThroughputDayCounts(
      series,
      new Map([['2026-08-09', 3]]),
      new Map([['2026-08-08', 2]]),
    );
    expect(result.find((day) => day.date === '2026-08-09')!.created).toBe(3);
    expect(result.find((day) => day.date === '2026-08-08')!.completed).toBe(2);
  });
});

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
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return { service: new DashboardService(prisma as unknown as PrismaService), prisma };
  }

  it('returns zero-filled priorities, throughput, and null byColumn without boardId', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.task.groupBy.mockResolvedValue([{ priority: Priority.HIGH, _count: { _all: 2 } }]);

    const summary = await service.summary(WORKSPACE_ID, {});

    expect(summary.totalTasks).toBe(3);
    expect(summary.overdueCount).toBe(1);
    expect(summary.byColumn).toBeNull();
    expect(summary.throughput).toHaveLength(THROUGHPUT_DAYS);
    expect(summary.throughput.every((day) => day.created === 0 && day.completed === 0)).toBe(true);
    expect(summary.byPriority).toEqual([
      { priority: Priority.LOW, count: 0 },
      { priority: Priority.MEDIUM, count: 0 },
      { priority: Priority.HIGH, count: 2 },
      { priority: Priority.URGENT, count: 0 },
    ]);
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('fills byColumn including zero-count columns when boardId is set', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValue(0);
    prisma.task.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ columnId: 'c1', _count: { _all: 4 } }]);
    prisma.column.findMany.mockResolvedValueOnce([{ id: 'c2' }]).mockResolvedValueOnce([
      { id: 'c1', name: 'To Do', position: 1000 },
      { id: 'c2', name: 'Done', position: 2000 },
    ]);

    const summary = await service.summary(WORKSPACE_ID, { boardId: BOARD_ID });

    expect(summary.byColumn).toEqual([
      { columnId: 'c1', name: 'To Do', position: 1000, count: 4 },
      { columnId: 'c2', name: 'Done', position: 2000, count: 0 },
    ]);
  });

  it('counts throughput created and completed moves into Done', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValue(0);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.column.findMany.mockResolvedValue([{ id: 'done-id' }]);
    const today = emptyThroughputSeries()[THROUGHPUT_DAYS - 1]!.date;
    prisma.$queryRaw
      .mockResolvedValueOnce([{ day: new Date(`${today}T00:00:00.000Z`), count: 1 }])
      .mockResolvedValueOnce([{ day: new Date(`${today}T00:00:00.000Z`), count: 1 }]);

    const summary = await service.summary(WORKSPACE_ID, {});
    const todayRow = summary.throughput.find((day) => day.date === today)!;
    expect(todayRow.created).toBe(1);
    expect(todayRow.completed).toBe(1);
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
