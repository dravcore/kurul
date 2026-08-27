import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SocketClientEvents, SOCKET_UNAUTHORIZED } from '@kurul/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';
import { initSentry, resetSentryForTesting } from '../common/observability/sentry';
import { RealtimeGateway } from './realtime.gateway';
import { boardRoom, RealtimeService, userRoom } from './realtime.service';

jest.mock('../auth/auth', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const getSession = auth.api.getSession as unknown as jest.Mock;

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const OTHER_USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';

async function buildGateway(
  board: { id: string; workspaceId: string } | null,
  membership: { id: string } | null = { id: 'member-1' },
) {
  const prisma = {
    board: {
      findFirst: jest.fn().mockResolvedValue(board),
    },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(membership),
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      RealtimeGateway,
      { provide: PrismaService, useValue: prisma },
      { provide: RealtimeService, useValue: { attachServer: jest.fn() } },
    ],
  }).compile();

  return { gateway: moduleRef.get(RealtimeGateway), prisma };
}

function client() {
  return {
    data: { userId: USER_ID } as {
      userId?: string;
      boardWorkspaces?: Record<string, string>;
      notificationWorkspaces?: string[];
    },
    join: jest.fn(),
    leave: jest.fn(),
  };
}

/** A socket whose handshake never resolved to a session. */
function anonymousClient() {
  return {
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
  };
}

/**
 * The handshake is authenticated in Socket.io middleware, and these tests are about *when*
 * rather than whether.
 *
 * The gateway used to resolve the session in `handleConnection`. Socket.io acks the CONNECT
 * packet before it emits `connection` and queues nothing behind an async listener, so the
 * client's `board:join` — sent one round trip later, from its own `connect` event — could be
 * handled while `socket.data.userId` was still unwritten. The handler answered
 * `unauthenticated`, the client never retried the join, and the board showed "Reconnecting…"
 * for the life of the tab. Middleware closes that window: it runs before the ack, so the id is
 * on `socket.data` before any handler can be reached, or the connection is refused.
 */
describe('RealtimeGateway handshake', () => {
  function registerMiddleware(gateway: RealtimeGateway) {
    const use = jest.fn();
    gateway.afterInit({ use } as never);
    const middleware = use.mock.calls[0]?.[0] as (
      socket: unknown,
      next: (error?: Error) => void,
    ) => void;
    expect(middleware).toBeDefined();
    return middleware;
  }

  it('writes the session id onto the socket before the connection is allowed through', async () => {
    const { gateway } = await buildGateway(null);
    const middleware = registerMiddleware(gateway);
    getSession.mockResolvedValue({ user: { id: USER_ID } });

    const socket = { data: {} as { userId?: string }, handshake: { headers: {} } };
    const next = jest.fn();

    middleware(socket, next);
    await new Promise(process.nextTick);

    expect(next).toHaveBeenCalledWith();
    // The ordering the whole fix rests on: by the time `next()` lets the connection through,
    // the id is already there, so no handler can observe the socket without it.
    expect(socket.data.userId).toBe(USER_ID);
    expect(next.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it('refuses a handshake with no session instead of connecting it', async () => {
    const { gateway } = await buildGateway(null);
    const middleware = registerMiddleware(gateway);
    getSession.mockResolvedValue(null);

    const socket = { data: {} as { userId?: string }, handshake: { headers: {} } };
    const next = jest.fn();

    middleware(socket, next);
    await new Promise(process.nextTick);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0]?.[0] as Error).message).toBe(SOCKET_UNAUTHORIZED);
    expect(socket.data.userId).toBeUndefined();
  });

  it('refuses a handshake whose session read threw, rather than letting it through', async () => {
    const { gateway } = await buildGateway(null);
    const middleware = registerMiddleware(gateway);
    getSession.mockRejectedValue(new Error('database is on fire'));

    const socket = { data: {} as { userId?: string }, handshake: { headers: {} } };
    const next = jest.fn();

    middleware(socket, next);
    await new Promise(process.nextTick);

    expect((next.mock.calls[0]?.[0] as Error).message).toBe(SOCKET_UNAUTHORIZED);
    expect(socket.data.userId).toBeUndefined();
  });

  it('has no connection hook that could authenticate after the fact', async () => {
    const { gateway } = await buildGateway(null);

    // `handleConnection` is the hook that made the race possible. Its absence is the
    // regression guard: reintroducing it would reopen the window middleware closed.
    expect((gateway as unknown as { handleConnection?: unknown }).handleConnection).toBeUndefined();
  });
});

