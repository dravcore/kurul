import { Test } from '@nestjs/testing';
import { SocketClientEvents } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { boardRoom, RealtimeService, userRoom } from './realtime.service';

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
