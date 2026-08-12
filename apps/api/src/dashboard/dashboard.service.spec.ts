import { NotFoundException } from '@nestjs/common';
import { Priority } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyThroughputDayCounts,
  emptyThroughputSeries,
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
      column: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return { service: new DashboardService(prisma as unknown as PrismaService), prisma };
  }

  /**
   * `summary` issues its raw queries in a fixed order inside one `Promise.all`: assignee
   * buckets, then created-per-day, then completed-per-day. Naming them here keeps the tests
   * from spelling out a chain of `mockResolvedValueOnce` whose meaning is positional.
   */
  function mockRawQueries(
    prisma: ReturnType<typeof buildService>['prisma'],
    results: {
      assignees?: Array<{ userId: string | null; name: string; count: number }>;
      created?: Array<{ day: Date; count: number }>;
      completed?: Array<{ day: Date; count: number }>;
    } = {},
  ): void {
    prisma.$queryRaw
      .mockResolvedValueOnce(results.assignees ?? [])
      .mockResolvedValueOnce(results.created ?? [])
      .mockResolvedValueOnce(results.completed ?? []);
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
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
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
    mockRawQueries(prisma, {
      created: [{ day: new Date(`${today}T00:00:00.000Z`), count: 1 }],
      completed: [{ day: new Date(`${today}T00:00:00.000Z`), count: 1 }],
    });

    const summary = await service.summary(WORKSPACE_ID, {});
    const todayRow = summary.throughput.find((day) => day.date === today)!;
    expect(todayRow.created).toBe(1);
    expect(todayRow.completed).toBe(1);
  });

  it('puts Unassigned ahead of the ranked buckets the database returned', async () => {
    const { service, prisma } = buildService();
    // totalTasks, overdueCount, then unassignedCount.
    prisma.task.count.mockResolvedValueOnce(9).mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    prisma.task.groupBy.mockResolvedValue([]);
    mockRawQueries(prisma, {
      assignees: [
        { userId: 'u1', name: 'Ada', count: 5 },
        { userId: null, name: 'Other', count: 3 },
      ],
    });

    const summary = await service.summary(WORKSPACE_ID, {});

    expect(summary.byAssignee).toEqual([
      { userId: null, name: 'Unassigned', count: 4 },
      { userId: 'u1', name: 'Ada', count: 5 },
      { userId: null, name: 'Other', count: 3 },
    ]);
  });

  it('omits the Unassigned bucket when every task has an assignee', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.task.groupBy.mockResolvedValue([]);
    mockRawQueries(prisma, { assignees: [{ userId: 'u1', name: 'Ada', count: 5 }] });

    const summary = await service.summary(WORKSPACE_ID, {});

    expect(summary.byAssignee).toEqual([{ userId: 'u1', name: 'Ada', count: 5 }]);
  });

  it('ranks and folds assignees in SQL rather than reading every assignment into Node', async () => {
    const { service, prisma } = buildService();
    prisma.task.count.mockResolvedValue(0);
    prisma.task.groupBy.mockResolvedValue([]);
    mockRawQueries(prisma);

    await service.summary(WORKSPACE_ID, {});

    const sql = (prisma.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    // The top-N split and the "Other" total are the database's job — that is the whole point
    // of the query, and doing either in Node means every assignment row crossed the wire.
    expect(sql).toContain('ROW_NUMBER()');
    expect(sql).toContain("'Other'");
    expect(sql).toContain('"rn" <= ');
    // No name lookup follows the aggregate: the join inside the query already resolved them.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('returns 404 when boardId is outside the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.board.findFirst.mockResolvedValue(null);

    await expect(service.summary(WORKSPACE_ID, { boardId: BOARD_ID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
