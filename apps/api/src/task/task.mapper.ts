import type { LabelDto, TaskAssigneeDto, TaskDto } from '@kurultay/shared-types';
import { toLabelColorSlot } from '../common/label-color';
import type { TaskWithRelations } from './task.include';

/**
 * Pure row → DTO mapping, and nothing else: no Prisma access, no exceptions, no side
 * effects. Reads live in `task-read.service.ts`, the realtime broadcast in
 * `task-events.service.ts`, and the P2002 translation in `prisma-unique-violation.ts`.
 */
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
