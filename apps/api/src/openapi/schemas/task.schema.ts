import type {
  ChecklistDto,
  ChecklistItemDto,
  ChecklistSummaryDto,
  CursorPage,
  Priority,
  TaskAssigneeDto,
  TaskDto,
} from '@kurultay/shared-types';
import { LabelSchema } from './board.schema';

/** One person assigned to a task. */
export class TaskAssigneeSchema implements TaskAssigneeDto {
  userId!: string;
  name!: string;
  avatarUrl!: string | null;
}

/** One item of a checklist. */
export class ChecklistItemSchema implements ChecklistItemDto {
  id!: string;
  content!: string;
  isDone!: boolean;
  /** Fractional index within the checklist. */
  position!: number;
}

/** A named checklist on a task. */
export class ChecklistSchema implements ChecklistDto {
  id!: string;
  title!: string;
  /** Fractional index within the task. */
  position!: number;
  items!: ChecklistItemSchema[];
}

/** The board card's progress badge. Counted at read time, never stored. */
export class ChecklistSummarySchema implements ChecklistSummaryDto {
  total!: number;
  done!: number;
}

/** A task. */
export class TaskSchema implements TaskDto {
  id!: string;
  boardId!: string;
  columnId!: string;
  title!: string;
  description!: string | null;
  priority!: Priority;
  /**
   * Fractional index within the column — a `Float`, never an integer and never contiguous.
   *
   * Rewritten on every drag-and-drop. It decides where a card *appears*; the page boundary is
   * decided by `id`.
   */
  position!: number;
  /** ISO 8601 UTC, or `null`. A date-only value is still a full timestamp at `T00:00:00.000Z`. */
  dueDate!: string | null;
  /** Integer minutes. Separate from `dueDate` — effort is not a deadline. */
  estimatedMinutes!: number | null;
  createdById!: string;
  createdAt!: string;
  updatedAt!: string;
  assignees!: TaskAssigneeSchema[];
  labels!: LabelSchema[];
  checklistSummary!: ChecklistSummarySchema;
  /** Full checklists on a single-task read; `null` on list reads, which load only the summary. */
  checklists!: ChecklistSchema[] | null;
  /** A count, not a list: the card needs the number and the panel reads the list separately. */
  attachmentCount!: number;
}

/**
 * One page of tasks.
 *
 * Walked by `id` regardless of the display order. `position` is rewritten by every drag, so a
 * cursor keyed on it would silently drop any row someone moved past the client's window.
 */
export class TaskPageSchema implements CursorPage<TaskDto> {
  items!: TaskSchema[];
  /** The `id` of the last item — pass as `?cursor=`. `null` on the last page. */
  nextCursor!: string | null;
  hasMore!: boolean;
}
