import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SocketEvents, type ColumnDto } from '@kurultay/shared-types';
import { assertBoard } from '../common/board-access';
import { resolveMoveNeighbors } from '../common/position/apply-insertion';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CreateColumnDto } from './dto/create-column.dto';
import type { MoveColumnDto } from './dto/move-column.dto';
import type { UpdateColumnDto } from './dto/update-column.dto';

type ColumnRow = {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  _count?: { tasks: number };
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
      taskCount: row._count?.tasks ?? 0,
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
    const columns = await this.prisma.column.findMany({
      where: { boardId },
      include: { _count: { select: { tasks: true } } },
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
    const columns = await this.prisma.column.findMany({
      where: { boardId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const after = dto.afterColumnId
      ? columns.find((column) => column.id === dto.afterColumnId)
      : columns.at(-1);
    if (dto.afterColumnId && !after) throw new NotFoundException('Column not found');
    const afterIndex = after ? columns.indexOf(after) : -1;
    const before = after ? columns[afterIndex + 1] : columns[0];
    const position = midpoint(after?.position ?? null, before?.position ?? null);

    let created: ColumnDto;
    if (needsRebalance(after?.position ?? null, before?.position ?? null)) {
      created = await this.prisma.$transaction(async (tx) => {
        const positions = rebalancePositions(columns.length + 1);
        const insertionIndex = after ? afterIndex + 1 : 0;
        await Promise.all(
          columns.map((column, index) =>
            tx.column.updateMany({
              where: { id: column.id, boardId },
              data: { position: positions[index < insertionIndex ? index : index + 1]! },
            }),
          ),
        );
        const row = await tx.column.create({
          data: {
            boardId,
            name: dto.name,
            color: dto.color,
            position: positions[insertionIndex]!,
          },
          include: { _count: { select: { tasks: true } } },
        });
        return this.toDto(row);
      });
    } else {
      const row = await this.prisma.column.create({
        data: { boardId, name: dto.name, color: dto.color, position },
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
    await this.findColumn(workspaceId, columnId);
    const column = await this.prisma.column.update({
      where: { id: columnId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
      include: { _count: { select: { tasks: true } } },
    });
    const dtoOut = this.toDto(column);
    this.emitChanged(workspaceId, actorId, dtoOut.boardId, dtoOut.id);
    return dtoOut;
  }

  async remove(workspaceId: string, columnId: string, actorId: string): Promise<void> {
    const column = await this.findColumn(workspaceId, columnId);
    const taskCount = await this.prisma.task.count({ where: { columnId } });
    if (taskCount > 0) {
      throw new ConflictException('Column has tasks; move or delete them first');
    }
    await this.prisma.column.delete({ where: { id: columnId } });
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

      const columns = await tx.column.findMany({
        where: { boardId: column.boardId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const remaining = columns.filter((item) => item.id !== columnId);
      const { insertionIndex, before, after } = resolveMoveNeighbors(
        remaining,
        dto.beforeColumnId,
        dto.afterColumnId,
        columnId,
      );
      if (needsRebalance(before?.position ?? null, after?.position ?? null)) {
        const reordered = [...remaining];
        reordered.splice(insertionIndex, 0, column);
        const positions = rebalancePositions(reordered.length);
        await Promise.all(
          reordered.map((item, index) =>
            tx.column.updateMany({
              where: { id: item.id, boardId: column.boardId },
              data: { position: positions[index]! },
            }),
          ),
        );
        const refreshed = await tx.column.findFirstOrThrow({
          where: { id: columnId, board: { workspaceId } },
          include: { _count: { select: { tasks: true } } },
        });
        return this.toDto({ ...refreshed, position: positions[insertionIndex]! });
      }

      const updated = await tx.column.update({
        where: { id: columnId },
        data: { position: midpoint(before?.position ?? null, after?.position ?? null) },
        include: { _count: { select: { tasks: true } } },
      });
      return this.toDto(updated);
    });

    this.emitChanged(workspaceId, actorId, moved.boardId, moved.id);
    return moved;
  }

  private async findColumn(workspaceId: string, columnId: string) {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, board: { workspaceId } },
    });
    if (!column) throw new NotFoundException('Column not found');
    return column;
  }
}
