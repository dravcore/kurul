import { Injectable, Logger } from '@nestjs/common';
import type {
  BoardSocketEventName,
  SocketEventPayloadMap,
  UserSocketEventName,
} from '@kurultay/shared-types';
import type { Server } from 'socket.io';

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

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called once from the gateway after Socket.io is ready. */
  attachServer(server: Server): void {
    this.server = server;
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
