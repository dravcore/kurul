import { Test } from '@nestjs/testing';
import { SocketClientEvents } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { boardRoom, RealtimeService } from './realtime.service';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

async function buildGateway(board: { id: string } | null) {
  const prisma = {
    board: {
      findFirst: jest.fn().mockResolvedValue(board),
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
    data: { userId: USER_ID },
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
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID });
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
      select: { id: true },
    });
    expect(socket.join).toHaveBeenCalledWith(boardRoom(BOARD_ID));
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
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID });
    const socket = anonymousClient();

    await expect(gateway.onBoardJoin(socket as never, { boardId: BOARD_ID })).resolves.toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects join when boardId is missing or not a string', async () => {
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID });
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
    const { gateway, prisma } = await buildGateway({ id: BOARD_ID });
    const socket = client();

    await expect(gateway.onBoardLeave(socket as never, { boardId: BOARD_ID })).resolves.toEqual({
      ok: true,
    });
    expect(socket.leave).toHaveBeenCalledWith(boardRoom(BOARD_ID));
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
  });

  it('acks a leave with no boardId instead of leaving an unnamed room', async () => {
    const { gateway } = await buildGateway({ id: BOARD_ID });
    const socket = client();

    await expect(gateway.onBoardLeave(socket as never, { boardId: '' })).resolves.toEqual({
      ok: true,
    });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});
