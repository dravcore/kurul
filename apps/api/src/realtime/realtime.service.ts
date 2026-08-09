import { Injectable, Logger } from '@nestjs/common';
import type { SocketEventName, SocketEventPayloadMap } from '@kurultay/shared-types';
import type { Server } from 'socket.io';

export function boardRoom(boardId: string): string {
  return `board:${boardId}`;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called once from the gateway after Socket.io is ready. */
  attachServer(server: Server): void {
    this.server = server;
  }

  emitToBoard<E extends SocketEventName>(
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
}
