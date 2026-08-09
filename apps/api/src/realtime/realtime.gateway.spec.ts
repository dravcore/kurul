import { Test } from '@nestjs/testing';
import { SocketClientEvents } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

describe('RealtimeGateway board join', () => {
  it('rejects join when the user is not a workspace member', async () => {
    const prisma = {
      board: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // membership-scoped lookup
          .mockResolvedValueOnce({ id: 'board-1' }), // exists check
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeService, useValue: { attachServer: jest.fn() } },
      ],
    }).compile();

    const gateway = moduleRef.get(RealtimeGateway);
    const client = {
      data: { userId: 'user-1' },
      join: jest.fn(),
    };

    const result = await gateway.onBoardJoin(client as never, { boardId: 'board-1' });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(client.join).not.toHaveBeenCalled();
    expect(SocketClientEvents.BOARD_JOIN).toBe('board:join');
  });
});
