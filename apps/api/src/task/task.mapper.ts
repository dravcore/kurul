import { NotFoundException } from '@nestjs/common';
import { SocketEvents } from '@kurultay/shared-types';
import type { LabelDto, TaskAssigneeDto, TaskDto } from '@kurultay/shared-types';
import { toLabelColorSlot } from '../common/label-color';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { taskInclude, type TaskWithRelations } from './task.include';

export function toTaskDto(row: TaskWithRelations): TaskDto {
  const assignees: TaskAssigneeDto[] = row.assignees.map((entry) => ({
    userId: entry.user.id,
    name: entry.user.name,
    avatarUrl: entry.user.avatarUrl,
  }));
  const labels: LabelDto[] = row.labels.map((entry) => ({
    id: entry.label.id,
    boardId: entry.label.boardId,
    name: entry.label.name,
    color: toLabelColorSlot(entry.label.color),
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

export function emptyTaskRelations<T extends Omit<TaskWithRelations, 'assignees' | 'labels'>>(
  row: T,
): TaskWithRelations {
  return { ...row, assignees: [], labels: [] };
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}

export async function findTask(
  prisma: PrismaService,
  workspaceId: string,
  taskId: string,
): Promise<TaskWithRelations> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, board: { workspaceId } },
    include: taskInclude,
  });
  if (!task) throw new NotFoundException('Task not found');
  return task;
}

/**
 * Lightweight existence/ownership check that skips the assignees/labels relations —
 * use this for pre-mutation reads where only id/title/boardId are needed, and reserve
 * `findTask` for the single read that builds the response DTO.
 */
export async function findTaskBasic(
  prisma: PrismaService,
  workspaceId: string,
  taskId: string,
): Promise<{ id: string; title: string; boardId: string }> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, board: { workspaceId } },
    select: { id: true, title: true, boardId: true },
  });
  if (!task) throw new NotFoundException('Task not found');
  return task;
}

export function emitTaskUpdated(
  realtime: RealtimeService,
  workspaceId: string,
  actorId: string,
  task: TaskWithRelations,
): TaskDto {
  const dto = toTaskDto(task);
  realtime.emitToBoard(dto.boardId, SocketEvents.TASK_UPDATED, {
    workspaceId,
    boardId: dto.boardId,
    actorId,
    taskId: dto.id,
  });
  return dto;
}
