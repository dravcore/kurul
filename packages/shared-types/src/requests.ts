/**
 * Request bodies accepted by the Nest API, as the client sees them.
 *
 * Manually mirrors the `class-validator` DTOs under each `apps/api/src` feature module's
 * `dto` folder — same rule as `enums.ts` mirroring the Prisma schema. Length, format and
 * enum constraints stay on the server; these types only describe shape and nullability, so
 * a client cannot send a field the endpoint would reject outright.
 *
 * An optional property means "omit to leave unchanged / fall back to the server default".
 * An explicit `null` means "clear this value" and is only allowed where the DTO accepts it.
 *
 * Only the endpoints the web client actually calls are mirrored here. A shape nothing imports
 * buys no type safety and silently drifts from the DTO it claims to mirror, so the entry is
 * added with the first caller — `PATCH /labels/:labelId` and `PATCH /workspaces/:workspaceId`
 * exist on the server but have no UI yet.
 */
import type { ColumnCategory, LabelColorSlot, MemberRole, Priority } from './enums.js';
import type { Locale } from './locales.js';

/**
 * `PATCH /me`
 *
 * The signed-in user's own profile. Only the interface language is editable today; name,
 * email and avatar still go through Better Auth's own endpoints.
 */
export interface UpdateMeRequest {
  /**
   * Omit to leave unchanged. An explicit `null` clears the preference back to "follow the
   * browser's `Accept-Language`", which is a real choice and not the same as picking English.
   */
  locale?: Locale | null;
}

/** `POST /workspaces/:workspaceId/boards/:boardId/tasks` */
export interface CreateTaskRequest {
  title: string;
  columnId: string;
  description?: string | null;
  /** Omit to fall back to the server default (`Priority.MEDIUM`). */
  priority?: Priority;
  dueDate?: string | null;
  /** Effort, never a deadline — kept separate from `dueDate`. */
  estimatedMinutes?: number | null;
  /** Insert after this task in the target column; omit to append. */
  afterTaskId?: string | null;
}

/** `PATCH /workspaces/:workspaceId/tasks/:taskId` */
export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
}

/**
 * `PATCH /workspaces/:workspaceId/tasks/:taskId/position`
 *
 * Neighbors, never a position: the server owns the Float it lands on.
 */
export interface MoveTaskRequest {
  columnId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/assignees` */
export interface AddAssigneeRequest {
  userId: string;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/labels` */
export interface AddTaskLabelRequest {
  labelId: string;
}

/** `POST /workspaces/:workspaceId/boards` */
export interface CreateBoardRequest {
  name: string;
  description?: string | null;
}

/** `PATCH /workspaces/:workspaceId/boards/:boardId` */
export interface UpdateBoardRequest {
  name?: string;
  description?: string | null;
}

/** `POST /workspaces/:workspaceId/boards/:boardId/columns` */
export interface CreateColumnRequest {
  name: string;
  /** Insert after this column; omit to append. */
  afterColumnId?: string | null;
  color?: string;
  /** Omit to fall back to the server default (`ColumnCategory.UNSTARTED`). */
  category?: ColumnCategory;
}

/** `PATCH /workspaces/:workspaceId/columns/:columnId` */
export interface UpdateColumnRequest {
  name?: string;
  color?: string | null;
  category?: ColumnCategory;
}

/** `PATCH /workspaces/:workspaceId/columns/:columnId/position` */
export interface MoveColumnRequest {
  beforeColumnId?: string | null;
  afterColumnId?: string | null;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/comments` */
export interface CreateCommentRequest {
  body: string;
}

/** `POST /workspaces/:workspaceId/boards/:boardId/labels` */
export interface CreateLabelRequest {
  name: string;
  /** Design-token slot, never a raw hex value. */
  color: LabelColorSlot;
}

/** `POST /workspaces` */
export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
}

/**
 * `POST /workspaces/:workspaceId/invitations`
 *
 * `role` stays the full `MemberRole` union even though `CreateInvitationDto` rejects `OWNER`
 * outright (`@IsNotIn`): ownership is handed to someone who is already a member, never mailed
 * to an address that has not accepted anything yet. Narrowing it here would move that rule
 * into the type system, where the client could no longer see — or explain — the `400` the
 * server answers with. Same division as everywhere else in this file: shape here, constraints
 * on the server.
 */
export interface CreateInvitationRequest {
  email: string;
  role: MemberRole;
}

/**
 * `PATCH /workspaces/:workspaceId/members/:userId/role`
 *
 * `OWNER` *is* reachable here — promotion is how ownership is transferred — but only for a
 * caller who is already an OWNER, which is a question about the caller and not about the
 * body, so it is answered by `WorkspaceMemberService` with a `403`.
 */
export interface UpdateMemberRoleRequest {
  role: MemberRole;
}
