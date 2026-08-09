import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { fromNodeHeaders } from 'better-auth/node';
import { Redis } from 'ioredis';
import {
  SocketClientEvents,
  type BoardJoinPayload,
  type BoardLeavePayload,
} from '@kurultay/shared-types';
import type { Server, Socket } from 'socket.io';
import { auth } from '../auth/auth';
import { envString, isTestEnv } from '../common/env';
import { parseRedisUrl } from '../common/redis-url';
import { PrismaService } from '../prisma/prisma.service';
import { boardRoom, RealtimeService } from './realtime.service';

type AuthedSocket = Socket & {
  data: {
    userId?: string;
  };
};

@WebSocketGateway({
  cors: {
    origin: envString('WEB_URL', 'http://localhost:3000'),
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private redisClients: Redis[] = [];

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attachServer(server);
    void this.attachRedisAdapter(server);
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(client.handshake.headers),
      });
      if (!session?.user?.id) {
        client.disconnect(true);
        return;
      }
      client.data.userId = session.user.id;
    } catch (error) {
      this.logger.warn(
        `Socket auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: AuthedSocket): void {
    // Rooms are cleaned up by Socket.io.
  }

  @SubscribeMessage(SocketClientEvents.BOARD_JOIN)
  async onBoardJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: BoardJoinPayload,
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = client.data.userId;
    if (!userId) {
      return { ok: false, error: 'unauthenticated' };
    }
    const boardId = typeof body?.boardId === 'string' ? body.boardId : '';
    if (!boardId) {
      return { ok: false, error: 'boardId required' };
    }

    const board = await this.prisma.board.findFirst({
      where: {
        id: boardId,
        workspace: { members: { some: { userId } } },
      },
      select: { id: true },
    });
    if (!board) {
      // Opaque deny — do not distinguish missing vs cross-tenant board.
      return { ok: false, error: 'board not found' };
    }

    await client.join(boardRoom(boardId));
    return { ok: true };
  }

  @SubscribeMessage(SocketClientEvents.BOARD_LEAVE)
  async onBoardLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: BoardLeavePayload,
  ): Promise<{ ok: boolean }> {
    const boardId = typeof body?.boardId === 'string' ? body.boardId : '';
    if (boardId) {
      await client.leave(boardRoom(boardId));
    }
    return { ok: true };
  }

  private async attachRedisAdapter(server: Server): Promise<void> {
    if (isTestEnv()) {
      // A unit test that instantiates the gateway must not open a Redis connection it
      // will never close — the suite would hang on an open handle.
      this.logger.debug('Skipping Socket.io Redis adapter in test environment');
      return;
    }

    const redisUrl = envString('REDIS_URL', '');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL unset — Socket.io Redis adapter not attached');
      return;
    }

    try {
      const connection = parseRedisUrl(redisUrl);
      const pubClient = new Redis(connection);
      const subClient = pubClient.duplicate();
      this.redisClients = [pubClient, subClient];
      server.adapter(createAdapter(pubClient, subClient));
      this.logger.log('Socket.io Redis adapter attached');
    } catch (error) {
      this.logger.error(
        `Failed to attach Socket.io Redis adapter: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.redisClients.map((client) => client.quit().catch(() => undefined)));
    this.redisClients = [];
  }
}
