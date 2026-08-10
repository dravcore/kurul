import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      task: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    // The default transaction hands the same mock back as `tx`, so assertions on
    // `prisma.column.*` also cover the calls the service makes inside the transaction.
    // The move tests override it with their own `tx`.
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
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

    const rejected = service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID);
    await expect(rejected).rejects.toBeInstanceOf(ConflictException);
    await expect(rejected).rejects.toThrow('Column has tasks; move or delete them first');
    expect(prisma.column.deleteMany).not.toHaveBeenCalled();
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

    // The delete predicate carries the tenant scope, not just the id.
    expect(prisma.column.deleteMany).toHaveBeenCalledWith({
      where: { id: COLUMN_ID, board: { workspaceId: WORKSPACE_ID } },
    });
    expect(prisma.column.delete).not.toHaveBeenCalled();
    expect(realtime.emitToBoard).toHaveBeenCalled();
  });

  it('returns 404 when the scoped column delete matches no row', async () => {
    const { service, prisma, realtime } = buildService();
    // The column passed the in-transaction check but left the workspace before the write —
    // the scoped predicate is what catches it, and 404 is the cross-tenant answer.
    prisma.column.findFirst.mockResolvedValue({
      id: COLUMN_ID,
      boardId: BOARD_ID,
      name: 'Todo',
      position: 1000,
      color: null,
    });
    prisma.column.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(realtime.emitToBoard).not.toHaveBeenCalled();
  });

  it('counts tasks inside the delete transaction, not before it', async () => {
    const { service, prisma } = buildService();
    const tx = {
      column: {
        findFirst: jest.fn().mockResolvedValue({
          id: COLUMN_ID,
          boardId: BOARD_ID,
          name: 'Todo',
          position: 1000,
          color: null,
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      task: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );

    await service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID);

    // Reading outside the transaction reopens the window between check and delete.
    expect(prisma.column.findFirst).not.toHaveBeenCalled();
    expect(prisma.task.count).not.toHaveBeenCalled();
    expect(tx.column.findFirst).toHaveBeenCalledWith({
      where: { id: COLUMN_ID, board: { workspaceId: WORKSPACE_ID } },
    });
    expect(tx.task.count).toHaveBeenCalledWith({ where: { columnId: COLUMN_ID } });
  });

  describe('update', () => {
    it('carries the tenant scope on the write predicate, not just the check', async () => {
      const { service, prisma } = buildService();
      prisma.column.findFirst.mockResolvedValue({ id: COLUMN_ID });
      prisma.column.update.mockResolvedValue({
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Renamed',
        position: 1000,
        color: null,
        _count: { tasks: 0 },
      });

      await service.update(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, { name: 'Renamed' });

      expect(prisma.column.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: COLUMN_ID, board: { workspaceId: WORKSPACE_ID } },
          data: { name: 'Renamed' },
        }),
      );
    });

    it('returns 404 and writes nothing for a column in another workspace', async () => {
      const { service, prisma, realtime } = buildService();
      prisma.column.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.column.update).not.toHaveBeenCalled();
      expect(realtime.emitToBoard).not.toHaveBeenCalled();
    });
  });

  // The service owns this check — resolveMoveNeighbors never sees the case, because the
  // moved column is filtered out of `remaining` before the helper is called.
  it('rejects a column as its own neighbor', async () => {
    const { service, prisma } = buildService();
    const column = { id: COLUMN_ID, boardId: BOARD_ID, name: 'Todo', position: 1000, color: null };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        column: {
          findFirst: jest.fn().mockResolvedValue(column),
          findMany: jest.fn().mockResolvedValue([column]),
          update: jest.fn(),
        },
      }),
    );

    const rejected = service.move(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, { afterColumnId: COLUMN_ID });
    await expect(rejected).rejects.toBeInstanceOf(BadRequestException);
    await expect(rejected).rejects.toThrow('A column cannot be its own neighbor');
  });

  it('preserves taskCount when move rebalances positions', async () => {
    const { service, prisma, realtime } = buildService();
    const column = {
      id: COLUMN_ID,
      boardId: BOARD_ID,
      name: 'Todo',
      position: 3000,
      color: null,
    };
    const beforeNeighbor = {
      id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52',
      boardId: BOARD_ID,
      name: 'Doing',
      position: 1000,
      color: null,
    };
    const afterNeighbor = {
      id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53',
      boardId: BOARD_ID,
      name: 'Done',
      position: 1000 + 1e-9,
      color: null,
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        column: {
          findFirst: jest.fn().mockResolvedValue(column),
          findMany: jest.fn().mockResolvedValue([beforeNeighbor, afterNeighbor, column]),
          update: jest.fn().mockResolvedValue({ ...column, position: 2000 }),
          findFirstOrThrow: jest.fn().mockResolvedValue({
            ...column,
            position: 2000,
            _count: { tasks: 7 },
          }),
        },
        $executeRaw: jest.fn().mockResolvedValue(2),
      }),
    );

    await expect(
      service.move(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, {
        beforeColumnId: beforeNeighbor.id,
        afterColumnId: afterNeighbor.id,
      }),
    ).resolves.toMatchObject({ id: COLUMN_ID, taskCount: 7 });
    expect(realtime.emitToBoard).toHaveBeenCalled();
  });
});
