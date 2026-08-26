import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
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
  SOCKET_UNAUTHORIZED,
  type BoardJoinPayload,
  type BoardLeavePayload,
  type NotificationsJoinPayload,
  type NotificationsLeavePayload,
} from '@kurul/shared-types';
import type { Server, Socket } from 'socket.io';
import { auth } from '../auth/auth';
import { envString, isTestEnv } from '../common/env';
import { parseRedisUrl } from '../common/redis-url';
import { PrismaService } from '../prisma/prisma.service';
import { boardRoom, RealtimeService, userRoom, type SocketRoomState } from './realtime.service';

type AuthedSocket = Socket & {
  data: SocketRoomState;
};

@WebSocketGateway({
  cors: {
    origin: envString('WEB_URL', 'http://localhost:3000'),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private redisClients: Redis[] = [];

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket as AuthedSocket, next);
    });
    this.realtime.attachServer(server);
    void this.attachRedisAdapter(server);
  }

  /**
   * Resolves the handshake's session and stamps it on `socket.data`, as Socket.io
   * *middleware* rather than in an `OnGatewayConnection` hook.
   *
   * That distinction is the whole point, and it is a correctness one, not a style one.
   * Socket.io does not hold a connection's inbound packets while a `connection` listener is
   * running: `Namespace._doConnect` acks the CONNECT packet and *then* emits `connection`, so
   * an `async handleConnection` that awaits a session read hands the client a live socket
   * while `socket.data.userId` is still undefined. The client emits `board:join` on its
   * `connect` event — one round trip — and every room handler below reads `client.data.userId`
   * and answers `unauthenticated` if the read has not landed yet. The board then shows
   * "Reconnecting…" for the life of that socket, because a join is emitted once per connection
   * and a denied one is never retried. It is a pure race: it loses only when the session read
   * is slower than the client's round trip, which is why it never reproduced on a developer's
   * machine and flipped a fixed commit's nightly browser suite green and red for a week.
   *
   * Middleware runs *before* the CONNECT ack, and Socket.io queues nothing behind it, so by
   * the time any handler can be reached the id is either present or the connection was
   * refused. The race cannot be lost because the window no longer exists.
   *
   * A refusal is `next(Error)` rather than `socket.disconnect(true)` for the same reason it is
   * middleware: the client is told *why* before it is dropped, as a `connect_error` it can act
   * on (`apps/web/lib/socket.ts` schedules its own retry, because Socket.io's reconnection
   * gives up on both a server-side disconnect and a handshake error).
   */
  private async authenticate(client: AuthedSocket, next: (error?: Error) => void): Promise<void> {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(client.handshake.headers),
      });
      if (!session?.user?.id) {
        next(new Error(SOCKET_UNAUTHORIZED));
        return;
      }
      client.data.userId = session.user.id;
      next();
    } catch (error) {
      this.logger.warn(
        `Socket auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      next(new Error(SOCKET_UNAUTHORIZED));
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
      select: { id: true, workspaceId: true },
    });
    if (!board) {
      // Opaque deny — do not distinguish missing vs cross-tenant board.
      return { ok: false, error: 'board not found' };
    }

    await client.join(boardRoom(boardId));
    client.data.boardWorkspaces = {
      ...client.data.boardWorkspaces,
      [boardId]: board.workspaceId,
    };
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
      if (client.data.boardWorkspaces) {
        delete client.data.boardWorkspaces[boardId];
      }
    }
    return { ok: true };
  }

  /**
   * Join the caller's own notification room.
   *
   * The room name is built from `client.data.userId` — the id Better Auth resolved from the
   * handshake — and never from the message body, which is why the payload has no user field
   * to trust. A body-supplied recipient would be an eavesdropping primitive: any authenticated
   * socket could name someone else and receive their notification signals.
   *
   * Workspace membership is still checked, exactly as the board join does. The room is already
   * private to one user, so this is not what stops a leak; it stops a socket from holding an
   * open subscription to a tenant the user has been removed from.
   */
  @SubscribeMessage(SocketClientEvents.NOTIFICATIONS_JOIN)
  async onNotificationsJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: NotificationsJoinPayload,
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = client.data.userId;
    if (!userId) {
      return { ok: false, error: 'unauthenticated' };
    }
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if (!workspaceId) {
      return { ok: false, error: 'workspaceId required' };
    }

    const membership = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      select: { id: true },
    });
    if (!membership) {
      // Opaque deny — do not distinguish missing vs not-a-member.
      return { ok: false, error: 'workspace not found' };
    }

    await client.join(userRoom(workspaceId, userId));
    const joined = client.data.notificationWorkspaces ?? [];
    if (!joined.includes(workspaceId)) {
      client.data.notificationWorkspaces = [...joined, workspaceId];
    }
    return { ok: true };
  }

  @SubscribeMessage(SocketClientEvents.NOTIFICATIONS_LEAVE)
  async onNotificationsLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: NotificationsLeavePayload,
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId;
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if (userId && workspaceId) {
      await client.leave(userRoom(workspaceId, userId));
      if (client.data.notificationWorkspaces) {
        client.data.notificationWorkspaces = client.data.notificationWorkspaces.filter(
          (id: string) => id !== workspaceId,
        );
      }
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

  /**
   * Shutdown, not destroy: Nest closes the Socket.io server in the same step that closes the
   * HTTP listener, and that step runs *after* every destroy hook (`main.ts`). Quitting the
   * adapter's Redis pair from a destroy hook would therefore cut the fan-out under sockets
   * that are still connected and still being served.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.redisClients.map((client) => client.quit().catch(() => undefined)));
    this.redisClients = [];
  }
}
