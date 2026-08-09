import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ColumnService } from './column.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

describe('ColumnService', () => {
  function buildService() {
    const prisma = {
      board: { findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID }) },
      column: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    return { service: new ColumnService(prisma as unknown as PrismaService), prisma };
  }

  it('appends a created column after the final existing position', async () => {
    const { service, prisma } = buildService();
    prisma.column.findMany.mockResolvedValue([{ id: 'last', position: 3000 }]);
    prisma.column.create.mockResolvedValue({
      id: 'new',
      boardId: BOARD_ID,
      name: 'Review',
      position: 4000,
      color: null,
      _count: { tasks: 0 },
    });

    await expect(service.create(WORKSPACE_ID, BOARD_ID, { name: 'Review' })).resolves.toMatchObject({
      position: 4000,
      taskCount: 0,
    });
    expect(prisma.column.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 4000 }) }),
    );
  });

  it('returns 404 when the requested column is outside the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.column.findFirst.mockResolvedValue(null);
    await expect(service.remove(WORKSPACE_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
