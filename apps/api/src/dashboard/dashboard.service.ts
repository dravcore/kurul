import { Injectable } from '@nestjs/common';
import { ActivityType, ColumnCategory, Priority } from '@kurul/shared-types';
import type {
  DashboardCountByAssignee,
  DashboardCountByColumn,
  DashboardCountByPriority,
  DashboardSummaryDto,
} from '@kurul/shared-types';
import { Prisma } from '../generated/prisma';
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

/**
 * One row per UTC day. `a."createdAt"` is stored as naive UTC (TIMESTAMP(3), not timestamptz),
 * and `date_trunc` is called with three arguments where the second is the cast and the third
 * explicitly specifies UTC as the truncation zone. This ensures bucket boundaries are always
 * aligned to UTC midnight regardless of the database session's timezone setting — critical for
 * environments that override PostgreSQL's default UTC with a different `TZ` or `PGTZ`.
 *
 * The two-argument form `date_trunc('day', value)` would truncate in the session timezone
 * instead, causing midnight boundaries to misalign with throughput keys (which are always UTC).
 * This was masked in development by Docker's UTC default but would break in self-hosted
 * deployments setting TZ=Europe/Istanbul or similar.
 *
 * Exported for regression testing: tests can import and verify that this form produces
 * timezone-independent results.
 */
