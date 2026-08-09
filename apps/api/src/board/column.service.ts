import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ColumnDto } from '@kurultay/shared-types';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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

  async list(workspaceId: string, boardId: string): Promise<ColumnDto[]> {
    await this.findBoard(workspaceId, boardId);
    const columns = await this.prisma.column.findMany({
      where: { boardId },
      include: { _count: { select: { tasks: true } } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return columns.map((column) => this.toDto(column));
  }

  async create(workspaceId: string, boardId: string, dto: CreateColumnDto): Promise<ColumnDto> {
    await this.findBoard(workspaceId, boardId);
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

    if (needsRebalance(after?.position ?? null, before?.position ?? null)) {
      return this.prisma.$transaction(async (tx) => {
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
        const created = await tx.column.create({
          data: {
            boardId,
            name: dto.name,
            color: dto.color,
            position: positions[insertionIndex]!,
          },
          include: { _count: { select: { tasks: true } } },
        });
        return this.toDto(created);
      });
    }

    const created = await this.prisma.column.create({
      data: { boardId, name: dto.name, color: dto.color, position },
      include: { _count: { select: { tasks: true } } },
    });
    return this.toDto(created);
  }

  async update(workspaceId: string, columnId: string, dto: UpdateColumnDto): Promise<ColumnDto> {
    await this.findColumn(workspaceId, columnId);
    const column = await this.prisma.column.update({
      where: { id: columnId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
      include: { _count: { select: { tasks: true } } },
    });
    return this.toDto(column);
  }

  async remove(workspaceId: string, columnId: string): Promise<void> {
    await this.findColumn(workspaceId, columnId);
    await this.prisma.column.delete({ where: { id: columnId } });
  }

  async move(workspaceId: string, columnId: string, dto: MoveColumnDto): Promise<ColumnDto> {
    return this.prisma.$transaction(async (tx) => {
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
      const beforeIndex =
        dto.beforeColumnId === null || dto.beforeColumnId === undefined
          ? -1
          : remaining.findIndex((item) => item.id === dto.beforeColumnId);
      const afterIndex =
        dto.afterColumnId === null || dto.afterColumnId === undefined
          ? -1
          : remaining.findIndex((item) => item.id === dto.afterColumnId);
      if (
        (dto.beforeColumnId && beforeIndex < 0) ||
        (dto.afterColumnId && afterIndex < 0) ||
        (beforeIndex >= 0 && afterIndex >= 0 && afterIndex !== beforeIndex + 1)
      ) {
        throw new NotFoundException('Column not found');
      }

      const insertionIndex =
        beforeIndex >= 0 ? beforeIndex + 1 : afterIndex >= 0 ? afterIndex : remaining.length;
      const before = remaining[insertionIndex - 1] ?? null;
      const after = remaining[insertionIndex] ?? null;
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
        return this.toDto({ ...column, position: positions[insertionIndex]! });
      }

      const updated = await tx.column.update({
        where: { id: columnId },
        data: { position: midpoint(before?.position ?? null, after?.position ?? null) },
        include: { _count: { select: { tasks: true } } },
      });
      return this.toDto(updated);
    });
  }

  private async findBoard(workspaceId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, workspaceId } });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  private async findColumn(workspaceId: string, columnId: string) {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, board: { workspaceId } },
    });
    if (!column) throw new NotFoundException('Column not found');
    return column;
  }
}
