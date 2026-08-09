import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from './board.service';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';

describe('BoardService', () => {
  function buildService() {
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    return { service: new BoardService(prisma as unknown as PrismaService), prisma };
  }

  it('creates a board and its default columns in one transaction', async () => {
    const { service, prisma } = buildService();
    const created = {
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      description: null,
      createdAt: new Date('2026-01-01'),
    };
    const create = jest.fn().mockResolvedValue(created);
    prisma.$transaction.mockImplementation((callback) => callback({ board: { create } }));

    await expect(service.create(WORKSPACE_ID, { name: 'Roadmap' })).resolves.toMatchObject({
      id: BOARD_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          columns: {
            create: [
              { name: 'To Do', position: 1000 },
              { name: 'In Progress', position: 2000 },
              { name: 'Done', position: 3000 },
            ],
          },
        }),
      }),
    );
  });

  it('returns 404 when a board is outside the workspace', async () => {
    const { service } = buildService();
    await expect(service.get(WORKSPACE_ID, BOARD_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
