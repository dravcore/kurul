'use client';

import { useEffect, useRef, useState } from 'react';
import {
  SocketClientEvents,
  SocketEvents,
  type ColumnChangedPayload,
  type CommentAddedPayload,
  type TaskCreatedPayload,
  type TaskDeletedPayload,
  type TaskMovedPayload,
  type TaskUpdatedPayload,
} from '@kurultay/shared-types';
import { connectSocket } from '@/lib/socket';

export type BoardSocketHandlers = {
  onTaskCreated: (payload: TaskCreatedPayload) => void;
  onTaskUpdated: (payload: TaskUpdatedPayload) => void;
  onTaskMoved: (payload: TaskMovedPayload) => void;
  onTaskDeleted: (payload: TaskDeletedPayload) => void;
  onColumnChanged: (payload: ColumnChangedPayload) => void;
  onCommentAdded: (payload: CommentAddedPayload) => void;
  onResync: () => void;
};

/**
 * Join a board room while mounted. Handlers are read from a ref so callers can
 * pass unstable callbacks without re-subscribing.
 */
export function useBoardSocket(
  boardId: string | null,
  enabled: boolean,
  handlers: BoardSocketHandlers,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !boardId) return;

    const socket = connectSocket();

    function onConnect(): void {
      setConnected(true);
      socket.emit(
        SocketClientEvents.BOARD_JOIN,
        { boardId },
        (ack: { ok?: boolean } | undefined) => {
          if (ack?.ok) {
            handlersRef.current.onResync();
          }
        },
      );
    }

    function onDisconnect(): void {
      setConnected(false);
    }

    function onReconnect(): void {
      setConnected(true);
      socket.emit(SocketClientEvents.BOARD_JOIN, { boardId }, () => {
        handlersRef.current.onResync();
      });
    }

    const onCreated = (payload: TaskCreatedPayload): void => {
      if (payload.boardId === boardId) handlersRef.current.onTaskCreated(payload);
    };
    const onUpdated = (payload: TaskUpdatedPayload): void => {
      if (payload.boardId === boardId) handlersRef.current.onTaskUpdated(payload);
    };
    const onMoved = (payload: TaskMovedPayload): void => {
      if (payload.boardId === boardId) handlersRef.current.onTaskMoved(payload);
    };
    const onDeleted = (payload: TaskDeletedPayload): void => {
      if (payload.boardId === boardId) handlersRef.current.onTaskDeleted(payload);
    };
    const onColumn = (payload: ColumnChangedPayload): void => {
      if (payload.boardId === boardId) handlersRef.current.onColumnChanged(payload);
    };
    const onComment = (payload: CommentAddedPayload): void => {
      if (payload.boardId === boardId) handlersRef.current.onCommentAdded(payload);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect', onReconnect);
    socket.on(SocketEvents.TASK_CREATED, onCreated);
    socket.on(SocketEvents.TASK_UPDATED, onUpdated);
    socket.on(SocketEvents.TASK_MOVED, onMoved);
    socket.on(SocketEvents.TASK_DELETED, onDeleted);
    socket.on(SocketEvents.COLUMN_CHANGED, onColumn);
    socket.on(SocketEvents.COMMENT_ADDED, onComment);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.emit(SocketClientEvents.BOARD_LEAVE, { boardId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect', onReconnect);
      socket.off(SocketEvents.TASK_CREATED, onCreated);
      socket.off(SocketEvents.TASK_UPDATED, onUpdated);
      socket.off(SocketEvents.TASK_MOVED, onMoved);
      socket.off(SocketEvents.TASK_DELETED, onDeleted);
      socket.off(SocketEvents.COLUMN_CHANGED, onColumn);
      socket.off(SocketEvents.COMMENT_ADDED, onComment);
      setConnected(false);
    };
  }, [boardId, enabled]);

  return { connected };
}
