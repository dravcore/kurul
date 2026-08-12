import { NotFoundException } from '@nestjs/common';
import { ColumnCategory } from '@kurultay/shared-types';
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
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    // The default transaction hands the same mock back as `tx`, so assertions on
    // `prisma.board.*` also cover the calls the service makes inside the transaction.
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    return { service: new BoardService(prisma as unknown as PrismaService), prisma };
  }

  function boardRow() {
    return {
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      description: null,
      createdAt: new Date('2026-01-01'),
    };
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
          // Each seed column carries its category explicitly. Spelled out rather than
          // asserted against DEFAULT_COLUMNS: a test that reuses the constant it is checking
          // would pass just as happily if the Done column stopped being COMPLETED.
          columns: {
            create: [
              { name: 'To Do', position: 1000, category: ColumnCategory.UNSTARTED },
              { name: 'In Progress', position: 2000, category: ColumnCategory.STARTED },
              { name: 'Done', position: 3000, category: ColumnCategory.COMPLETED },
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

  describe('update', () => {
    it('carries the tenant scope on the write predicate, not just the check', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue({ id: BOARD_ID });
      prisma.board.update.mockResolvedValue(boardRow());

      await service.update(WORKSPACE_ID, BOARD_ID, { name: 'Renamed' });

      expect(prisma.board.update).toHaveBeenCalledWith({
        where: { id: BOARD_ID, workspaceId: WORKSPACE_ID },
        data: { name: 'Renamed' },
      });
    });

    it('returns 404 and writes nothing for a board in another workspace', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WORKSPACE_ID, BOARD_ID, { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.board.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes with the tenant predicate rather than the bare id', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue({ id: BOARD_ID });

      await expect(service.remove(WORKSPACE_ID, BOARD_ID)).resolves.toBeUndefined();
      expect(prisma.board.deleteMany).toHaveBeenCalledWith({
        where: { id: BOARD_ID, workspaceId: WORKSPACE_ID },
      });
      expect(prisma.board.delete).not.toHaveBeenCalled();
    });

    it('returns 404 and writes nothing for a board in another workspace', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue(null);

      await expect(service.remove(WORKSPACE_ID, BOARD_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.board.deleteMany).not.toHaveBeenCalled();
    });

    it('returns 404 when the scoped delete matches no row', async () => {
      const { service, prisma } = buildService();
      // The row passed the in-transaction check but left the workspace before the write —
      // the scoped predicate is what catches it, and 404 is the cross-tenant answer.
      prisma.board.findFirst.mockResolvedValue({ id: BOARD_ID });
      prisma.board.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(WORKSPACE_ID, BOARD_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