describe('RealtimeGateway board rooms', () => {
  it('uses the room name the emitter publishes to', () => {
    expect(SocketClientEvents.BOARD_JOIN).toBe('board:join');
    expect(SocketClientEvents.BOARD_LEAVE).toBe('board:leave');
  });

  it('joins a member to the board room', async () => {
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID, workspaceId: WORKSPACE_ID });
    const socket = client();

    await expect(gateway.onBoardJoin(socket as never, { boardId: BOARD_ID })).resolves.toEqual({
      ok: true,
    });

    // Membership is the gate, and it is checked in the same query as the board lookup.
    expect(prisma.board.findFirst).toHaveBeenCalledWith({
      where: {
        id: BOARD_ID,
        workspace: { members: { some: { userId: USER_ID } } },
      },
      select: { id: true, workspaceId: true },
    });
    expect(socket.join).toHaveBeenCalledWith(boardRoom(BOARD_ID));
    expect(socket.data.boardWorkspaces).toEqual({ [BOARD_ID]: WORKSPACE_ID });
  });

  it('rejects join with an opaque error when the user is not a workspace member', async () => {
    const { gateway, prisma } = await buildGateway(null);
    const socket = client();

    // Missing and cross-tenant must be indistinguishable to the client.
    await expect(gateway.onBoardJoin(socket as never, { boardId: BOARD_ID })).resolves.toEqual({
      ok: false,
      error: 'board not found',
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(prisma.board.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects join on an unauthenticated socket without querying', async () => {
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID, workspaceId: WORKSPACE_ID });
    const socket = anonymousClient();

    await expect(gateway.onBoardJoin(socket as never, { boardId: BOARD_ID })).resolves.toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects join when boardId is missing or not a string', async () => {
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID, workspaceId: WORKSPACE_ID });
    const socket = client();

    await expect(gateway.onBoardJoin(socket as never, { boardId: '' })).resolves.toEqual({
      ok: false,
      error: 'boardId required',
    });
    await expect(gateway.onBoardJoin(socket as never, { boardId: 42 } as never)).resolves.toEqual({
      ok: false,
      error: 'boardId required',
    });
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('leaves the board room without re-checking membership', async () => {
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID, workspaceId: WORKSPACE_ID });
    const socket = client();

    await expect(gateway.onBoardLeave(socket as never, { boardId: BOARD_ID })).resolves.toEqual({
      ok: true,
    });
    expect(socket.leave).toHaveBeenCalledWith(boardRoom(BOARD_ID));
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
  });

  it('acks a leave with no boardId instead of leaving an unnamed room', async () => {
    const { gateway } = await buildGateway({ id: BOARD_ID, workspaceId: WORKSPACE_ID });
    const socket = client();

    await expect(gateway.onBoardLeave(socket as never, { boardId: '' })).resolves.toEqual({
      ok: true,
    });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway notification rooms', () => {
  it('uses the room-control names the client emits', () => {
    expect(SocketClientEvents.NOTIFICATIONS_JOIN).toBe('notifications:join');
    expect(SocketClientEvents.NOTIFICATIONS_LEAVE).toBe('notifications:leave');
  });

  it('joins the session user to their own room', async () => {
    const { gateway, prisma } = await buildGateway(null);
    const socket = client();

    await expect(
      gateway.onNotificationsJoin(socket as never, { workspaceId: WORKSPACE_ID }),
    ).resolves.toEqual({ ok: true });

    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, userId: USER_ID },
      select: { id: true },
    });
    expect(socket.join).toHaveBeenCalledWith(userRoom(WORKSPACE_ID, USER_ID));
  });

  it('ignores a user id in the body — the room is built from the session', async () => {
    const { gateway, prisma } = await buildGateway(null);
    const socket = client();

    // The whole attack: name someone else and listen in on their notifications.
    await expect(
      gateway.onNotificationsJoin(
        socket as never,
        {
          workspaceId: WORKSPACE_ID,
          userId: OTHER_USER_ID,
        } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith(userRoom(WORKSPACE_ID, USER_ID));
    expect(socket.join).not.toHaveBeenCalledWith(userRoom(WORKSPACE_ID, OTHER_USER_ID));
    // Membership is checked for the session user, never for the id that came off the wire.
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, userId: USER_ID },
      select: { id: true },
    });
  });

  it('rejects a join for a workspace the user is not a member of', async () => {
    const { gateway } = await buildGateway(null, null);
    const socket = client();

    // Opaque, like the board join: missing and not-a-member read the same.
    await expect(
      gateway.onNotificationsJoin(socket as never, { workspaceId: WORKSPACE_ID }),
    ).resolves.toEqual({ ok: false, error: 'workspace not found' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects a join on an unauthenticated socket without querying', async () => {
    const { gateway, prisma } = await buildGateway(null);
    const socket = anonymousClient();

    await expect(
      gateway.onNotificationsJoin(socket as never, { workspaceId: WORKSPACE_ID }),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' });
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects a join when workspaceId is missing or not a string', async () => {
    const { gateway, prisma } = await buildGateway(null);
    const socket = client();

    await expect(
      gateway.onNotificationsJoin(socket as never, { workspaceId: '' }),
    ).resolves.toEqual({ ok: false, error: 'workspaceId required' });
    await expect(
      gateway.onNotificationsJoin(socket as never, { workspaceId: 42 } as never),
    ).resolves.toEqual({ ok: false, error: 'workspaceId required' });
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('leaves only the session user room, without re-checking membership', async () => {
    const { gateway, prisma } = await buildGateway(null);
    const socket = client();

    await expect(
      gateway.onNotificationsLeave(
        socket as never,
        {
          workspaceId: WORKSPACE_ID,
          userId: OTHER_USER_ID,
        } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(socket.leave).toHaveBeenCalledWith(userRoom(WORKSPACE_ID, USER_ID));
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
  });

  it('acks a leave with no workspaceId instead of leaving an unnamed room', async () => {
    const { gateway } = await buildGateway(null);
    const socket = client();

    await expect(
      gateway.onNotificationsLeave(socket as never, { workspaceId: '' }),
    ).resolves.toEqual({ ok: true });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});

/**
 * BE-11: `attachRedisAdapter` itself never runs under Jest (`isTestEnv()` refuses to open a
 * real Redis socket a unit test would never close), so the error-reporting logic it wires up
 * is exercised directly through `attachRedisErrorListener`, exactly the way the mocked
 * `Queue`/`Worker` tests exercise `due-soon.worker.ts` and `cleanup.worker.ts`'s own `'error'`
 * handlers. Before this fix neither `pubClient` nor `subClient` had a listener at all, so a
 * connection fault fell through to ioredis's own `console.error` fallback: invisible to the
 * JSON log format and to Sentry.
 */
describe('RealtimeGateway Redis adapter error handling', () => {
  function fakeRedisClient(): EventEmitter {
    return new EventEmitter();
  }

  function errorListener(
    gateway: RealtimeGateway,
  ): (client: EventEmitter, label: 'pubClient' | 'subClient') => void {
    return (
      gateway as unknown as {
        attachRedisErrorListener: (client: EventEmitter, label: 'pubClient' | 'subClient') => void;
      }
    ).attachRedisErrorListener.bind(gateway);
  }

  beforeEach(() => {
    resetSentryForTesting();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetSentryForTesting();
  });

  /** Installs a fake Sentry SDK through the loader seam, same pattern as the worker specs. */
  async function enableFakeSentry(): Promise<{ captureException: jest.Mock }> {
    const captureException = jest.fn();
    const api = {
      init: jest.fn(),
      captureException,
      close: jest.fn(() => Promise.resolve(true)),
      withScope: (callback: (scope: { setTag: jest.Mock; setContext: jest.Mock }) => void) => {
        callback({ setTag: jest.fn(), setContext: jest.fn() });
      },
    } as unknown as typeof import('@sentry/node');

    process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
    try {
      await initSentry(() => Promise.resolve(api));
    } finally {
      delete process.env.SENTRY_DSN;
    }

    return { captureException };
  }

  it('logs at warn, naming pubClient or subClient, and reports to Sentry', async () => {
    const { captureException } = await enableFakeSentry();
    const logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { gateway } = await buildGateway(null);
    const attach = errorListener(gateway);
    const sub = fakeRedisClient();
    attach(sub, 'subClient');

    const error = new Error('ECONNREFUSED');
    sub.emit('error', error);

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('subClient'));
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it('reports the first error immediately, then throttles further reports for a minute', async () => {
    const { captureException } = await enableFakeSentry();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { gateway } = await buildGateway(null);
    const attach = errorListener(gateway);
    const pub = fakeRedisClient();
    attach(pub, 'pubClient');

    pub.emit('error', new Error('ECONNRESET'));
    pub.emit('error', new Error('ECONNRESET'));
    pub.emit('error', new Error('ECONNRESET'));
    expect(captureException).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    pub.emit('error', new Error('ECONNRESET'));
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('shares the report throttle across pubClient and subClient, one outage, one report', async () => {
    const { captureException } = await enableFakeSentry();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { gateway } = await buildGateway(null);
    const attach = errorListener(gateway);
    const pub = fakeRedisClient();
    const sub = fakeRedisClient();
    attach(pub, 'pubClient');
    attach(sub, 'subClient');

    pub.emit('error', new Error('ECONNRESET'));
    sub.emit('error', new Error('ECONNRESET'));

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does not throw when Sentry is off (no SENTRY_DSN)', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { gateway } = await buildGateway(null);
    const attach = errorListener(gateway);
    const pub = fakeRedisClient();
    attach(pub, 'pubClient');

    expect(() => pub.emit('error', new Error('boom'))).not.toThrow();
  });
});
