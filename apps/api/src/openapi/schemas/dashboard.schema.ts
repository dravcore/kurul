import type {
  DashboardCountByAssignee,
  DashboardCountByColumn,
  DashboardCountByPriority,
  DashboardSummaryDto,
  DashboardThroughputDay,
  Priority,
} from '@kurultay/shared-types';

/** Task count for one priority. */
export class DashboardCountByPrioritySchema implements DashboardCountByPriority {
  priority!: Priority;
  count!: number;
}

/**
 * One bar of the workload-by-assignee chart.
 *
 * **`count` is assignments, not tasks.** A task with three assignees contributes one to each,
 * so the sum deliberately exceeds `totalTasks` on a board that uses multiple assignees.
 * `Unassigned` is the exception and is a task count.
 */
export class DashboardCountByAssigneeSchema implements DashboardCountByAssignee {
  /** `null` for the `Unassigned` and `Other` aggregate buckets. */
  userId!: string | null;
  name!: string;
  count!: number;
}

/** Task count for one column. */
export class DashboardCountByColumnSchema implements DashboardCountByColumn {
  columnId!: string;
  name!: string;
  position!: number;
  count!: number;
}

/** One UTC calendar day of the created-vs-completed series. */
export class DashboardThroughputDaySchema implements DashboardThroughputDay {
  /** `YYYY-MM-DD`, UTC — the one date in this API that is not a full timestamp. */
  date!: string;
  created!: number;
  completed!: number;
}

/** Workspace (or board-scoped) aggregates. */
export class DashboardSummarySchema implements DashboardSummaryDto {
  totalTasks!: number;
  overdueCount!: number;
  byPriority!: DashboardCountByPrioritySchema[];
  byAssignee!: DashboardCountByAssigneeSchema[];
  /** Present only when `?boardId=` is set; `null` otherwise. */
  byColumn!: DashboardCountByColumnSchema[] | null;
  /** The last 14 UTC days. */
  throughput!: DashboardThroughputDaySchema[];
}
