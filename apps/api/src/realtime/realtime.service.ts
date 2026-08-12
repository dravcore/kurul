import { Injectable, Logger } from '@nestjs/common';
import type {
  BoardSocketEventName,
  SocketEventPayloadMap,
  UserSocketEventName,
} from '@kurultay/shared-types';
import type { Server } from 'socket.io';
import { registerWorkspaceSocketEviction } from './workspace-socket-eviction';

export function boardRoom(boardId: string): string {
  return `board:${boardId}`;
}

/**
 * A single recipient's room inside one tenant.
 *
 * Both ids are in the key on purpose. The user id is the privacy boundary — a notification
 * belongs to its recipient, nobody else — and the workspace id is the tenant boundary, which
 * keeps a signal about workspace A from reaching a tab that is looking at workspace B. It
 * mirrors the `{ workspaceId, userId }` pair every notification read and write is scoped by
 * (see `NotificationService.markRead`).
 */
export function userRoom(workspaceId: string, userId: string): string {
  return `user:${workspaceId}:${userId}`;
}

/** Socket.data shape written by the gateway when a room is joined. */
export type SocketRoomState = {
  userId?: string;
  /** boardId → workspaceId for every board room this socket currently holds. */
  boardWorkspaces?: Record<string, string>;
  /** Notification rooms joined for these workspace ids. */
  notificationWorkspaces?: string[];
};

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called once from the gateway after Socket.io is ready. */
  attachServer(server: Server): void {
    this.server = server;
    registerWorkspaceSocketEviction((workspaceId, userId) =>
      this.evictUserFromWorkspace(workspaceId, userId),
    );
  }

  /**
   * Drop a user from every room that belongs to one workspace.
   *
   * HTTP membership revocation is immediate (`WorkspaceGuard`); Socket.io rooms are not —
   * join is checked once, leave is client-driven. Without this, a removed member keeps
   * receiving board/notification events until disconnect. Wired from Better Auth
   * `afterRemoveMember` (and Nest callers that remove membership).
   */
  async evictUserFromWorkspace(workspaceId: string, userId: string): Promise<void> {
    if (!this.server) {
      this.logger.debug(`Skip eviction — socket server not attached`);
      return;
    }

    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      const data = socket.data as SocketRoomState;
      if (data.userId !== userId) continue;

      void socket.leave(userRoom(workspaceId, userId));
      if (data.notificationWorkspaces) {
        data.notificationWorkspaces = data.notificationWorkspaces.filter(
          (id: string) => id !== workspaceId,
        );
      }

      const boardWorkspaces = data.boardWorkspaces ?? {};
      for (const [boardId, boardWorkspaceId] of Object.entries(boardWorkspaces)) {
        if (boardWorkspaceId !== workspaceId) continue;
        void socket.leave(boardRoom(boardId));
        delete boardWorkspaces[boardId];
      }
    }
  }

  emitToBoard<E extends BoardSocketEventName>(
    boardId: string,
    event: E,
    payload: SocketEventPayloadMap[E],
  ): void {
    if (!this.server) {
      this.logger.debug(`Skip emit ${event} — socket server not attached`);
      return;
    }
    this.server.to(boardRoom(boardId)).emit(event, payload);
  }

  /**
   * Publish to one recipient inside one workspace. Only `UserSocketEventName` is accepted, so
   * a user-scoped event cannot be handed to `emitToBoard` by mistake.
   */
  emitToUser<E extends UserSocketEventName>(
    workspaceId: string,
    userId: string,
    event: E,
    payload: SocketEventPayloadMap[E],
  ): void {
    if (!this.server) {
      this.logger.debug(`Skip emit ${event} — socket server not attached`);
      return;
    }
    this.server.to(userRoom(workspaceId, userId)).emit(event, payload);
  }
}
