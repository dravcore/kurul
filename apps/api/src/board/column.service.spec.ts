import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { ColumnService } from './column.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';

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
      task: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    const realtime = { emitToBoard: jest.fn() };
    return {
      service: new ColumnService(
        prisma as unknown as PrismaService,
        realtime as unknown as RealtimeService,
      ),
      prisma,
      realtime,
    };
  }

  it('appends a created column after the final existing position', async () => {
    const { service, prisma, realtime } = buildService();
    prisma.column.findMany.mockResolvedValue([{ id: 'last', position: 3000 }]);
    prisma.column.create.mockResolvedValue({
      id: 'new',
      boardId: BOARD_ID,
      name: 'Review',
      position: 4000,
      color: null,
      _count: { tasks: 0 },
    });

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Review' }),
    ).resolves.toMatchObject({
      position: 4000,
      taskCount: 0,
    });
    expect(prisma.column.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 4000 }) }),
    );
    expect(realtime.emitToBoard).toHaveBeenCalled();
  });

  it('returns 404 when the requested column is outside the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.column.findFirst.mockResolvedValue(null);
    await expect(service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects deleting a column that still has tasks', async () => {
    const { service, prisma, realtime } = buildService();
    prisma.column.findFirst.mockResolvedValue({
      id: COLUMN_ID,
      boardId: BOARD_ID,
      name: 'Todo',
      position: 1000,
      color: null,
    });
    prisma.task.count.mockResolvedValue(2);

    await expect(service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.column.delete).not.toHaveBeenCalled();
    expect(realtime.emitToBoard).not.toHaveBeenCalled();
  });

  it('deletes an empty column', async () => {
    const { service, prisma, realtime } = buildService();
    prisma.column.findFirst.mockResolvedValue({
      id: COLUMN_ID,
      boardId: BOARD_ID,
      name: 'Todo',
      position: 1000,
      color: null,
    });
    prisma.task.count.mockResolvedValue(0);

    await service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID);

    expect(prisma.column.delete).toHaveBeenCalledWith({ where: { id: COLUMN_ID } });
    expect(realtime.emitToBoard).toHaveBeenCalled();
  });
});
