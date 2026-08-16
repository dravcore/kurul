import type {
  ChecklistDto,
  ChecklistSummaryDto,
  LabelDto,
  TaskAssigneeDto,
  TaskDto,
} from '@kurul/shared-types';
import { toLabelColorSlot } from '../common/label-color';
import type { TaskDetailRow, TaskListRow, TaskRowBase } from './task.include';

/**
 * Pure row → DTO mapping, and nothing else: no Prisma access, no exceptions, no side
 * effects. Reads live in `task-read.service.ts`, the realtime broadcast in
 * `task-events.service.ts`, and the P2002 translation in `prisma-unique-violation.ts`.
 */
function toTaskCore(row: TaskRowBase): Omit<TaskDto, 'checklistSummary' | 'checklists'> {
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
    attachmentCount: row.attachmentCount,
  };
}

/**
 * `done`/`total` across every checklist on the task, counted rather than stored.
 *
 * Takes the narrowest row either include produces — an array of `{ isDone }` — so the list
 * read and the detail read compute the badge from the same function and cannot disagree
 * about it.
 */
export function summarizeChecklists(
  checklists: Array<{ items: Array<{ isDone: boolean }> }>,
): ChecklistSummaryDto {
  let total = 0;
  let done = 0;
  for (const list of checklists) {
    for (const item of list.items) {
      total += 1;
      if (item.isDone) done += 1;
    }
  }
  return { total, done };
}

/**
 * Board list mapping. `checklists` is `null`, not `[]`: the list read did not fetch them, and
 * an empty array would claim the task has none.
 */
export function toTaskListDto(row: TaskListRow): TaskDto {
  return {
    ...toTaskCore(row),
    checklistSummary: summarizeChecklists(row.checklists),
    checklists: null,
  };
}

/** Single-task mapping: the full checklists, plus the same summary the card reads. */
export function toTaskDetailDto(row: TaskDetailRow): TaskDto {
  const checklists: ChecklistDto[] = row.checklists.map((list) => ({
    id: list.id,
    title: list.title,
    position: list.position,
    items: list.items.map((item) => ({
      id: item.id,
      content: item.content,
      isDone: item.isDone,
      position: item.position,
    })),
  }));
  return {
    ...toTaskCore(row),
    checklistSummary: summarizeChecklists(row.checklists),
    checklists,
  };
}

/**
 * A task that was just created, mapped without a second read.
 *
 * A fresh task has no assignees, no labels, no checklists and no attachments, so the relations
 * and the count are supplied rather than fetched — but they are supplied as the *detail* shape,
 * because the caller of a create wants the same DTO a single-task read would give them. The
 * count is `0` rather than a query: a row that was created one statement ago has nothing
 * pointing at it.
 */
export function emptyTaskRelations<
  T extends Omit<TaskDetailRow, 'assignees' | 'labels' | 'checklists' | 'attachmentCount'>,
>(row: T): TaskDetailRow {
  return {
    ...row,
    assignees: [],
    labels: [],
    checklists: [],
    attachmentCount: 0,
  };
}
