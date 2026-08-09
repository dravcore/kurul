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
}

/** Default list pagination shape (keyed on `id`, never `position`). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore?: boolean;
}
