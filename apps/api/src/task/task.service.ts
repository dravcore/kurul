import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivityType, SocketEvents } from '@kurultay/shared-types';
import type { CursorPage, TaskDto } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { assertBoard } from '../common/board-access';
import { toCursorPage } from '../common/pagination/cursor-page';
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
import { countAttachments, countAttachmentsByTask } from './attachment-count';
import { createTaskAttributes, planTaskUpdate } from './task-fields';
import { TaskAssigneeService } from './task-assignee.service';
import {
  taskDetailInclude,
  taskListInclude,
  type TaskDetailRow,
  type TaskListRow,
} from './task.include';
import { TaskLabelService } from './task-label.service';
import { buildListWhere } from './task-query-where';
import { TaskReadService } from './task-read.service';
import { emptyTaskRelations, toTaskDetailDto, toTaskListDto } from './task.mapper';

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly assignees: TaskAssigneeService,
    private readonly labels: TaskLabelService,
    private readonly taskRead: TaskReadService,
  ) {}

  async list(
    workspaceId: string,
    boardId: string,
    query: TaskQueryDto,
  ): Promise<CursorPage<TaskDto>> {
    await assertBoard(this.prisma, workspaceId, boardId);

    const where = buildListWhere(boardId, query);
    const limit = query.limit ?? 50;

    const found = await this.prisma.task.findMany({
      where,
      // The list include, not the detail one: a board page reads up to `limit` tasks at once,
      // and the card only needs `done/total` from their checklists.
      include: taskListInclude,
      // Cursor walks by immutable id (api-conventions); display sort is the client's job.
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    // Second statement, scoped to the ids this page returned — never an `include`. The full
    // measurement is in `attachment-count.ts`; the short version is that Prisma's `_count`
    // aggregates the entire `Attachment` table on every board read, and at 100 000 rows that
    // is 19.878 ms against 0.168 ms for this.
    const counts = await countAttachmentsByTask(
      this.prisma,
      found.map((task) => task.id),
    );
    const rows: TaskListRow[] = found.map((task) => ({
      ...task,
      attachmentCount: counts.get(task.id) ?? 0,
    }));

    return toCursorPage(rows, limit, (task) => toTaskListDto(task));
  }

  async create(
    workspaceId: string,
    boardId: string,
    userId: string,
    dto: CreateTaskDto,
  ): Promise<TaskDto> {
    await assertBoard(this.prisma, workspaceId, boardId);
    const column = await this.findColumnOnBoard(workspaceId, boardId, dto.columnId);
    const attributes = createTaskAttributes(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock before reading siblings so concurrent creates/moves into the same gap cannot
      // both compute the same midpoint from a shared snapshot.
      await tx.$executeRaw`SELECT id FROM "Column" WHERE id = ${column.id} FOR UPDATE`;

      // Only the ordering math reads these rows, and it reads two columns of them. Selecting
      // the whole task instead drags every title, description and timestamp in the column
      // across the wire on a create that will use none of it.
      const siblings = await tx.task.findMany({
        where: { columnId: column.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });

      // `afterTaskId` is the client's word for "insert after this task", which in position
      // order makes that task the new row's `prev` — the DTO name is translated here, once.
      const { insertionIndex, prev, next } = resolveCreateNeighbors(
        siblings,
        dto.afterTaskId,
        'Task not found',
      );
      const prevPos = prev?.position ?? null;
      const nextPos = next?.position ?? null;

      let position: number;

      if (needsRebalance(prevPos, nextPos)) {
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
        position = midpoint(prevPos, nextPos);
      }

      const created: Omit<
        TaskDetailRow,
        'assignees' | 'labels' | 'checklists' | 'attachmentCount'
      > = await tx.task.create({
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

      return toTaskDetailDto(emptyTaskRelations(created));
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
    return toTaskDetailDto(await this.taskRead.findTask(workspaceId, taskId));
  }

  async update(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    const existing = await this.taskRead.findTask(workspaceId, taskId);
    const { data, changes } = planTaskUpdate(existing, dto);

    // A PATCH that re-sends what is already stored is not an edit. Writing it anyway moved
    // `updatedAt` forward, which is the field "last activity" sorting and staleness checks
    // read — so closing a detail panel without typing anything used to look like work. The
    // activity entry and the socket event were already suppressed for this case; the write
    // was the one thing still leaking. The row was read under the workspace predicate, so
    // returning it needs no further check.
    if (Object.keys(changes).length === 0) {
      return toTaskDetailDto(existing);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: the row could have been deleted, or moved out of
      // the workspace, between the read above and the write.
      const scoped = await tx.task.findFirst({
        where: { id: taskId, board: { workspaceId } },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Task not found');

      // The write predicate repeats the tenant scope: the check above only proves the row was
      // in the workspace when it ran, the predicate is what the database enforces.
      const updated = await tx.task.update({
        where: { id: taskId, board: { workspaceId } },
        data,
        include: taskDetailInclude,
      });

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

      return toTaskDetailDto({
        ...updated,
        attachmentCount: await countAttachments(tx, taskId),
      });
    });

    this.realtime.emitToBoard(result.boardId, SocketEvents.TASK_UPDATED, {
      workspaceId,
      boardId: result.boardId,
      actorId: userId,
      taskId: result.id,
    });
    return result;
  }

  async remove(workspaceId: string, taskId: string, userId: string): Promise<void> {
    const task = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the row can be
      // deleted, or moved to another workspace, before the delete runs.
      const row = await tx.task.findFirst({
        where: { id: taskId, board: { workspaceId } },
        select: { id: true, title: true, columnId: true, boardId: true },
      });
      if (!row) throw new NotFoundException('Task not found');

      // Activity.task onDelete SetNull — prior rows keep workspace history; stub carries payload.
      await this.activityService.record(tx, {
        workspaceId,
        taskId: null,
        userId,
        type: ActivityType.TaskDeleted,
        payload: {
          taskId: row.id,
          title: row.title,
          columnId: row.columnId,
          boardId: row.boardId,
        },
      });

      // deleteMany, not delete: only deleteMany accepts a relation predicate, so the tenant
      // scope travels with the write instead of resting on the read above.
      const { count } = await tx.task.deleteMany({
        where: { id: taskId, board: { workspaceId } },
      });
      // Cross-workspace access is 404, never 403 (docs/api-conventions.md) — a 403 would
      // confirm the row exists. Throwing rolls the activity stub back with it.
      if (count === 0) throw new NotFoundException('Task not found');

      return row;
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
        include: taskDetailInclude,
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

      // Lock the target column before reading siblings so two concurrent moves into the same
      // gap cannot both compute the same midpoint from a shared snapshot. Matches the board
      // row lock used when seeding default columns.
      await tx.$executeRaw`SELECT id FROM "Column" WHERE id = ${targetColumn.id} FOR UPDATE`;

      // Two columns, as on create: the moved task itself is read in full above, and these rows
      // only ever contribute an id and a position to the rebalance.
      const siblings = await tx.task.findMany({
        where: { columnId: targetColumn.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      const remaining = siblings.filter((item) => item.id !== taskId);
      // On a move the DTO fields line up with position order: `beforeTaskId` is the task that
      // ends up before the moved one (`prev`), `afterTaskId` the one that ends up after
      // (`next`). Note `afterTaskId` means the opposite of what it means on create — the
      // client contract, not the ordering math, is where that ambiguity lives.
      const { insertionIndex, prev, next } = resolveMoveNeighbors(
        remaining,
        dto.beforeTaskId,
        dto.afterTaskId,
      );

      // Counted once, after the checks that can still reject the move and before either branch
      // builds a DTO. A move never touches attachments, so both branches share this number
      // rather than asking the same question twice.
      const attachmentCount = await countAttachments(tx, taskId);
      let result: TaskDto;

      if (needsRebalance(prev?.position ?? null, next?.position ?? null)) {
        // The moved row joins its new siblings as the same two columns they are: `reordered`
        // exists to hand `rebalancePositions` a length and to pair each id with its new slot.
        const reordered = [...remaining];
        reordered.splice(insertionIndex, 0, { id: task.id, position: task.position });
        const positions = rebalancePositions(reordered.length);
        const otherUpdates = reordered
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.id !== taskId)
          .map(({ item, index }) => ({ id: item.id, position: positions[index]! }));

        // Sequential, not `Promise.all`: an interactive transaction is one connection, so the
        // two writes queue behind each other regardless. Racing them bought no parallelism and
        // cost the ability to say which statement failed and what the transaction had already
        // applied when it did.
        //
        // Scoped predicate on the write too — the transaction-local read above proves the task
        // was in the workspace, the predicate is what the database enforces.
        await tx.task.update({
          where: { id: taskId, board: { workspaceId } },
          data: {
            position: positions[insertionIndex]!,
            columnId: targetColumn.id,
          },
        });
        await batchUpdateTaskPositions(tx, targetColumn.id, otherUpdates);
        result = toTaskDetailDto({
          ...task,
          attachmentCount,
          columnId: targetColumn.id,
          position: positions[insertionIndex]!,
          updatedAt: new Date(),
        });
      } else {
        const updated = await tx.task.update({
          where: { id: taskId, board: { workspaceId } },
          data: {
            columnId: targetColumn.id,
            position: midpoint(prev?.position ?? null, next?.position ?? null),
          },
          include: taskDetailInclude,
        });
        result = toTaskDetailDto({ ...updated, attachmentCount });
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
          // Snapshotted next to the name, and for the same reason: the activity log records
          // what the move meant when it happened. Throughput falls back to this when the
          // target column no longer exists to be looked up — see
          // `DashboardService.countCompletedMovesByDay`.
          toColumnCategory: targetColumn.category,
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
