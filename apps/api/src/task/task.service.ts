import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TaskDto } from '@kurultay/shared-types';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { MoveTaskDto } from './dto/move-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';

type TaskRow = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskDto['priority'];
  position: number;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: TaskRow): TaskDto {
    return {
      id: row.id,
      boardId: row.boardId,
      columnId: row.columnId,
      title: row.title,
      description: row.description,
      priority: row.priority,
      position: row.position,
      dueDate: row.dueDate?.toISOString() ?? null,
      estimatedMinutes: row.estimatedMinutes,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(workspaceId: string, boardId: string): Promise<TaskDto[]> {
    await this.findBoard(workspaceId, boardId);
    const tasks = await this.prisma.task.findMany({
      where: { boardId },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    });
    return tasks.map((task) => this.toDto(task));
  }

  async create(
    workspaceId: string,
    boardId: string,
    userId: string,
    dto: CreateTaskDto,
  ): Promise<TaskDto> {
    await this.findBoard(workspaceId, boardId);
    const column = await this.findColumnOnBoard(workspaceId, boardId, dto.columnId);

    const siblings = await this.prisma.task.findMany({
      where: { columnId: column.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    const after = dto.afterTaskId
      ? siblings.find((task) => task.id === dto.afterTaskId)
      : siblings.at(-1);
    if (dto.afterTaskId && !after) throw new NotFoundException('Task not found');

    const afterIndex = after ? siblings.indexOf(after) : -1;
    const before = after ? siblings[afterIndex + 1] : siblings[0];
    const beforePos = after?.position ?? null;
    const afterPos = before?.position ?? null;

    if (needsRebalance(beforePos, afterPos)) {
      return this.prisma.$transaction(async (tx) => {
        const positions = rebalancePositions(siblings.length + 1);
        const insertionIndex = after ? afterIndex + 1 : 0;
        await Promise.all(
          siblings.map((task, index) =>
            tx.task.update({
              where: { id: task.id },
              data: { position: positions[index < insertionIndex ? index : index + 1]! },
            }),
          ),
        );
        const created = await tx.task.create({
          data: {
            boardId,
            columnId: column.id,
            title: dto.title,
            description: dto.description ?? null,
            position: positions[insertionIndex]!,
            createdById: userId,
          },
        });
        return this.toDto(created);
      });
    }

    const created = await this.prisma.task.create({
      data: {
        boardId,
        columnId: column.id,
        title: dto.title,
        description: dto.description ?? null,
        position: midpoint(beforePos, afterPos),
        createdById: userId,
      },
    });
    return this.toDto(created);
  }

  async get(workspaceId: string, taskId: string): Promise<TaskDto> {
    return this.toDto(await this.findTask(workspaceId, taskId));
  }

  async update(workspaceId: string, taskId: string, dto: UpdateTaskDto): Promise<TaskDto> {
    await this.findTask(workspaceId, taskId);
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
    return this.toDto(updated);
  }

  async remove(workspaceId: string, taskId: string): Promise<void> {
    await this.findTask(workspaceId, taskId);
    await this.prisma.task.delete({ where: { id: taskId } });
  }

  async move(workspaceId: string, taskId: string, dto: MoveTaskDto): Promise<TaskDto> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, board: { workspaceId } },
      });
      if (!task) throw new NotFoundException('Task not found');

      if (dto.beforeTaskId === taskId || dto.afterTaskId === taskId) {
        throw new BadRequestException('A task cannot be its own neighbor');
      }

      const targetColumn = await tx.column.findFirst({
        where: { id: dto.columnId, board: { workspaceId } },
      });
      if (!targetColumn) throw new NotFoundException('Column not found');
      if (targetColumn.boardId !== task.boardId) {
        throw new UnprocessableEntityException('Cannot move a task to a column on another board');
      }

      const siblings = await tx.task.findMany({
        where: { columnId: targetColumn.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const remaining = siblings.filter((item) => item.id !== taskId);

      const beforeIndex =
        dto.beforeTaskId === null || dto.beforeTaskId === undefined
          ? -1
          : remaining.findIndex((item) => item.id === dto.beforeTaskId);
      const afterIndex =
        dto.afterTaskId === null || dto.afterTaskId === undefined
          ? -1
          : remaining.findIndex((item) => item.id === dto.afterTaskId);

      if (
        (dto.beforeTaskId && beforeIndex < 0) ||
        (dto.afterTaskId && afterIndex < 0) ||
        (beforeIndex >= 0 && afterIndex >= 0 && afterIndex !== beforeIndex + 1)
      ) {
        throw new NotFoundException('Task not found');
      }

      const insertionIndex =
        beforeIndex >= 0 ? beforeIndex + 1 : afterIndex >= 0 ? afterIndex : remaining.length;
      const before = remaining[insertionIndex - 1] ?? null;
      const after = remaining[insertionIndex] ?? null;

      if (needsRebalance(before?.position ?? null, after?.position ?? null)) {
        const reordered = [...remaining];
        reordered.splice(insertionIndex, 0, { ...task, columnId: targetColumn.id });
        const positions = rebalancePositions(reordered.length);
        await Promise.all(
          reordered.map((item, index) =>
            tx.task.update({
              where: { id: item.id },
              data: {
                position: positions[index]!,
                ...(item.id === taskId ? { columnId: targetColumn.id } : {}),
              },
            }),
          ),
        );
        return this.toDto({
          ...task,
          columnId: targetColumn.id,
          position: positions[insertionIndex]!,
          updatedAt: new Date(),
        });
      }

      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          columnId: targetColumn.id,
          position: midpoint(before?.position ?? null, after?.position ?? null),
        },
      });
      return this.toDto(updated);
    });
  }

  private async findBoard(workspaceId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, workspaceId } });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  private async findColumnOnBoard(workspaceId: string, boardId: string, columnId: string) {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, boardId, board: { workspaceId } },
    });
    if (!column) throw new NotFoundException('Column not found');
    return column;
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
