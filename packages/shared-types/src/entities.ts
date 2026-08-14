import type {
  ColumnCategory,
  InvitationStatus,
  LabelColorSlot,
  MailDeliveryStatus,
  MemberRole,
  Priority,
} from './enums.js';
import type { Locale } from './locales.js';

/**
 * What this instance is configured to do — the answer to "is this feature switched on here",
 * asked by a client that cannot see the server's environment.
 *
 * Deployment capability, never tenant state: nothing in here varies by workspace, by role or
 * by caller, which is why it is served from a single account-level `GET /config` instead of
 * being repeated inside every workspace-scoped payload that happens to care.
 */
export interface InstanceConfigDto {
  /**
   * Whether outbound email has a transport that can actually deliver it.
   *
   * `false` means SMTP is unconfigured and every message is written to the API log instead —
   * so an invitee is never sent a link, cannot confirm their address, and therefore cannot
   * accept an invitation (`docs/decisions/0013-invitation-email-verification.md`). The web
   * app uses it to say so on the invite screen rather than letting an admin discover it from
   * a teammate who never got the email.
   */
  mailEnabled: boolean;
  /**
   * Whether this deployment stores attachments at all — i.e. whether `STORAGE_PATH` is set.
   *
   * A capability, like `mailEnabled`, never tenant state (`docs/api-conventions.md:175-177`).
   * The web reads it to decide whether to render the upload control. The *link* control does
   * not depend on it: a LINK needs no storage, so an instance with no `STORAGE_PATH` can still
   * attach links.
   */
  attachmentsEnabled: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /**
   * Chosen interface language as an IETF tag, or `null` for "never chose".
   *
   * `null` is a distinct state from `'en'`, not a missing value: an unset user follows their
   * browser's `Accept-Language`, so the web's resolution chain has to be able to tell the two
   * apart (docs/decisions/0018-localization-strategy.md).
   */
  locale: Locale | null;
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
  /**
   * What happened to the invitation email, when the response is one this API watched being
   * sent — `POST /workspaces/:workspaceId/invitations` and nothing else.
   *
   * **Absent is not `SENT`.** A listed invitation is a stored row, and delivery is an event
   * that happened when it was created; nothing records it, so a list cannot honestly report
   * one. Omitting the field is the only reading of "we did not observe this" that a client
   * cannot mistake for a verdict — which is the whole point, because the verdict this field
   * exists to deliver is `NOT_CONFIGURED`, and inferring it wrongly is exactly the silent
   * failure it is here to end.
   */
  emailDelivery?: MailDeliveryStatus;
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

export interface ChecklistItemDto {
  id: string;
  content: string;
  isDone: boolean;
  position: number;
}

export interface ChecklistDto {
  id: string;
  title: string;
  position: number;
  items: ChecklistItemDto[];
}

/**
 * The board card's progress badge, carried on every task read.
 *
 * Counted at read time rather than stored: a denormalized counter drifts from its items the
 * first time a delete misses it, and the count is cheap next to the join that already fetches
 * the task. The board list reads items with the narrowest projection there is (`isDone` only)
 * so the badge costs a boolean per item, not a row — see `task.include.ts`.
 */
export interface ChecklistSummaryDto {
  total: number;
  done: number;
}

/**
 * Whether an attachment carries stored bytes or only points at a URL.
 *
 * A `const` object rather than a TS `enum`, matching every other enum in this package: the
 * values are the strings Prisma writes and the API sends, and a structural type keeps
 * `@kurultay/shared-types` free of emitted runtime code the web bundle would have to carry.
 */
export const AttachmentKind = {
  File: 'FILE',
  Link: 'LINK',
} as const;

export type AttachmentKind = (typeof AttachmentKind)[keyof typeof AttachmentKind];

/**
 * One attachment on a task.
 *
 * The three FILE-only fields are `null` on a `LINK` and `url` is `null` on a `FILE`; `kind` is
 * what says which, and it is never inferred from the nulls (ADR 0024).
 *
 * There is deliberately no download URL in this DTO. The client builds it from `id` — the
 * endpoint is published in ADR 0022, and a server-rendered absolute URL would bake the
 * deployment's origin into a payload that the same-origin image goes out of its way not to
 * carry (`apps/web/lib/api-url.ts`).
 */
export interface AttachmentDto {
  id: string;
  taskId: string;
  kind: AttachmentKind;
  /** Display name. For a FILE this is what the browser sent; it never appears in a path. */
  filename: string;
  /** FILE only: the sniffed media type, never the one the client declared. */
  mimeType: string | null;
  /** FILE only: bytes. */
  size: number | null;
  /** LINK only: an `http:`/`https:` URL the server has never requested and never will. */
  url: string | null;
  uploadedById: string;
  createdAt: string;
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
  checklistSummary: ChecklistSummaryDto;
  /** Full checklists on a single-task read; `null` on list reads, where only the summary is loaded. */
  checklists: ChecklistDto[] | null;
  /**
   * How many attachments the task has, on every task read.
   *
   * A count and not a list, unlike `checklists`: the card needs the number and the panel reads
   * the full list from its own endpoint. Loading attachment rows into the board list would hand
   * back what P2-8 bought, and unlike a checklist there is no badge that needs their contents.
   */
  attachmentCount: number;
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