export const DAY_COUNT_SELECT = Prisma.sql`
  SELECT date_trunc('day', a."createdAt" AT TIME ZONE 'UTC', 'UTC') AS day,
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

    // A set, never a single row: a board may legitimately split completion across several
    // columns ("Shipped" and "Won't Do"), and nothing in the schema or the UI stops it.
    const completedColumns = await this.prisma.column.findMany({
      where: {
        board: { workspaceId },
        ...(query.boardId ? { boardId: query.boardId } : {}),
        category: ColumnCategory.COMPLETED,
      },
      select: { id: true },
    });
    const completedColumnIds = completedColumns.map((column) => column.id);

    const [
      totalTasks,
      overdueCount,
      priorityGroups,
      assigneeBuckets,
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
          // Overdue means "late and still open", so every completed column is excluded, not
          // just the first one found.
          ...(completedColumnIds.length > 0 ? { columnId: { notIn: completedColumnIds } } : {}),
        },
      }),
      this.prisma.task.groupBy({
        by: ['priority'],
        where: taskWhere,
        _count: { _all: true },
      }),
      this.rankedAssigneeBuckets(workspaceId, query.boardId),
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
      this.countCompletedMovesByDay(workspaceId, since, completedColumnIds, query.boardId),
    ]);

    const byPriority: DashboardCountByPriority[] = ALL_PRIORITIES.map((priority) => ({
      priority,
      count: priorityGroups.find((row) => row.priority === priority)?._count._all ?? 0,
    }));

    // Unassigned leads, then the database's ranking, then its "Other" tail — the one bucket
    // the query cannot produce is the one that has no assignee row to aggregate.
    const byAssignee: DashboardCountByAssignee[] =
      unassignedCount > 0
        ? [{ userId: null, name: 'Unassigned', count: unassignedCount }, ...assigneeBuckets]
        : assigneeBuckets;

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
   * A task counts as completed when it was moved into a column that means "completed".
   *
   * Two branches, each answering a different question, ORed because either one is enough:
   *
   * 1. **The column is `COMPLETED` now** (`completedColumnIds`). This is the branch that
   *    repairs a board: the moment someone marks their "Shipped" column as completed in
   *    column settings, the last {@link THROUGHPUT_DAYS} days of moves into it start
   *    counting. Without it the category UI would only fix the future.
   * 2. **The column was `COMPLETED` at the time** (`toColumnCategory` in the payload). This
   *    is the branch that survives deletion — once the column row is gone its id resolves to
   *    nothing, and the activity log is the only remaining record of what that move meant.
   *
   * What used to sit in slot 2 was a match on the recorded column *name* against `'done'`.
   * It is deleted rather than translated: a name predicate cannot be made to work for a
   * column called "Bitti" or "Shipped", which is the whole of
   * docs/decisions/0019-column-category.md. Activity rows written before this shipped carry
   * no `toColumnCategory`, so for them only branch 1 applies, and a move into a column that
   * was both renamed *and* deleted inside the window is lost. That gap closes on its own
   * {@link THROUGHPUT_DAYS} days after deploy, which is why no explicit cutover marker is
   * stored: the query never reads an activity older than the window.
   *
   * The OR is deliberately generous in one direction — re-categorising a column *away* from
   * `COMPLETED` does not retroactively un-count moves recorded while it was completed. That
   * is the safer of the two errors, and strictly narrower than the old behaviour, where any
   * column ever named "Done" counted forever.
   */
  private countCompletedMovesByDay(
    workspaceId: string,
    since: Date,
    completedColumnIds: string[],
    boardId?: string,
  ): Promise<DayCountRow[]> {
    return this.countActivitiesByDay(
      workspaceId,
      ActivityType.TaskMoved,
      since,
      boardId,
      Prisma.sql`AND (
        a."payload"->>'toColumnId' = ANY(${completedColumnIds})
        OR a."payload"->>'toColumnCategory' = ${ColumnCategory.COMPLETED}
      )`,
    );
  }

  /**
   * The top {@link ASSIGNEE_TOP_N} assignees followed by a single `Other` row, ranked and
   * folded by the database.
   *
   * Done in Node this was a `groupBy` over every assignment plus a `user.findMany` for the
   * names, which pulls one row per distinct assignee across the wire so that all but eight of
   * them can be discarded and summed. A window function ranks the rows where they already
   * live, so the result set is bounded at N + 1 no matter how large the workspace grows.
   *
   * **`count` is assignments, not tasks.** A task with three assignees is counted once for
   * each of them, so `Σ byAssignee` deliberately exceeds `totalTasks` on any board that uses
   * multiple assignees. This chart answers "how much is on each person's plate", and the
   * alternative — attributing a shared task to exactly one of its assignees — would have to
   * pick a winner arbitrarily and would under-report everyone else. `Unassigned` is the
   * exception and is a task count, because a task with no assignee has no assignment row.
   *
   * The `Other` row is kept last rather than sorted in by size: it is a remainder, and a
   * reader who sees it above a named person reads it as a person.
   */
  private rankedAssigneeBuckets(
    workspaceId: string,
    boardId: string | undefined,
  ): Promise<DashboardCountByAssignee[]> {
    const boardFilter = boardId ? Prisma.sql`AND t."boardId" = ${boardId}` : Prisma.empty;

    return this.prisma.$queryRaw<DashboardCountByAssignee[]>`
      WITH counts AS (
        SELECT ta."userId" AS "userId", COUNT(*)::int AS "count"
        FROM "TaskAssignee" ta
        INNER JOIN "Task" t ON t."id" = ta."taskId"
        INNER JOIN "Board" b ON b."id" = t."boardId"
        WHERE b."workspaceId" = ${workspaceId}
          ${boardFilter}
        GROUP BY ta."userId"
      ),
      ranked AS (
        SELECT c."userId",
               -- LEFT JOIN plus COALESCE: a deleted-then-orphaned assignment still shows its
               -- weight rather than vanishing from the totals.
               COALESCE(u."name", c."userId") AS "name",
               c."count",
               ROW_NUMBER() OVER (
                 ORDER BY c."count" DESC, COALESCE(u."name", c."userId") ASC
               ) AS "rn"
        FROM counts c
        LEFT JOIN "User" u ON u."id" = c."userId"
      ),
      buckets AS (
        SELECT "userId", "name", "count", "rn"
        FROM ranked
        WHERE "rn" <= ${ASSIGNEE_TOP_N}::int
        UNION ALL
        -- HAVING with no GROUP BY yields exactly one row, or none when the tail is empty.
        SELECT NULL::text AS "userId",
               'Other' AS "name",
               SUM("count")::int AS "count",
               ${ASSIGNEE_TOP_N + 1}::bigint AS "rn"
        FROM ranked
        WHERE "rn" > ${ASSIGNEE_TOP_N}::int
        HAVING SUM("count") > 0
      )
      SELECT "userId", "name", "count"
      FROM buckets
      ORDER BY "rn"
    `;
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
