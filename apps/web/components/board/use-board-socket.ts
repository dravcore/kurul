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
import { connectSocket, getSocket } from '@/lib/socket';

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
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled || !boardId) return;

    // Listeners go on before the connection is opened, so a handshake that resolves between
    // the two cannot slip past `onConnect`.
    const socket = getSocket();

    function onConnect(): void {
      socket.emit(
        SocketClientEvents.BOARD_JOIN,
        { boardId },
        (ack: { ok?: boolean } | undefined) => {
          // `connected` flips only once the room is actually joined: a socket that connected
          // but was denied the room delivers nothing, and the caller has to keep showing a
          // reconnecting / offline state rather than trust a live-looking flag.
          if (ack?.ok) {
            setConnected(true);
            handlersRef.current.onResync();
          }
        },
      );
    }

    function onDisconnect(): void {
      setConnected(false);
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

    // `connect` also fires on every reconnection, so a manager-level `reconnect` listener
    // would only double the room join and the resync it acks with.
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(SocketEvents.TASK_CREATED, onCreated);
    socket.on(SocketEvents.TASK_UPDATED, onUpdated);
    socket.on(SocketEvents.TASK_MOVED, onMoved);
    socket.on(SocketEvents.TASK_DELETED, onDeleted);
    socket.on(SocketEvents.COLUMN_CHANGED, onColumn);
    socket.on(SocketEvents.COMMENT_ADDED, onComment);

    if (socket.connected) {
      onConnect();
    } else {
      connectSocket();
    }

    return () => {
      socket.emit(SocketClientEvents.BOARD_LEAVE, { boardId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
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
