import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivityType } from '@kurultay/shared-types';
import type {
  CursorPage,
  LabelColorSlot,
  LabelDto,
  TaskAssigneeDto,
  TaskDto,
} from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { ActivityService } from '../activity/activity.service';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AddAssigneeDto } from './dto/add-assignee.dto';
import type { AddTaskLabelDto } from './dto/add-task-label.dto';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { MoveTaskDto } from './dto/move-task.dto';
import type { TaskQueryDto } from './dto/task-query.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';

const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { id: 'asc' as const },
  },
  labels: {
    include: { label: true },
    orderBy: { id: 'asc' as const },
  },
};

type TaskWithRelations = {
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
  assignees: Array<{
    user: { id: string; name: string; avatarUrl: string | null };
  }>;
  labels: Array<{
    label: { id: string; boardId: string; name: string; color: string };
  }>;
};

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationService: NotificationService,
  ) {}

  private toDto(row: TaskWithRelations): TaskDto {
    const assignees: TaskAssigneeDto[] = row.assignees.map((entry) => ({
      userId: entry.user.id,
      name: entry.user.name,
      avatarUrl: entry.user.avatarUrl,
    }));
    const labels: LabelDto[] = row.labels.map((entry) => ({
      id: entry.label.id,
      boardId: entry.label.boardId,
      name: entry.label.name,
      color: entry.label.color as LabelColorSlot,
    }));
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
      assignees,
      labels,
    };
  }

  private emptyRelations<T extends Omit<TaskWithRelations, 'assignees' | 'labels'>>(
    row: T,
  ): TaskWithRelations {
    return { ...row, assignees: [], labels: [] };
  }

  async list(
    workspaceId: string,
    boardId: string,
    query: TaskQueryDto,
  ): Promise<CursorPage<TaskDto>> {
    await this.findBoard(workspaceId, boardId);

    const where = this.buildListWhere(boardId, query);
    const limit = query.limit ?? 50;

    const rows = await this.prisma.task.findMany({
      where,
      include: taskInclude,
      // Cursor walks by immutable id (api-conventions); display sort is the client's job.
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return {
      items: page.map((task) => this.toDto(task)),
      nextCursor,
      hasMore,
    };
  }

  private buildListWhere(boardId: string, query: TaskQueryDto): Prisma.TaskWhereInput {
    const and: Prisma.TaskWhereInput[] = [];

    if (query.cursor) {
      and.push({ id: { gt: query.cursor } });
    }

    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    if (query.priority && query.priority.length > 0) {
      and.push({ priority: { in: query.priority } });
    }

    if (query.assigneeId && query.assigneeId.length > 0) {
      const wantsUnassigned = query.assigneeId.includes('null');
      const userIds = query.assigneeId.filter((id) => id !== 'null');
      const assigneeOr: Prisma.TaskWhereInput[] = [];
      if (wantsUnassigned) {
        assigneeOr.push({ assignees: { none: {} } });
      }
      if (userIds.length > 0) {
        assigneeOr.push({ assignees: { some: { userId: { in: userIds } } } });
      }
      and.push(assigneeOr.length === 1 ? assigneeOr[0]! : { OR: assigneeOr });
    }

    if (query.labelId && query.labelId.length > 0) {
      and.push({ labels: { some: { labelId: { in: query.labelId } } } });
    }

    if (query.dueDate === 'null') {
      and.push({ dueDate: null });
    }

    const dueGte = query['dueDate[gte]'];
    const dueLte = query['dueDate[lte]'];
    if (dueGte || dueLte) {
      and.push({
        dueDate: {
          ...(dueGte ? { gte: new Date(dueGte) } : {}),
          ...(dueLte ? { lte: new Date(dueLte) } : {}),
        },
      });
    }

    return {
      boardId,
      ...(and.length > 0 ? { AND: and } : {}),
    };
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

    return this.prisma.$transaction(async (tx) => {
      let created: Omit<TaskWithRelations, 'assignees' | 'labels'>;

      if (needsRebalance(beforePos, afterPos)) {
        const positions = rebalancePositions(siblings.length + 1);
        const insertionIndex = after ? afterIndex + 1 : 0;
        await Promise.all(
          siblings.map((task, index) =>
            tx.task.updateMany({
              where: { id: task.id, columnId: column.id },
              data: { position: positions[index < insertionIndex ? index : index + 1]! },
            }),
          ),
        );
        created = await tx.task.create({
          data: {
            boardId,
            columnId: column.id,
            title: dto.title,
            description: dto.description ?? null,
            position: positions[insertionIndex]!,
            createdById: userId,
          },
        });
      } else {
        created = await tx.task.create({
          data: {
            boardId,
            columnId: column.id,
            title: dto.title,
            description: dto.description ?? null,
            position: midpoint(beforePos, afterPos),
            createdById: userId,
          },
        });
      }

      await this.activityService.record(tx, {
        workspaceId,
        taskId: created.id,
        userId,
        type: ActivityType.TaskCreated,
        payload: {
          title: created.title,
          columnId: created.columnId,
          boardId: created.boardId,
        },
      });

      return this.toDto(this.emptyRelations(created));
    });
  }

  async get(workspaceId: string, taskId: string): Promise<TaskDto> {
    return this.toDto(await this.findTask(workspaceId, taskId));
  }

  async update(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    const existing = await this.findTask(workspaceId, taskId);

    let dueDate: Date | null | undefined;
    if (dto.dueDate !== undefined) {
      if (dto.dueDate === null) {
        dueDate = null;
      } else {
        const due = new Date(dto.dueDate);
        if (Number.isNaN(due.getTime())) {
          throw new BadRequestException('dueDate must be a valid ISO 8601 timestamp');
        }
        dueDate = due;
      }
    }

    const changes: Record<string, unknown> = {};
    if (dto.title !== undefined && dto.title !== existing.title) changes.title = dto.title;
    if (dto.description !== undefined && dto.description !== existing.description) {
      changes.description = dto.description;
    }
    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      changes.priority = dto.priority;
    }
    if (dueDate !== undefined) {
      const prev = existing.dueDate?.toISOString() ?? null;
      const next = dueDate?.toISOString() ?? null;
      if (prev !== next) changes.dueDate = next;
    }
    if (dto.estimatedMinutes !== undefined && dto.estimatedMinutes !== existing.estimatedMinutes) {
      changes.estimatedMinutes = dto.estimatedMinutes;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dueDate !== undefined ? { dueDate } : {}),
          ...(dto.estimatedMinutes !== undefined ? { estimatedMinutes: dto.estimatedMinutes } : {}),
        },
        include: taskInclude,
      });

      if (Object.keys(changes).length > 0) {
        await this.activityService.record(tx, {
          workspaceId,
          taskId,
          userId,
          type: ActivityType.TaskUpdated,
          payload: {
            title: updated.title,
            changes,
          },
        });
      }

      return this.toDto(updated);
    });
  }

  async remove(workspaceId: string, taskId: string, userId: string): Promise<void> {
    const task = await this.findTask(workspaceId, taskId);
    await this.prisma.$transaction(async (tx) => {
      // Activity.taskId cascades on task delete — keep the row via null FK + payload.
      await this.activityService.record(tx, {
        workspaceId,
        taskId: null,
        userId,
        type: ActivityType.TaskDeleted,
        payload: {
          taskId: task.id,
          title: task.title,
          columnId: task.columnId,
          boardId: task.boardId,
        },
      });
      await tx.task.delete({ where: { id: taskId } });
    });
  }

  async move(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: MoveTaskDto,
  ): Promise<TaskDto> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, board: { workspaceId } },
        include: taskInclude,
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

      const fromColumnId = task.columnId;

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

      let result: TaskDto;

      if (needsRebalance(before?.position ?? null, after?.position ?? null)) {
        const reordered = [...remaining];
        reordered.splice(insertionIndex, 0, { ...task, columnId: targetColumn.id });
        const positions = rebalancePositions(reordered.length);
        await Promise.all(
          reordered.map(async (item, index) => {
            if (item.id === taskId) {
              await tx.task.update({
                where: { id: item.id },
                data: {
                  position: positions[index]!,
                  columnId: targetColumn.id,
                },
              });
              return;
            }
            await tx.task.updateMany({
              where: { id: item.id, columnId: targetColumn.id },
              data: { position: positions[index]! },
            });
          }),
        );
        result = this.toDto({
          ...task,
          columnId: targetColumn.id,
          position: positions[insertionIndex]!,
          updatedAt: new Date(),
        });
      } else {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            columnId: targetColumn.id,
            position: midpoint(before?.position ?? null, after?.position ?? null),
          },
          include: taskInclude,
        });
        result = this.toDto(updated);
      }

      await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId,
        type: ActivityType.TaskMoved,
        payload: {
          title: task.title,
          fromColumnId,
          toColumnId: targetColumn.id,
        },
      });

      return result;
    });
  }

  async addAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddAssigneeDto,
  ): Promise<TaskDto> {
    const task = await this.findTask(workspaceId, taskId);
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: dto.userId },
    });
    if (!member) {
      throw new UnprocessableEntityException('User is not a member of this workspace');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskAssignee.create({
          data: { taskId: task.id, userId: dto.userId },
        });

        const activity = await this.activityService.record(tx, {
          workspaceId,
          taskId: task.id,
          userId: actorId,
          type: ActivityType.TaskAssigned,
          payload: {
            title: task.title,
            assigneeUserId: dto.userId,
          },
        });

        await this.notificationService.createAssignment(tx, {
          workspaceId,
          userId: dto.userId,
          actorId,
          taskId: task.id,
          activityId: activity.id,
          payload: {
            title: task.title,
            assigneeUserId: dto.userId,
            actorId,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('User is already assigned to this task');
      }
      throw error;
    }

    return this.toDto(await this.findTask(workspaceId, taskId));
  }

  async removeAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    assigneeUserId: string,
  ): Promise<TaskDto> {
    const task = await this.findTask(workspaceId, taskId);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.taskAssignee.deleteMany({
        where: { taskId, userId: assigneeUserId },
      });
      if (result.count === 0) throw new NotFoundException('Assignee not found');

      await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId: actorId,
        type: ActivityType.TaskUnassigned,
        payload: {
          title: task.title,
          assigneeUserId,
        },
      });
    });
    return this.toDto(await this.findTask(workspaceId, taskId));
  }

  async addLabel(workspaceId: string, taskId: string, dto: AddTaskLabelDto): Promise<TaskDto> {
    const task = await this.findTask(workspaceId, taskId);
    const label = await this.prisma.label.findFirst({
      where: { id: dto.labelId, boardId: task.boardId },
    });
    if (!label) {
      throw new UnprocessableEntityException('Label does not belong to this task board');
    }

    try {
      await this.prisma.taskLabel.create({
        data: { taskId: task.id, labelId: label.id },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Label is already assigned to this task');
      }
      throw error;
    }

    return this.toDto(await this.findTask(workspaceId, taskId));
  }

  async removeLabel(workspaceId: string, taskId: string, labelId: string): Promise<TaskDto> {
    await this.findTask(workspaceId, taskId);
    const result = await this.prisma.taskLabel.deleteMany({
      where: { taskId, labelId },
    });
    if (result.count === 0) throw new NotFoundException('Task label not found');
    return this.toDto(await this.findTask(workspaceId, taskId));
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    );
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

  private async findTask(workspaceId: string, taskId: string): Promise<TaskWithRelations> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
