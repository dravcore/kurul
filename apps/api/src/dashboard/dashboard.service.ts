import { Injectable } from '@nestjs/common';
import { ActivityType, Priority } from '@kurultay/shared-types';
import type {
  DashboardCountByAssignee,
  DashboardCountByColumn,
  DashboardCountByPriority,
  DashboardSummaryDto,
} from '@kurultay/shared-types';
import { Prisma } from '../generated/prisma';
import { assertBoard } from '../common/board-access';
import { DONE_COLUMN_NAME_NORMALIZED, doneColumnNameFilter } from '../common/board-defaults';
import { PrismaService } from '../prisma/prisma.service';
import type { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  applyThroughputDayCounts,
  emptyThroughputSeries,
  utcDateKey,
} from './dashboard-throughput';

const ALL_PRIORITIES = Object.values(Priority);
const ASSIGNEE_TOP_N = 8;

type DayCountRow = { day: Date; count: number | bigint };

/**
 * One row per UTC day. `date_trunc` is applied to the timestamp cast into UTC so the
 * bucket boundaries match the `YYYY-MM-DD` keys the throughput series is built from,
 * whatever the server's local zone happens to be.
 */
const DAY_COUNT_SELECT = Prisma.sql`
  SELECT date_trunc('day', a."createdAt" AT TIME ZONE 'UTC') AS day,
         COUNT(*)::int AS count
  FROM "Activity" a
`;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(workspaceId: string, query: DashboardQueryDto): Promise<DashboardSummaryDto> {
    if (query.boardId) {
      await assertBoard(this.prisma, workspaceId, query.boardId);
    }

    const taskWhere: Prisma.TaskWhereInput = {
      board: { workspaceId },
      ...(query.boardId ? { boardId: query.boardId } : {}),
    };

    const now = new Date();
    const throughputSeries = emptyThroughputSeries(now);
    const since = new Date(`${throughputSeries[0]!.date}T00:00:00.000Z`);

    const doneColumns = await this.prisma.column.findMany({
      where: {
        board: { workspaceId },
        ...(query.boardId ? { boardId: query.boardId } : {}),
        name: doneColumnNameFilter,
      },
      select: { id: true },
    });
    const doneColumnIds = doneColumns.map((column) => column.id);

    const [
      totalTasks,
      overdueCount,
      priorityGroups,
      assigneeRows,
      unassignedCount,
      columns,
      columnCounts,
      createdDays,
      completedDays,
    ] = await Promise.all([
      this.prisma.task.count({ where: taskWhere }),
      this.prisma.task.count({
        where: {
          ...taskWhere,
          dueDate: { not: null, lt: now },
          ...(doneColumnIds.length > 0 ? { columnId: { notIn: doneColumnIds } } : {}),
        },
      }),
      this.prisma.task.groupBy({
        by: ['priority'],
        where: taskWhere,
        _count: { _all: true },
      }),
      this.prisma.taskAssignee.groupBy({
        by: ['userId'],
        where: { task: taskWhere },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
      }),
      this.prisma.task.count({
        where: { ...taskWhere, assignees: { none: {} } },
      }),
      // `columns` and `columnCounts` are independent of each other — both only need
      // `query.boardId`, not one another's result — so they run in the same wave.
      query.boardId
        ? this.prisma.column.findMany({
            where: { boardId: query.boardId, board: { workspaceId } },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, position: true },
          })
        : Promise.resolve(null),
      query.boardId
        ? this.prisma.task.groupBy({
            by: ['columnId'],
            where: taskWhere,
            _count: { _all: true },
          })
        : Promise.resolve(null),
      this.countActivitiesByDay(workspaceId, ActivityType.TaskCreated, since, query.boardId),
      this.countCompletedMovesByDay(workspaceId, since, doneColumnIds, query.boardId),
    ]);

    const byPriority: DashboardCountByPriority[] = ALL_PRIORITIES.map((priority) => ({
      priority,
      count: priorityGroups.find((row) => row.priority === priority)?._count._all ?? 0,
    }));

    const byAssignee = await this.buildAssigneeBuckets(assigneeRows, unassignedCount);

    let byColumn: DashboardCountByColumn[] | null = null;
    if (columns && columnCounts) {
      const countByColumn = new Map(
        columnCounts.map((row) => [row.columnId, row._count._all] as const),
      );
      byColumn = columns.map((column) => ({
        columnId: column.id,
        name: column.name,
        position: column.position,
        count: countByColumn.get(column.id) ?? 0,
      }));
    }

    const throughput = applyThroughputDayCounts(
      throughputSeries,
      toDayCountMap(createdDays),
      toDayCountMap(completedDays),
    );

    return {
      totalTasks,
      overdueCount,
      byPriority,
      byAssignee,
      byColumn,
      throughput,
    };
  }

  /**
   * Day buckets for one activity type, optionally narrowed to a single board.
   *
   * The board filter needs the `Task` join, so it is the join and the predicate that vary
   * together — everything else is shared, which is why both callers go through here rather
   * than each carrying a with-board and a without-board copy of the same query.
   */
  private countActivitiesByDay(
    workspaceId: string,
    type: string,
    since: Date,
    boardId: string | undefined,
    extraFilter: Prisma.Sql = Prisma.empty,
  ): Promise<DayCountRow[]> {
    const boardJoin = boardId
      ? Prisma.sql`INNER JOIN "Task" t ON t."id" = a."taskId"`
      : Prisma.empty;
    const boardFilter = boardId ? Prisma.sql`AND t."boardId" = ${boardId}` : Prisma.empty;

    return this.prisma.$queryRaw<DayCountRow[]>`
      ${DAY_COUNT_SELECT}
      ${boardJoin}
      WHERE a."workspaceId" = ${workspaceId}
        AND a."type" = ${type}
        AND a."createdAt" >= ${since}
        ${boardFilter}
        ${extraFilter}
      GROUP BY 1
    `;
  }

  /**
   * A task counts as completed when it was moved into a Done column. The recorded column
   * id is checked first, with the recorded column *name* as a fallback so moves into a
   * column that has since been deleted or renamed still show up in history.
   */
  private countCompletedMovesByDay(
    workspaceId: string,
    since: Date,
    doneColumnIds: string[],
    boardId?: string,
  ): Promise<DayCountRow[]> {
    return this.countActivitiesByDay(
      workspaceId,
      ActivityType.TaskMoved,
      since,
      boardId,
      Prisma.sql`AND (
        lower(trim(both from COALESCE(a."payload"->>'toColumnName', ''))) = ${DONE_COLUMN_NAME_NORMALIZED}
        OR a."payload"->>'toColumnId' = ANY(${doneColumnIds})
      )`,
    );
  }

  private async buildAssigneeBuckets(
    rows: Array<{ userId: string; _count: { _all: number } }>,
    unassignedCount: number,
  ): Promise<DashboardCountByAssignee[]> {
    const assigned: DashboardCountByAssignee[] = [];

    if (rows.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.userId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(users.map((user) => [user.id, user.name] as const));
      for (const row of rows) {
        assigned.push({
          userId: row.userId,
          name: nameById.get(row.userId) ?? row.userId,
          count: row._count._all,
        });
      }
    }

    assigned.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const buckets: DashboardCountByAssignee[] = [];
    if (unassignedCount > 0) {
      buckets.push({ userId: null, name: 'Unassigned', count: unassignedCount });
    }

    if (assigned.length <= ASSIGNEE_TOP_N) {
      buckets.push(...assigned);
      return buckets;
    }

    buckets.push(...assigned.slice(0, ASSIGNEE_TOP_N));
    const otherCount = assigned.slice(ASSIGNEE_TOP_N).reduce((sum, row) => sum + row.count, 0);
    if (otherCount > 0) {
      buckets.push({ userId: null, name: 'Other', count: otherCount });
    }
    return buckets;
  }
}

function toDayCountMap(rows: DayCountRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = utcDateKey(new Date(row.day));
    map.set(key, Number(row.count));
  }
  return map;
}
