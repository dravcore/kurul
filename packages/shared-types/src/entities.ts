import type {
  ColumnCategory,
  InvitationStatus,
  LabelColorSlot,
  MemberRole,
  Priority,
} from './enums.js';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface WorkspaceMemberDto {
  id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  name: string;
  avatarUrl: string | null;
}

export interface InvitationDto {
  id: string;
  workspaceId: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  expiresAt: string;
  /** Computed client convenience URL — not a database column. */
  acceptUrl: string;
}

export interface BoardDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface ColumnDto {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  /**
   * Semantic state, independent of `name` and of position. Metrics key off this; a client
   * that wants to know whether a column means "finished" reads `category`, never the label
   * the user typed.
   */
  category: ColumnCategory;
  taskCount: number;
}

export interface TaskDto {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  dueDate: string | null;
  estimatedMinutes: number | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  assignees: TaskAssigneeDto[];
  labels: LabelDto[];
}

export interface TaskAssigneeDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface LabelDto {
  id: string;
  boardId: string;
  name: string;
  color: LabelColorSlot;
}

export interface CommentDto {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
}

export interface ActivityDto {
  id: string;
  workspaceId: string;
  taskId: string | null;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
}

export interface NotificationDto {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  taskId: string | null;
  activityId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationUnreadCountDto {
  count: number;
}

/** Default list pagination shape (keyed on `id`, never `position`). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore?: boolean;
}

export interface DashboardCountByPriority {
  priority: Priority;
  count: number;
}

/**
 * One bar of the workload-by-assignee chart.
 *
 * **`count` is assignments, not tasks.** A task with three assignees contributes one to each
 * of them, so `Σ byAssignee` deliberately exceeds `totalTasks` on any board that uses
 * multiple assignees. That is the intended reading, not a discrepancy to reconcile: the
 * chart answers "how much is on each person's plate", and attributing a shared task to
 * exactly one of its assignees would have to pick a winner arbitrarily and under-report
 * everyone else. `Unassigned` is the exception and is a task count, because a task with
 * nobody on it has no assignment row to aggregate.
 *
 * The reasoning lives in full on `DashboardService.rankedAssigneeBuckets`; it is repeated
 * here because a consumer reading only this package would otherwise see two totals that do
 * not add up and treat one of them as a bug.
 */
export interface DashboardCountByAssignee {
  /** `null` for Unassigned or Other aggregate buckets. */
  userId: string | null;
  name: string;
  count: number;
}

export interface DashboardCountByColumn {
  columnId: string;
  name: string;
  position: number;
  count: number;
}

/** One UTC calendar day in the created-vs-completed series. */
export interface DashboardThroughputDay {
  /** ISO date `YYYY-MM-DD` (UTC). */
  date: string;
  created: number;
  completed: number;
}

/** Workspace (or board-scoped) dashboard aggregates — Phase 7. */
export interface DashboardSummaryDto {
  totalTasks: number;
  overdueCount: number;
  byPriority: DashboardCountByPriority[];
  byAssignee: DashboardCountByAssignee[];
  /** Present only when `boardId` query is set. */
  byColumn: DashboardCountByColumn[] | null;
  /** Last 14 UTC days: `task.created` vs moves into a `COMPLETED` column. */
  throughput: DashboardThroughputDay[];
}
