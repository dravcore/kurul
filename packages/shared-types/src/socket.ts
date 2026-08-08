export const SocketEvents = {
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_MOVED: 'task:moved',
  TASK_DELETED: 'task:deleted',
  COLUMN_CHANGED: 'column:changed',
  COMMENT_ADDED: 'comment:added',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

export interface TaskCreatedPayload {
  workspaceId: string;
  boardId: string;
  taskId: string;
}

export interface TaskUpdatedPayload {
  workspaceId: string;
  boardId: string;
  taskId: string;
}

export interface TaskMovedPayload {
  workspaceId: string;
  boardId: string;
  taskId: string;
  columnId: string;
  position: number;
}

export interface TaskDeletedPayload {
  workspaceId: string;
  boardId: string;
  taskId: string;
}

export interface ColumnChangedPayload {
  workspaceId: string;
  boardId: string;
  columnId: string;
}

export interface CommentAddedPayload {
  workspaceId: string;
  boardId: string;
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
