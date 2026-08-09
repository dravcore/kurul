import type { InvitationStatus, LabelColorSlot, MemberRole, Priority } from './enums.js';

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
  /** Last 14 UTC days: `task.created` vs moves into a Done-named column. */
  throughput: DashboardThroughputDay[];
}
