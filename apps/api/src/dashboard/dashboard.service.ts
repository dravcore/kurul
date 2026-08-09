import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, Priority } from '@kurultay/shared-types';
import type {
  DashboardCountByAssignee,
  DashboardCountByColumn,
  DashboardCountByPriority,
  DashboardSummaryDto,
} from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import type { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  applyThroughputCounts,
  emptyThroughputSeries,
  isCompletedMove,
} from './dashboard-throughput';

const ALL_PRIORITIES = Object.values(Priority);
const ASSIGNEE_TOP_N = 8;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(workspaceId: string, query: DashboardQueryDto): Promise<DashboardSummaryDto> {
    if (query.boardId) {
      await this.findBoard(workspaceId, query.boardId);
    }

    const taskWhere: Prisma.TaskWhereInput = {
      board: { workspaceId },
      ...(query.boardId ? { boardId: query.boardId } : {}),
    };

    const now = new Date();
    const throughputSeries = emptyThroughputSeries(now);
    const since = new Date(`${throughputSeries[0]!.date}T00:00:00.000Z`);

    const activityWhere: Prisma.ActivityWhereInput = {
      workspaceId,
      createdAt: { gte: since },
      ...(query.boardId ? { task: { boardId: query.boardId } } : {}),
    };

    const [
      totalTasks,
      overdueCount,
      priorityGroups,
      assigneeRows,
      unassignedCount,
      columns,
      doneColumns,
      createdActivities,
      movedActivities,
    ] = await Promise.all([
      this.prisma.task.count({ where: taskWhere }),
      this.prisma.task.count({
        where: { ...taskWhere, dueDate: { not: null, lt: now } },
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
      query.boardId
        ? this.prisma.column.findMany({
            where: { boardId: query.boardId, board: { workspaceId } },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, position: true },
          })
        : Promise.resolve(null),
      this.prisma.column.findMany({
        where: {
          board: { workspaceId },
          ...(query.boardId ? { boardId: query.boardId } : {}),
          name: { equals: 'Done', mode: 'insensitive' },
        },
        select: { id: true },
      }),
      this.prisma.activity.findMany({
        where: { ...activityWhere, type: ActivityType.TaskCreated },
        select: { createdAt: true },
      }),
      this.prisma.activity.findMany({
        where: { ...activityWhere, type: ActivityType.TaskMoved },
        select: { createdAt: true, payload: true },
      }),
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

    const doneColumnIds = new Set(doneColumns.map((column) => column.id));
    const completedAts = movedActivities
      .filter((row) =>
        isCompletedMove((row.payload ?? {}) as Record<string, unknown>, doneColumnIds),
      )
      .map((row) => row.createdAt);

    const throughput = applyThroughputCounts(
      throughputSeries,
      createdActivities.map((row) => row.createdAt),
      completedAts,
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

  private async findBoard(workspaceId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, workspaceId } });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }
}
