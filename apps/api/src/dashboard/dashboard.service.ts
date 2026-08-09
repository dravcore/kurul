import { Injectable } from '@nestjs/common';
import { ActivityType, Priority } from '@kurultay/shared-types';
import type {
  DashboardCountByAssignee,
  DashboardCountByColumn,
  DashboardCountByPriority,
  DashboardSummaryDto,
} from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { assertBoard } from '../common/board-access';
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
        name: { equals: 'Done', mode: 'insensitive' },
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
        take: ASSIGNEE_TOP_N + 20,
      }),
      this.prisma.task.count({
        where: { ...taskWhere, assignees: { none: {} } },
      }),
      query.boardId
        ? this.prisma.column.findMany({
            where: { boardId: query.boardId, board: { workspaceId } },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, position: true },
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
    if (columns) {
      const columnCounts = await this.prisma.task.groupBy({
        by: ['columnId'],
        where: taskWhere,
        _count: { _all: true },
      });
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

  private async countActivitiesByDay(
    workspaceId: string,
    type: string,
    since: Date,
    boardId?: string,
  ): Promise<DayCountRow[]> {
    if (boardId) {
      return this.prisma.$queryRaw<DayCountRow[]>`
        SELECT date_trunc('day', a."createdAt" AT TIME ZONE 'UTC') AS day,
               COUNT(*)::int AS count
        FROM "Activity" a
        INNER JOIN "Task" t ON t."id" = a."taskId"
        WHERE a."workspaceId" = ${workspaceId}
          AND a."type" = ${type}
          AND a."createdAt" >= ${since}
          AND t."boardId" = ${boardId}
        GROUP BY 1
      `;
    }
    return this.prisma.$queryRaw<DayCountRow[]>`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day,
             COUNT(*)::int AS count
      FROM "Activity"
      WHERE "workspaceId" = ${workspaceId}
        AND "type" = ${type}
        AND "createdAt" >= ${since}
      GROUP BY 1
    `;
  }

  private async countCompletedMovesByDay(
    workspaceId: string,
    since: Date,
    doneColumnIds: string[],
    boardId?: string,
  ): Promise<DayCountRow[]> {
    if (boardId) {
      return this.prisma.$queryRaw<DayCountRow[]>`
        SELECT date_trunc('day', a."createdAt" AT TIME ZONE 'UTC') AS day,
               COUNT(*)::int AS count
        FROM "Activity" a
        INNER JOIN "Task" t ON t."id" = a."taskId"
        WHERE a."workspaceId" = ${workspaceId}
          AND a."type" = ${ActivityType.TaskMoved}
          AND a."createdAt" >= ${since}
          AND t."boardId" = ${boardId}
          AND (
            lower(trim(both from COALESCE(a."payload"->>'toColumnName', ''))) = 'done'
            OR a."payload"->>'toColumnId' = ANY(${doneColumnIds})
          )
        GROUP BY 1
      `;
    }
    return this.prisma.$queryRaw<DayCountRow[]>`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day,
             COUNT(*)::int AS count
      FROM "Activity"
      WHERE "workspaceId" = ${workspaceId}
        AND "type" = ${ActivityType.TaskMoved}
        AND "createdAt" >= ${since}
        AND (
          lower(trim(both from COALESCE("payload"->>'toColumnName', ''))) = 'done'
          OR "payload"->>'toColumnId' = ANY(${doneColumnIds})
        )
      GROUP BY 1
    `;
  }

  private async buildAssigneeBuckets(
    rows: Array<{ userId: string; _count: { _all: number } }>,
    unassignedCount: number,
  ): Promise<DashboardCountByAssignee[]> {
    const buckets: DashboardCountByAssignee[] = [];

    if (unassignedCount > 0) {
      buckets.push({ userId: null, name: 'Unassigned', count: unassignedCount });
    }

    if (rows.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.userId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(users.map((user) => [user.id, user.name] as const));
      for (const row of rows) {
        buckets.push({
          userId: row.userId,
          name: nameById.get(row.userId) ?? row.userId,
          count: row._count._all,
        });
      }
    }

    buckets.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    if (buckets.length <= ASSIGNEE_TOP_N) {
      return buckets;
    }

    const top = buckets.slice(0, ASSIGNEE_TOP_N);
    const otherCount = buckets.slice(ASSIGNEE_TOP_N).reduce((sum, row) => sum + row.count, 0);
    if (otherCount > 0) {
      top.push({ userId: null, name: 'Other', count: otherCount });
    }
    return top;
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
