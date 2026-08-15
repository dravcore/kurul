import type {
  ActivityDto,
  CommentDto,
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';

/** The person a comment or activity row is attributed to. */
export class AuthorSchema {
  id!: string;
  name!: string;
  avatarUrl!: string | null;
  /**
   * True when the account has been anonymised (ADR 0026). `name` then carries the stored
   * tombstone rather than a person's name, and a client is expected to render its own label
   * instead — which is why this is a flag rather than a string comparison against `name`.
   */
  deleted!: boolean;
}

/** A comment on a task. */
export class CommentSchema implements CommentDto {
  id!: string;
  taskId!: string;
  userId!: string;
  body!: string;
  createdAt!: string;
  author!: AuthorSchema;
}

/** One page of comments. */
export class CommentPageSchema implements CursorPage<CommentDto> {
  items!: CommentSchema[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

/** One row of an activity feed. */
export class ActivitySchema implements ActivityDto {
  id!: string;
  workspaceId!: string;
  taskId!: string | null;
  userId!: string;
  /** `ActivityType` — e.g. `task.created`, `task.moved`, `board.imported`. */
  type!: string;
  /** Shape varies by `type`; the client renders one sentence per type. */
  payload!: Record<string, unknown>;
  createdAt!: string;
  author!: AuthorSchema;
}

/** One page of activity rows. */
export class ActivityPageSchema implements CursorPage<ActivityDto> {
  items!: ActivitySchema[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

/** An in-app notification. */
export class NotificationSchema implements NotificationDto {
  id!: string;
  workspaceId!: string;
  userId!: string;
  /** `NotificationType`. */
  type!: string;
  taskId!: string | null;
  activityId!: string | null;
  payload!: Record<string, unknown>;
  /** ISO 8601 UTC when the recipient read it, or `null` while unread. */
  readAt!: string | null;
  createdAt!: string;
}

/** One page of notifications. */
export class NotificationPageSchema implements CursorPage<NotificationDto> {
  items!: NotificationSchema[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

/** How many notifications the caller has not read in this workspace. */
export class NotificationUnreadCountSchema implements NotificationUnreadCountDto {
  count!: number;
}

/** How many notifications `POST .../notifications/read-all` actually marked. */
export class MarkAllReadSchema {
  /** Rows changed. `0` when everything was already read — not an error. */
  updated!: number;
}
