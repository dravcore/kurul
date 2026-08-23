/**
 * Socket.io event names and thin ID payloads — Phase 9 board realtime.
 * Full DTOs are fetched over REST when the client needs richer data.
 */

export const SocketEvents = {
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_MOVED: 'task:moved',
  TASK_DELETED: 'task:deleted',
  COLUMN_CHANGED: 'column:changed',
  COMMENT_ADDED: 'comment:added',
  /**
   * The recipient's unread notification count changed in this workspace — a new notification
   * was stored, or one was marked read (possibly from another tab of the same user).
   *
   * Deliberately a signal, not the notification itself: the badge only needs a number, and a
   * per-user room is a channel every tab of that user holds open, so pushing titles and
   * mention text into it would broadcast content no open view is currently showing. The
   * client answers with `GET .../notifications/unread-count` — one integer — and refetches
   * the rows only when the dropdown or the list page is actually open.
   */
  NOTIFICATION_UNREAD_CHANGED: 'notification:unread-changed',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

/** Client → server room control. */
export const SocketClientEvents = {
  BOARD_JOIN: 'board:join',
  BOARD_LEAVE: 'board:leave',
  /**
   * Join the caller's own notification room. The payload names the workspace only — the
   * recipient is always the session user, resolved server-side, never sent by the client.
   */
  NOTIFICATIONS_JOIN: 'notifications:join',
  NOTIFICATIONS_LEAVE: 'notifications:leave',
} as const;

export type SocketClientEventName = (typeof SocketClientEvents)[keyof typeof SocketClientEvents];

/**
 * The message a refused handshake carries, as the `connect_error` the client receives.
 *
 * Shared rather than duplicated because it is a wire contract: the API refuses an
 * unauthenticated handshake with it in Socket.io middleware, and the client matches on it to
 * tell "this session is not usable" apart from "the server is not reachable" — two conditions
 * that need different retry behaviour and different words on screen.
 */
export const SOCKET_UNAUTHORIZED = 'unauthorized' as const;

interface BoardScopedPayload {
  workspaceId: string;
  boardId: string;
  /** Acting user — clients may skip self-echo side effects. */
  actorId: string;
}

export interface TaskCreatedPayload extends BoardScopedPayload {
  taskId: string;
}

export interface TaskUpdatedPayload extends BoardScopedPayload {
  taskId: string;
}

export interface TaskMovedPayload extends BoardScopedPayload {
  taskId: string;
  columnId: string;
  position: number;
}

export interface TaskDeletedPayload extends BoardScopedPayload {
  taskId: string;
}

export interface ColumnChangedPayload extends BoardScopedPayload {
  columnId: string;
}

export interface CommentAddedPayload extends BoardScopedPayload {
  taskId: string;
  commentId: string;
}

export interface NotificationUnreadChangedPayload {
  /** Tenant the badge belongs to; a client showing another workspace ignores it. */
  workspaceId: string;
  /** Recipient. Always the session user the room was opened for — carried so a client can assert it. */
  userId: string;
}

/** Events published to a board room — every member of the board sees them. */
export type BoardSocketEventPayloadMap = {
  [SocketEvents.TASK_CREATED]: TaskCreatedPayload;
  [SocketEvents.TASK_UPDATED]: TaskUpdatedPayload;
  [SocketEvents.TASK_MOVED]: TaskMovedPayload;
  [SocketEvents.TASK_DELETED]: TaskDeletedPayload;
  [SocketEvents.COLUMN_CHANGED]: ColumnChangedPayload;
  [SocketEvents.COMMENT_ADDED]: CommentAddedPayload;
};

/** Events published to a single recipient's room, scoped to one workspace. */
export type UserSocketEventPayloadMap = {
  [SocketEvents.NOTIFICATION_UNREAD_CHANGED]: NotificationUnreadChangedPayload;
};

export type SocketEventPayloadMap = BoardSocketEventPayloadMap & UserSocketEventPayloadMap;

/**
 * The two names are kept apart so the emitter cannot mix the rooms up: a user-scoped event
 * published to a board room would hand one member's private signal to the whole board.
 */
export type BoardSocketEventName = keyof BoardSocketEventPayloadMap;
export type UserSocketEventName = keyof UserSocketEventPayloadMap;

export interface BoardJoinPayload {
  boardId: string;
}

export interface BoardLeavePayload {
  boardId: string;
}

export interface NotificationsJoinPayload {
  workspaceId: string;
}

export interface NotificationsLeavePayload {
  workspaceId: string;
}
