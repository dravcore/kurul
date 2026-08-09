import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivityType, SocketEvents } from '@kurultay/shared-types';
import type { CursorPage, TaskDto } from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { ActivityService } from '../activity/activity.service';
import { assertBoard } from '../common/board-access';
import { resolveCreateNeighbors, resolveMoveNeighbors } from '../common/position/apply-insertion';
import { midpoint, needsRebalance, rebalancePositions } from '../common/position/fractional-index';
import { batchUpdateTaskPositions } from '../common/position/rebalance-sql';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AddAssigneeDto } from './dto/add-assignee.dto';
import type { AddTaskLabelDto } from './dto/add-task-label.dto';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { MoveTaskDto } from './dto/move-task.dto';
import type { TaskQueryDto } from './dto/task-query.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import { createTaskAttributes, planTaskUpdate } from './task-fields';
import { TaskAssigneeService } from './task-assignee.service';
import { taskInclude, type TaskWithRelations } from './task.include';
import { TaskLabelService } from './task-label.service';
import { emptyTaskRelations, findTask, toTaskDto } from './task.mapper';

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly assignees: TaskAssigneeService,
    private readonly labels: TaskLabelService,
  ) {}

  async list(
    workspaceId: string,
    boardId: string,
    query: TaskQueryDto,
  ): Promise<CursorPage<TaskDto>> {
    await assertBoard(this.prisma, workspaceId, boardId);

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
      items: page.map((task) => toTaskDto(task)),
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
    await assertBoard(this.prisma, workspaceId, boardId);
    const column = await this.findColumnOnBoard(workspaceId, boardId, dto.columnId);

    const siblings = await this.prisma.task.findMany({
      where: { columnId: column.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    const { insertionIndex, before, after } = resolveCreateNeighbors(
      siblings,
      dto.afterTaskId,
      'Task not found',
    );
    const beforePos = before?.position ?? null;
    const afterPos = after?.position ?? null;
    const attributes = createTaskAttributes(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      let position: number;

      if (needsRebalance(beforePos, afterPos)) {
        // The gap is too small to split, so the whole column is respread and the new task
        // takes the slot the siblings were shifted around.
        const positions = rebalancePositions(siblings.length + 1);
        const updates = siblings.map((task, index) => ({
          id: task.id,
          position: positions[index < insertionIndex ? index : index + 1]!,
        }));
        await batchUpdateTaskPositions(tx, column.id, updates);
        position = positions[insertionIndex]!;
      } else {
        position = midpoint(beforePos, afterPos);
      }

      const created: Omit<TaskWithRelations, 'assignees' | 'labels'> = await tx.task.create({
        data: {
          boardId,
          columnId: column.id,
          ...attributes,
          position,
          createdById: userId,
        },
      });

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

      return toTaskDto(emptyTaskRelations(created));
    });

    this.realtime.emitToBoard(result.boardId, SocketEvents.TASK_CREATED, {
      workspaceId,
      boardId: result.boardId,
      actorId: userId,
      taskId: result.id,
    });
    return result;
  }

  async get(workspaceId: string, taskId: string): Promise<TaskDto> {
    return toTaskDto(await findTask(this.prisma, workspaceId, taskId));
  }

  async update(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    const existing = await findTask(this.prisma, workspaceId, taskId);
    const { data, changes } = planTaskUpdate(existing, dto);
    const changed = Object.keys(changes).length > 0;

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: the row could have been deleted, or moved out of
      // the workspace, between the read above and the write.
      const scoped = await tx.task.findFirst({
        where: { id: taskId, board: { workspaceId } },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Task not found');

      const updated = await tx.task.update({
        where: { id: taskId },
        data,
        include: taskInclude,
      });

      if (changed) {
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

      return toTaskDto(updated);
    });

    if (changed) {
      this.realtime.emitToBoard(result.boardId, SocketEvents.TASK_UPDATED, {
        workspaceId,
        boardId: result.boardId,
        actorId: userId,
        taskId: result.id,
      });
    }
    return result;
  }

  async remove(workspaceId: string, taskId: string, userId: string): Promise<void> {
    const task = await findTask(this.prisma, workspaceId, taskId);
    await this.prisma.$transaction(async (tx) => {
      // Activity.task onDelete SetNull — prior rows keep workspace history; stub carries payload.
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
    this.realtime.emitToBoard(task.boardId, SocketEvents.TASK_DELETED, {
      workspaceId,
      boardId: task.boardId,
      actorId: userId,
      taskId: task.id,
    });
  }

  async move(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: MoveTaskDto,
  ): Promise<TaskDto> {
    const result = await this.prisma.$transaction(async (tx) => {
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
      const fromColumn =
        fromColumnId === targetColumn.id
          ? targetColumn
          : await tx.column.findFirst({ where: { id: fromColumnId } });
      const fromColumnName = fromColumn?.name ?? '';

      const siblings = await tx.task.findMany({
        where: { columnId: targetColumn.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const remaining = siblings.filter((item) => item.id !== taskId);
      const { insertionIndex, before, after } = resolveMoveNeighbors(
        remaining,
        dto.beforeTaskId,
        dto.afterTaskId,
        taskId,
      );

      let result: TaskDto;

      if (needsRebalance(before?.position ?? null, after?.position ?? null)) {
        const reordered = [...remaining];
        reordered.splice(insertionIndex, 0, { ...task, columnId: targetColumn.id });
        const positions = rebalancePositions(reordered.length);
        const otherUpdates = reordered
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.id !== taskId)
          .map(({ item, index }) => ({ id: item.id, position: positions[index]! }));

        await Promise.all([
          tx.task.update({
            where: { id: taskId },
            data: {
              position: positions[insertionIndex]!,
              columnId: targetColumn.id,
            },
          }),
          batchUpdateTaskPositions(tx, targetColumn.id, otherUpdates),
        ]);
        result = toTaskDto({
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
        result = toTaskDto(updated);
      }

      await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId,
        type: ActivityType.TaskMoved,
        payload: {
          title: task.title,
          fromColumnId,
          fromColumnName,
          toColumnId: targetColumn.id,
          toColumnName: targetColumn.name,
        },
      });

      return result;
    });

    this.realtime.emitToBoard(result.boardId, SocketEvents.TASK_MOVED, {
      workspaceId,
      boardId: result.boardId,
      actorId: userId,
      taskId: result.id,
      columnId: result.columnId,
      position: result.position,
    });
    return result;
  }

  addAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddAssigneeDto,
  ): Promise<TaskDto> {
    return this.assignees.addAssignee(workspaceId, taskId, actorId, dto);
  }

  removeAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    assigneeUserId: string,
  ): Promise<TaskDto> {
    return this.assignees.removeAssignee(workspaceId, taskId, actorId, assigneeUserId);
  }

  addLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddTaskLabelDto,
  ): Promise<TaskDto> {
    return this.labels.addLabel(workspaceId, taskId, actorId, dto);
  }

  removeLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    labelId: string,
  ): Promise<TaskDto> {
    return this.labels.removeLabel(workspaceId, taskId, actorId, labelId);
  }

  private async findColumnOnBoard(workspaceId: string, boardId: string, columnId: string) {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, boardId, board: { workspaceId } },
    });
    if (!column) throw new NotFoundException('Column not found');
    return column;
  }
}
