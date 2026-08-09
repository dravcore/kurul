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
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

/** Client → server room control. */
export const SocketClientEvents = {
  BOARD_JOIN: 'board:join',
  BOARD_LEAVE: 'board:leave',
} as const;

export type SocketClientEventName = (typeof SocketClientEvents)[keyof typeof SocketClientEvents];

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

export type SocketEventPayloadMap = {
  [SocketEvents.TASK_CREATED]: TaskCreatedPayload;
  [SocketEvents.TASK_UPDATED]: TaskUpdatedPayload;
  [SocketEvents.TASK_MOVED]: TaskMovedPayload;
  [SocketEvents.TASK_DELETED]: TaskDeletedPayload;
  [SocketEvents.COLUMN_CHANGED]: ColumnChangedPayload;
  [SocketEvents.COMMENT_ADDED]: CommentAddedPayload;
};

export interface BoardJoinPayload {
  boardId: string;
}

export interface BoardLeavePayload {
  boardId: string;
}
