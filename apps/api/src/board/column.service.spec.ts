import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ActivityType, ColumnCategory, SocketEvents, type Locale } from '@kurultay/shared-types';
import type { ActivityService } from '../activity/activity.service';
import type { LocaleService } from '../locale/locale.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { ColumnService } from './column.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';

describe('ColumnService', () => {
  function buildService(locale: Locale = 'en') {
    const prisma = {
      board: { findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID }) },
      column: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      task: { count: jest.fn().mockResolvedValue(0) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(),
    };
    // The default transaction hands the same mock back as `tx`, so assertions on
    // `prisma.column.*` also cover the calls the service makes inside the transaction.
    // The move tests override it with their own `tx`.
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const realtime = { emitToBoard: jest.fn() };
    const localeService = { resolve: jest.fn().mockResolvedValue(locale) };
    const activityService = { record: jest.fn().mockResolvedValue({ id: 'activity' }) };
    return {
      service: new ColumnService(
        prisma as unknown as PrismaService,
        realtime as unknown as RealtimeService,
        localeService as unknown as LocaleService,
        activityService as unknown as ActivityService,
      ),
      prisma,
      realtime,
      localeService,
      activityService,
    };
  }

  /** The rows `createDefaults` re-reads after its bulk insert. */
  function seededRows() {
    return [
      {
        id: 'seed-1',
        boardId: BOARD_ID,
        name: 'To Do',
        position: 1000,
        color: null,
        category: ColumnCategory.UNSTARTED,
        _count: { tasks: 0 },
      },
      {
        id: 'seed-2',
        boardId: BOARD_ID,
        name: 'In Progress',
        position: 2000,
        color: null,
        category: ColumnCategory.STARTED,
        _count: { tasks: 0 },
      },
      {
        id: 'seed-3',
        boardId: BOARD_ID,
        name: 'Done',
        position: 3000,
        color: null,
        category: ColumnCategory.COMPLETED,
        _count: { tasks: 0 },
      },
    ];
  }

  describe('createDefaults', () => {
    it('seeds the whole starting set in one transaction and returns it ordered', async () => {
      const { service, prisma } = buildService();
      prisma.column.findMany.mockResolvedValue(seededRows());

      await expect(service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID)).resolves.toMatchObject(
        [
          { name: 'To Do', position: 1000, category: ColumnCategory.UNSTARTED, taskCount: 0 },
          { name: 'In Progress', position: 2000, category: ColumnCategory.STARTED },
          { name: 'Done', position: 3000, category: ColumnCategory.COMPLETED },
        ],
      );

      // One bulk insert, not one request per column: a partial seed is the failure mode the
      // web's old three-POST loop could leave behind.
      expect(prisma.column.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.column.create).not.toHaveBeenCalled();
    });

    it('writes every seed column with the board id and its category', async () => {
      const { service, prisma } = buildService();
      prisma.column.findMany.mockResolvedValue(seededRows());

      await service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID);

      // Spelled out rather than compared against the catalog: reusing `defaultColumnsFor`
      // here would keep passing if the Done column stopped being COMPLETED.
      expect(prisma.column.createMany).toHaveBeenCalledWith({
        data: [
          { name: 'To Do', position: 1000, category: ColumnCategory.UNSTARTED, boardId: BOARD_ID },
          {
            name: 'In Progress',
            position: 2000,
            category: ColumnCategory.STARTED,
            boardId: BOARD_ID,
          },
          { name: 'Done', position: 3000, category: ColumnCategory.COMPLETED, boardId: BOARD_ID },
        ],
      });
    });

    it('names the columns in the caller’s language', async () => {
      const { service, prisma, localeService } = buildService();
      prisma.column.findMany.mockResolvedValue(seededRows());

      await service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID, 'en-GB');

      expect(localeService.resolve).toHaveBeenCalledWith(ACTOR_ID, 'en-GB');
    });

    it('refuses a board that already has columns instead of appending a second set', async () => {
      const { service, prisma, realtime } = buildService();
      prisma.column.count.mockResolvedValue(3);

      const rejected = service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID);
      await expect(rejected).rejects.toBeInstanceOf(ConflictException);
      await expect(rejected).rejects.toThrow('Board already has columns');
      expect(prisma.column.createMany).not.toHaveBeenCalled();
      expect(realtime.emitToBoard).not.toHaveBeenCalled();
    });

    it('locks the board row before counting, so two callers cannot both seed', async () => {
      const { service, prisma } = buildService();
      prisma.column.findMany.mockResolvedValue(seededRows());

      await service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID);

      // Under READ COMMITTED both callers would otherwise see an empty board and both
      // insert, leaving six columns and two Done columns with nothing to catch it.
      expect(prisma.$executeRaw).toHaveBeenCalled();
      const [fragments] = prisma.$executeRaw.mock.calls[0] as [TemplateStringsArray];
      expect(fragments.join('?')).toContain('FOR UPDATE');
    });

    it('returns 404 for a board outside the workspace, writing nothing', async () => {
      const { service, prisma } = buildService();
      prisma.board.findFirst.mockResolvedValue(null);

      await expect(service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.column.createMany).not.toHaveBeenCalled();
    });

    it('announces every seeded column on the board channel', async () => {
      const { service, prisma, realtime } = buildService();
      prisma.column.findMany.mockResolvedValue(seededRows());

      await service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID);

      // Another viewer sitting on the same empty board has to see the columns appear.
      expect(realtime.emitToBoard).toHaveBeenCalledTimes(3);
    });
  });

  it('appends a created column after the final existing position', async () => {
    const { service, prisma, realtime } = buildService();
    prisma.column.findMany.mockResolvedValue([{ id: 'last', position: 3000 }]);
    prisma.column.create.mockResolvedValue({
      id: 'new',
      boardId: BOARD_ID,
      name: 'Review',
      position: 4000,
      color: null,
      category: ColumnCategory.UNSTARTED,
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
    // The siblings are read for their ordering, so that is all the query may ask for.
    expect(prisma.column.findMany).toHaveBeenCalledWith({
      where: { boardId: BOARD_ID },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });
    expect(realtime.emitToBoard).toHaveBeenCalledWith(
      BOARD_ID,
      SocketEvents.COLUMN_CHANGED,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        boardId: BOARD_ID,
        actorId: ACTOR_ID,
        columnId: expect.any(String),
      }),
    );
  });

  it('locks the board row before reading siblings, so two concurrent creates cannot land on the same position', async () => {
    const { service, prisma } = buildService();
    prisma.column.findMany.mockResolvedValue([{ id: 'last', position: 3000 }]);
    prisma.column.create.mockResolvedValue({
      id: 'new',
      boardId: BOARD_ID,
      name: 'Review',
      position: 4000,
      color: null,
      category: ColumnCategory.UNSTARTED,
      _count: { tasks: 0 },
    });

    await service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Review' });

    // BE-05: `create` used to read siblings and run its single-row insert outside any
    // transaction at all. Matches the lock `createDefaults` already takes on this same board
    // row, and the one the task path takes on the column row.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const [fragments] = prisma.$executeRaw.mock.calls[0] as [TemplateStringsArray];
    expect(fragments.join('?')).toContain('FOR UPDATE');
  });

  it('passes an explicit category straight through on create', async () => {
    const { service, prisma } = buildService();
    prisma.column.findMany.mockResolvedValue([{ id: 'last', position: 3000 }]);
    prisma.column.create.mockResolvedValue({
      id: 'new',
      boardId: BOARD_ID,
      name: 'Shipped',
      position: 4000,
      color: null,
      category: ColumnCategory.COMPLETED,
      _count: { tasks: 0 },
    });

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, {
        name: 'Shipped',
        category: ColumnCategory.COMPLETED,
      }),
    ).resolves.toMatchObject({ category: ColumnCategory.COMPLETED });
    expect(prisma.column.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: ColumnCategory.COMPLETED }),
      }),
    );
  });

  it('leaves category to the schema default when create omits it', async () => {
    const { service, prisma } = buildService();
    prisma.column.findMany.mockResolvedValue([]);
    prisma.column.create.mockResolvedValue({
      id: 'new',
      boardId: BOARD_ID,
      name: 'Review',
      position: 1000,
      color: null,
      category: ColumnCategory.UNSTARTED,
      _count: { tasks: 0 },
    });

    await service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Review' });

    // `undefined` is what makes Prisma fall through to `@default(UNSTARTED)`; sending a
    // guess derived from the name is exactly the behaviour ADR 0019 removes.
    const { data } = prisma.column.create.mock.calls[0]![0] as {
      data: { category?: unknown };
    };
    expect(data.category).toBeUndefined();
  });

  it('reads exactly the DTO fields when listing a board', async () => {
    const { service, prisma } = buildService();
    prisma.column.findMany.mockResolvedValue([
      {
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Todo',
        position: 1000,
        color: null,
        category: ColumnCategory.UNSTARTED,
        _count: { tasks: 3 },
      },
    ]);

    await expect(service.list(WORKSPACE_ID, BOARD_ID)).resolves.toEqual([
      {
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Todo',
        position: 1000,
        color: null,
        category: ColumnCategory.UNSTARTED,
        taskCount: 3,
      },
    ]);
    expect(prisma.column.findMany).toHaveBeenCalledWith({
      where: { boardId: BOARD_ID },
      select: {
        id: true,
        boardId: true,
        name: true,
        position: true,
        color: true,
        category: true,
        _count: { select: { tasks: true } },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
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
    expect(realtime.emitToBoard).toHaveBeenCalledWith(
      BOARD_ID,
      SocketEvents.COLUMN_CHANGED,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        boardId: BOARD_ID,
        actorId: ACTOR_ID,
        columnId: COLUMN_ID,
      }),
    );
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

  describe('audit trail', () => {
    it('records a created column against the actor', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.column.findMany.mockResolvedValue([]);
      prisma.column.create.mockResolvedValue({
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Review',
        position: 1000,
        color: null,
        category: ColumnCategory.STARTED,
        _count: { tasks: 0 },
      });

      await service.create(WORKSPACE_ID, BOARD_ID, ACTOR_ID, { name: 'Review' });

      expect(activityService.record).toHaveBeenCalledWith(prisma, {
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.ColumnCreated,
        payload: {
          columnId: COLUMN_ID,
          boardId: BOARD_ID,
          name: 'Review',
          category: ColumnCategory.STARTED,
        },
      });
    });

    it('records one entry per seeded column, marked as a seed', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.column.findMany.mockResolvedValue(seededRows());

      await service.createDefaults(WORKSPACE_ID, BOARD_ID, ACTOR_ID);

      expect(activityService.record).toHaveBeenCalledTimes(3);
      expect(activityService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: ActivityType.ColumnCreated,
          payload: expect.objectContaining({ name: 'Done', seeded: true }),
        }),
      );
    });

    it('records a category change with both sides of it', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.column.findFirst.mockResolvedValue({
        id: COLUMN_ID,
        name: 'Shipped',
        color: null,
        category: ColumnCategory.STARTED,
      });
      prisma.column.update.mockResolvedValue({
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Shipped',
        position: 1000,
        color: null,
        category: ColumnCategory.COMPLETED,
        _count: { tasks: 0 },
      });

      await service.update(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, {
        category: ColumnCategory.COMPLETED,
      });

      // The field that silently moves a stage across the Done boundary the dashboard measures.
      expect(activityService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: ActivityType.ColumnUpdated,
          payload: expect.objectContaining({
            changes: {
              category: { from: ColumnCategory.STARTED, to: ColumnCategory.COMPLETED },
            },
          }),
        }),
      );
    });

    it('records a deleted column before the delete, inside the same transaction', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.column.findFirst.mockResolvedValue({
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Blocked',
        position: 1000,
        color: null,
        category: ColumnCategory.STARTED,
      });

      await service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID);

      expect(activityService.record).toHaveBeenCalledWith(prisma, {
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.ColumnDeleted,
        payload: {
          columnId: COLUMN_ID,
          boardId: BOARD_ID,
          name: 'Blocked',
          category: ColumnCategory.STARTED,
        },
      });
      expect(activityService.record.mock.invocationCallOrder[0]!).toBeLessThan(
        prisma.column.deleteMany.mock.invocationCallOrder[0]!,
      );
    });

    it('writes nothing when the column is refused for holding tasks', async () => {
      const { service, prisma, activityService } = buildService();
      prisma.column.findFirst.mockResolvedValue({
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Blocked',
        position: 1000,
        color: null,
        category: ColumnCategory.STARTED,
      });
      prisma.task.count.mockResolvedValue(4);

      await expect(service.remove(WORKSPACE_ID, COLUMN_ID, ACTOR_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(activityService.record).not.toHaveBeenCalled();
    });
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
        category: ColumnCategory.UNSTARTED,
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

    it('writes a category change without touching the name', async () => {
      const { service, prisma } = buildService();
      prisma.column.findFirst.mockResolvedValue({ id: COLUMN_ID });
      prisma.column.update.mockResolvedValue({
        id: COLUMN_ID,
        boardId: BOARD_ID,
        name: 'Shipped',
        position: 1000,
        color: null,
        category: ColumnCategory.COMPLETED,
        _count: { tasks: 0 },
      });

      // The whole point of ADR 0019: a column called "Shipped" can mean completed without
      // being renamed to something the metrics recognise.
      await expect(
        service.update(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, {
          category: ColumnCategory.COMPLETED,
        }),
      ).resolves.toMatchObject({ name: 'Shipped', category: ColumnCategory.COMPLETED });

      expect(prisma.column.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { category: ColumnCategory.COMPLETED } }),
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

  it('locks the board row before reading siblings on move, after the neighbor check', async () => {
    const { service, prisma } = buildService();
    const column = { id: COLUMN_ID, boardId: BOARD_ID, name: 'Todo', position: 2000, color: null };
    const before = {
      id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54',
      boardId: BOARD_ID,
      position: 1000,
    };
    const after = {
      id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55',
      boardId: BOARD_ID,
      position: 3000,
    };
    const callOrder: string[] = [];
    const tx = {
      column: {
        findFirst: jest.fn().mockImplementation(async () => {
          callOrder.push('findFirst');
          return column;
        }),
        findMany: jest.fn().mockImplementation(async () => {
          callOrder.push('findMany');
          return [before, after, column];
        }),
        update: jest.fn().mockResolvedValue({ ...column, position: 2000, _count: { tasks: 0 } }),
      },
      $executeRaw: jest.fn().mockImplementation(async () => {
        callOrder.push('lock');
        return 1;
      }),
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );

    await service.move(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, {
      beforeColumnId: before.id,
      afterColumnId: after.id,
    });

    // BE-05: `move` opened a transaction but never locked the board row inside it — the read
    // and write it wraps are consistent with each other but not with a second, concurrent
    // move into the same gap. The lock has to come after the neighbor-check read (which needs
    // no consistency guarantee, only the row's existence) and before the sibling scan that
    // feeds the midpoint math.
    expect(callOrder).toEqual(['findFirst', 'lock', 'findMany']);
    const [fragments] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray];
    expect(fragments.join('?')).toContain('FOR UPDATE');
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
    const siblingQuery = jest.fn().mockResolvedValue([beforeNeighbor, afterNeighbor, column]);
    const writeOrder: string[] = [];
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        column: {
          findFirst: jest.fn().mockResolvedValue(column),
          findMany: siblingQuery,
          update: jest.fn().mockImplementation(async () => {
            writeOrder.push('moved:start');
            await Promise.resolve();
            writeOrder.push('moved:done');
            return { ...column, position: 2000 };
          }),
          findFirstOrThrow: jest.fn().mockResolvedValue({
            ...column,
            position: 2000,
            _count: { tasks: 7 },
          }),
        },
        // Two different statements now share `tx.$executeRaw`: the board-row lock this test
        // isn't about, and the sibling rebalance write it is. Only the latter should show up
        // in `writeOrder` — telling them apart by their SQL keeps this test asserting the same
        // thing it always did instead of also becoming a lock-ordering test.
        $executeRaw: jest.fn().mockImplementation(async (fragments: TemplateStringsArray) => {
          if (fragments.join('?').includes('FOR UPDATE')) return 1;
          writeOrder.push('siblings:start');
          await Promise.resolve();
          writeOrder.push('siblings:done');
          return 2;
        }),
      }),
    );

    await expect(
      service.move(WORKSPACE_ID, COLUMN_ID, ACTOR_ID, {
        beforeColumnId: beforeNeighbor.id,
        afterColumnId: afterNeighbor.id,
      }),
    ).resolves.toMatchObject({ id: COLUMN_ID, taskCount: 7 });
    // The `_count` the response needs comes from the re-read after the write, not from the
    // sibling scan, which only feeds the ordering math.
    expect(siblingQuery).toHaveBeenCalledWith({
      where: { boardId: BOARD_ID },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });
    // An interactive transaction is one connection: the rebalance writes run one after the
    // other, so a failure names a statement and leaves a state that can be reasoned about.
    expect(writeOrder).toEqual(['moved:start', 'moved:done', 'siblings:start', 'siblings:done']);
    expect(realtime.emitToBoard).toHaveBeenCalled();
  });
});
