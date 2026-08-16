'use client';

import { useEffect, useRef, useState } from 'react';
import {
  SocketClientEvents,
  SocketEvents,
  type NotificationUnreadChangedPayload,
} from '@kurul/shared-types';
import { connectSocket, getSocket } from '@/lib/socket';

export type NotificationSocketHandlers = {
  /** The recipient's unread count changed — a notification arrived, or one was read. */
  onUnreadChanged: (payload: NotificationUnreadChangedPayload) => void;
  /**
   * The room was (re)joined. Anything that happened while the socket was down was never
   * delivered, so the caller reloads from the API instead of trusting its local state.
   */
  onResync: () => void;
};

/**
 * How many mounted hooks hold each workspace's notification room.
 *
 * The bell lives in the app shell and the notifications page mounts inside it, so both
 * subscribe to the same room. Without a count, navigating away from the page would emit a
 * leave that also unsubscribes the bell — which would then sit there, silent, looking correct.
 * Module scope is the right scope: `lib/socket.ts` hands out one socket per tab, and rooms are
 * a property of that socket, not of a component.
 */
const roomHolders = new Map<string, number>();

function retainRoom(workspaceId: string): void {
  roomHolders.set(workspaceId, (roomHolders.get(workspaceId) ?? 0) + 1);
}

/** Returns true when the last holder let go and the room should actually be left. */
function releaseRoom(workspaceId: string): boolean {
  const next = (roomHolders.get(workspaceId) ?? 1) - 1;
  if (next <= 0) {
    roomHolders.delete(workspaceId);
    return true;
  }
  roomHolders.set(workspaceId, next);
  return false;
}

/**
 * Subscribe to the current user's notification signals for one workspace.
 *
 * The join carries the workspace only — the server names the room after the session user, so
 * this hook cannot ask for anyone else's feed. Handlers are read from a ref, so callers may
 * pass unstable callbacks without re-subscribing (same contract as `useBoardSocket`).
 */
export function useNotificationSocket(
  workspaceId: string | null,
  enabled: boolean,
  handlers: NotificationSocketHandlers,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled || !workspaceId) {
      return;
    }

    // Listeners go on before the connection is opened, so a handshake that resolves between
    // the two cannot slip past `onConnect`.
    const socket = getSocket();
    retainRoom(workspaceId);

    function onConnect(): void {
      socket.emit(
        SocketClientEvents.NOTIFICATIONS_JOIN,
        { workspaceId },
        (ack: { ok?: boolean } | undefined) => {
          // `connected` flips only once the room is actually joined: a socket that connected
          // but was denied the room delivers nothing, and the caller has to keep its fallback
          // refresh running rather than trust a live-looking flag.
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

    const onUnreadChanged = (payload: NotificationUnreadChangedPayload): void => {
      // The room is already scoped to this workspace and this user; the guard covers the
      // window after a workspace switch, when the old room's last event can still land.
      if (payload.workspaceId === workspaceId) {
        handlersRef.current.onUnreadChanged(payload);
      }
    };

    // `connect` also fires on every reconnection, so a manager-level `reconnect` listener
    // would only double the room join and the resync it acks with.
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(SocketEvents.NOTIFICATION_UNREAD_CHANGED, onUnreadChanged);

    if (socket.connected) {
      onConnect();
    } else {
      connectSocket();
    }

    return () => {
      if (releaseRoom(workspaceId)) {
        socket.emit(SocketClientEvents.NOTIFICATIONS_LEAVE, { workspaceId });
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(SocketEvents.NOTIFICATION_UNREAD_CHANGED, onUnreadChanged);
      setConnected(false);
    };
  }, [workspaceId, enabled]);

  // Derived rather than reset from the effect: with no room to hold, "connected" is not a
  // fact that has to be written down and then unwritten — it is false by construction, and
  // deriving it removes the render that a disabling `setConnected(false)` used to cost. The
  // teardown below still clears the flag so a *re-enabled* hook starts from disconnected.
  return { connected: enabled && workspaceId !== null && connected };
}
