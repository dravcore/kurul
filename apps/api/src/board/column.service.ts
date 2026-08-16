import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  SocketEvents,
  type ColumnCategory,
  type ColumnDto,
} from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { assertBoard } from '../common/board-access';
import { defaultColumnsFor } from '../common/board-defaults';
import { fieldChanges } from '../common/field-changes';
import { resolveCreateNeighbors, resolveMoveNeighbors } from '../common/position/apply-insertion';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { batchUpdateColumnPositions } from '../common/position/rebalance-sql';
import { LocaleService } from '../locale/locale.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CreateColumnDto } from './dto/create-column.dto';
import type { MoveColumnDto } from './dto/move-column.dto';
import type { UpdateColumnDto } from './dto/update-column.dto';

/**
 * A column row as `toDto` needs it. `_count` is required on purpose: when it was optional a
 * query that forgot `include: { _count: … }` still compiled and silently reported
 * `taskCount: 0`, which is indistinguishable from a genuinely empty column.
 */
type ColumnRow = {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  category: ColumnCategory;
  _count: { tasks: number };
};

@Injectable()
export class ColumnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly localeService: LocaleService,
    private readonly activityService: ActivityService,
  ) {}

  private toDto(row: ColumnRow): ColumnDto {
    return {
      id: row.id,
      boardId: row.boardId,
      name: row.name,
      position: row.position,
      color: row.color,
      category: row.category,
      taskCount: row._count.tasks,
    };
  }

  private emitChanged(
    workspaceId: string,
    actorId: string,
    boardId: string,
    columnId: string,
  ): void {
    this.realtime.emitToBoard(boardId, SocketEvents.COLUMN_CHANGED, {
      workspaceId,
      boardId,
      actorId,
      columnId,
    });
  }

  async list(workspaceId: string, boardId: string): Promise<ColumnDto[]> {
    await assertBoard(this.prisma, workspaceId, boardId);
    // Selected rather than included: `ColumnRow` is exactly what `toDto` reads, and spelling
    // it out keeps `createdAt`/`updatedAt` off the wire on the board's hottest read.
    const columns = await this.prisma.column.findMany({
      where: { boardId },
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
    return columns.map((column) => this.toDto(column));
  }

  async create(
    workspaceId: string,
    boardId: string,
    actorId: string,
    dto: CreateColumnDto,
  ): Promise<ColumnDto> {
    await assertBoard(this.prisma, workspaceId, boardId);

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock before reading siblings so concurrent creates/moves into the same gap cannot
      // both compute the same midpoint from a shared snapshot. Matches the lock `move` takes
      // below and the one `createDefaults` takes on this same board row when seeding — the
      // rows being guarded there don't exist yet either, so the board row stands in for them.
      await tx.$executeRaw`SELECT id FROM "Board" WHERE id = ${boardId} FOR UPDATE`;

      // Ordering math only: id and position are the whole input to the neighbour lookup and the
      // rebalance that may follow.
      const columns = await tx.column.findMany({
        where: { boardId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      // `afterColumnId` is the client's word for "insert after this column", which in position
      // order makes that column the new row's `prev` — the DTO name is translated here, once.
      const { insertionIndex, prev, next } = resolveCreateNeighbors(
        columns,
        dto.afterColumnId,
        'Column not found',
      );
      const position = midpoint(prev?.position ?? null, next?.position ?? null);

      if (needsRebalance(prev?.position ?? null, next?.position ?? null)) {
        const positions = rebalancePositions(columns.length + 1);
        const updates = columns.map((column, index) => ({
          id: column.id,
          position: positions[index < insertionIndex ? index : index + 1]!,
        }));
        await batchUpdateColumnPositions(tx, boardId, updates);
        const row = await tx.column.create({
          data: {
            boardId,
            name: dto.name,
            color: dto.color,
            category: dto.category,
            position: positions[insertionIndex]!,
          },
          include: { _count: { select: { tasks: true } } },
        });
        return this.toDto(row);
      }

      const row = await tx.column.create({
        data: { boardId, name: dto.name, color: dto.color, category: dto.category, position },
        include: { _count: { select: { tasks: true } } },
      });
      return this.toDto(row);
    });

    // Written after the create rather than inside it: the audited writes join the transaction
    // the mutation already owns and open none where there was none, and only one of the two
    // branches above has one to join. That leaves a *creation* unpaired, which is the case it
    // can afford — a lost `column.created` row still has the column itself standing as
    // evidence, whereas a lost deletion entry leaves nothing behind, which is why `remove`
    // records inside the transaction that performs the delete.
    await this.activityService.record(this.prisma, {
      workspaceId,
      userId: actorId,
      type: ActivityType.ColumnCreated,
      payload: {
        columnId: created.id,
        boardId: created.boardId,
        name: created.name,
        category: created.category,
      },
    });

    this.emitChanged(workspaceId, actorId, created.boardId, created.id);
    return created;
  }

  /**
   * Seeds a board that has no columns with the starting set, in one transaction.
   *
   * Replaces a loop of three `POST .../columns` calls the web used to make. That loop had to
   * be serial — each request passed the previous column's id as `afterColumnId` to pin the
   * order — so a failure on the third request left the board holding two columns and no way
   * to tell a half-seeded board from one a user had trimmed on purpose. Here the board either
   * gains the whole set or none of it.
   *
   * Shares `defaultColumnsFor` with `BoardService.create`, which seeds the identical list when
   * the board is first created; the positions come from that list rather than from the
   * fractional-index math, because nothing exists to insert between.
   */
  async createDefaults(
    workspaceId: string,
    boardId: string,
    actorId: string,
    acceptLanguage?: string,
  ): Promise<ColumnDto[]> {
    await assertBoard(this.prisma, workspaceId, boardId);
    const locale = await this.localeService.resolve(actorId, acceptLanguage);

    const created = await this.prisma.$transaction(async (tx) => {
      // Locks the board row for the rest of the transaction. Two clients hitting this at once
      // would otherwise both read an empty board under READ COMMITTED and both insert, leaving
      // six columns and two "Done"s — and there is no unique constraint on the way to catch
      // it. Locking the board rather than the columns works because the rows being guarded do
      // not exist yet.
      await tx.$executeRaw`SELECT id FROM "Board" WHERE id = ${boardId} FOR UPDATE`;

      const existing = await tx.column.count({ where: { boardId } });
      if (existing > 0) {
        // Conflict, not a silent merge: this endpoint means "start this board off", and the
        // caller's empty-state view is stale. 409 tells the web to reload rather than append
        // a second set of stages.
        throw new ConflictException('Board already has columns');
      }

      await tx.column.createMany({
        data: defaultColumnsFor(locale).map((column) => ({ ...column, boardId })),
      });

      // Re-read rather than trusting `createMany`'s count: `_count` is required on `ColumnRow`
      // precisely so a caller cannot report `taskCount: 0` it never actually looked up.
      const rows = await tx.column.findMany({
        where: { boardId },
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

      // One audit row per column, for the same reason the socket emit below is per column:
      // these stages exist because an operator asked for them on a board that had none, which
      // is a different act from the seed `BoardService.create` writes as part of `board.created`.
      // Sequential inside the transaction, which is one connection anyway — the board row is
      // already locked and this endpoint fires at most once per board.
      for (const column of rows) {
        await this.activityService.record(tx, {
          workspaceId,
          userId: actorId,
          type: ActivityType.ColumnCreated,
          payload: {
            columnId: column.id,
            boardId,
            name: column.name,
            category: column.category,
            seeded: true,
          },
        });
      }

      return rows;
    });

    // One event per column, matching what a client would have seen from the loop this
    // replaces. Every listener answers by refetching the whole column list, so the extra
    // events cost a repeated read and nothing else.
    for (const column of created) {
      this.emitChanged(workspaceId, actorId, boardId, column.id);
    }
    return created.map((column) => this.toDto(column));
  }

  async update(
    workspaceId: string,
    columnId: string,
    actorId: string,
    dto: UpdateColumnDto,
  ): Promise<ColumnDto> {
    const column = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the column can
      // be deleted, or its board moved to another workspace, before the write runs.
      // `category` and the rest are selected as well as the id: they are what the audit row
      // reports as `from`, and reading them here means that value is the one this transaction
      // is replacing. `category` is the field that moves a column across the Done boundary the
      // dashboard measures throughput on, so a silent change to it is worth a name.
      const scoped = await tx.column.findFirst({
        where: { id: columnId, board: { workspaceId } },
        select: { id: true, name: true, color: true, category: true },
      });
      if (!scoped) throw new NotFoundException('Column not found');

      // The write predicate repeats the tenant scope: the check above only proves the row was
      // in the workspace when it ran, the predicate is what the database enforces.
      const updated = await tx.column.update({
        where: { id: columnId, board: { workspaceId } },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
        },
        include: { _count: { select: { tasks: true } } },
      });

      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.ColumnUpdated,
        payload: {
          columnId,
          boardId: updated.boardId,
          name: updated.name,
          changes: fieldChanges(scoped, updated, ['name', 'color', 'category']),
        },
      });

      return updated;
    });
    const dtoOut = this.toDto(column);
    this.emitChanged(workspaceId, actorId, dtoOut.boardId, dtoOut.id);
    return dtoOut;
  }

  async remove(workspaceId: string, columnId: string, actorId: string): Promise<void> {
    // Lookup, emptiness check and delete all run in one transaction: split across three
    // statements, a task could be created into the column after the count and still be
    // cascade-deleted by the delete, and the column could leave the workspace in between.
    const column = await this.prisma.$transaction(async (tx) => {
      const row = await tx.column.findFirst({
        where: { id: columnId, board: { workspaceId } },
      });
      if (!row) throw new NotFoundException('Column not found');

      const taskCount = await tx.task.count({ where: { columnId } });
      if (taskCount > 0) {
        throw new ConflictException('Column has tasks; move or delete them first');
      }

      // Recorded before the delete, inside the transaction that performs it: the name and
      // category stop existing the moment the row does, and a `NotFoundException` from the
      // check below rolls this entry back with the rest of the statement.
      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.ColumnDeleted,
        payload: {
          columnId,
          boardId: row.boardId,
          name: row.name,
          category: row.category,
        },
      });

      // deleteMany, not delete: it takes the same tenant predicate as the check above, so the
      // scope travels with the write instead of resting on the read.
      const { count } = await tx.column.deleteMany({
        where: { id: columnId, board: { workspaceId } },
      });
      // Cross-workspace access is 404, never 403 (docs/api-conventions.md) — a 403 would
      // confirm the row exists.
      if (count === 0) throw new NotFoundException('Column not found');

      return row;
    });
    this.emitChanged(workspaceId, actorId, column.boardId, column.id);
  }

  async move(
    workspaceId: string,
    columnId: string,
    actorId: string,
    dto: MoveColumnDto,
  ): Promise<ColumnDto> {
    const moved = await this.prisma.$transaction(async (tx) => {
      const column = await tx.column.findFirst({
        where: { id: columnId, board: { workspaceId } },
      });
      if (!column) throw new NotFoundException('Column not found');
      if (dto.beforeColumnId === columnId || dto.afterColumnId === columnId) {
        throw new BadRequestException('A column cannot be its own neighbor');
      }

      // Lock before reading siblings so concurrent creates/moves into the same gap cannot both
      // compute the same midpoint from a shared snapshot. Matches the lock `create` takes above
      // and the one `createDefaults` takes on this same board row when seeding.
      await tx.$executeRaw`SELECT id FROM "Board" WHERE id = ${column.boardId} FOR UPDATE`;

      // Same two columns as on create; the moved column itself was read in full above, and the
      // response is re-read with `_count` after the write.
      const columns = await tx.column.findMany({
        where: { boardId: column.boardId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      const remaining = columns.filter((item) => item.id !== columnId);
      // On a move the DTO fields line up with position order: `beforeColumnId` is the column
      // that ends up before the moved one (`prev`), `afterColumnId` the one that ends up after
      // (`next`). Note `afterColumnId` means the opposite of what it means on create — the
      // client contract, not the ordering math, is where that ambiguity lives.
      const { insertionIndex, prev, next } = resolveMoveNeighbors(
        remaining,
        dto.beforeColumnId,
        dto.afterColumnId,
      );
      if (needsRebalance(prev?.position ?? null, next?.position ?? null)) {
        const reordered = [...remaining];
        reordered.splice(insertionIndex, 0, { id: column.id, position: column.position });
        const positions = rebalancePositions(reordered.length);
        const otherUpdates = reordered
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.id !== columnId)
          .map(({ item, index }) => ({ id: item.id, position: positions[index]! }));

        // Sequential, not `Promise.all`: an interactive transaction is one connection, so the
        // two writes queue behind each other regardless. Racing them bought no parallelism and
        // cost the ability to say which statement failed and what the transaction had already
        // applied when it did.
        //
        // Scoped predicate on the write too — the transaction-local read above proves the
        // column was in the workspace, the predicate is what the database enforces.
        await tx.column.update({
          where: { id: columnId, board: { workspaceId } },
          data: { position: positions[insertionIndex]! },
        });
        await batchUpdateColumnPositions(tx, column.boardId, otherUpdates);
        const refreshed = await tx.column.findFirstOrThrow({
          where: { id: columnId, board: { workspaceId } },
          include: { _count: { select: { tasks: true } } },
        });
        return this.toDto(refreshed);
      }

      const updated = await tx.column.update({
        where: { id: columnId, board: { workspaceId } },
        data: { position: midpoint(prev?.position ?? null, next?.position ?? null) },
        include: { _count: { select: { tasks: true } } },
      });
      return this.toDto(updated);
    });

    this.emitChanged(workspaceId, actorId, moved.boardId, moved.id);
    return moved;
  }
}
