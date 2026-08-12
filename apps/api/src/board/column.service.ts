import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SocketEvents, type ColumnCategory, type ColumnDto } from '@kurultay/shared-types';
import { assertBoard } from '../common/board-access';
import { resolveCreateNeighbors, resolveMoveNeighbors } from '../common/position/apply-insertion';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { batchUpdateColumnPositions } from '../common/position/rebalance-sql';
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
    // Ordering math only: id and position are the whole input to the neighbour lookup and the
    // rebalance that may follow.
    const columns = await this.prisma.column.findMany({
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

    let created: ColumnDto;
    if (needsRebalance(prev?.position ?? null, next?.position ?? null)) {
      created = await this.prisma.$transaction(async (tx) => {
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
      });
    } else {
      const row = await this.prisma.column.create({
        data: { boardId, name: dto.name, color: dto.color, category: dto.category, position },
        include: { _count: { select: { tasks: true } } },
      });
      created = this.toDto(row);
    }

    this.emitChanged(workspaceId, actorId, created.boardId, created.id);
    return created;
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
      const scoped = await tx.column.findFirst({
        where: { id: columnId, board: { workspaceId } },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Column not found');

      // The write predicate repeats the tenant scope: the check above only proves the row was
      // in the workspace when it ran, the predicate is what the database enforces.
      return tx.column.update({
        where: { id: columnId, board: { workspaceId } },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
        },
        include: { _count: { select: { tasks: true } } },
      });
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
