import { BadRequestException } from '@nestjs/common';
import type { Priority } from '@kurultay/shared-types';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';

/** The task columns a client can write directly — everything but position and ownership. */
interface TaskAttributes {
  title: string;
  description: string | null;
  priority?: Priority;
  dueDate: Date | null;
  estimatedMinutes: number | null;
}

/** Same columns, but every one optional: a PATCH only writes what it sent. */
type TaskPatch = Partial<TaskAttributes>;

/**
 * Turns the wire value into a `Date`.
 *
 * `@IsISO8601` already rejects malformed strings, so reaching the throw means a shape the
 * validator accepts but `Date` cannot represent — better a 400 than `Invalid Date` landing
 * in the column.
 */
function parseDueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    throw new BadRequestException('dueDate must be a valid ISO 8601 timestamp');
  }
  return due;
}

/**
 * Column values for a new task. `priority` is omitted rather than nulled when absent, so
 * the schema default applies; the rest default to empty.
 */
export function createTaskAttributes(dto: CreateTaskDto): TaskAttributes {
  return {
    title: dto.title,
    description: dto.description ?? null,
    ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
    dueDate: parseDueDate(dto.dueDate) ?? null,
    estimatedMinutes: dto.estimatedMinutes ?? null,
  };
}

/** A task as the update path needs to see it: enough to tell a real edit from a no-op. */
interface ExistingTask {
  title: string;
  description: string | null;
  priority: Priority;
  dueDate: Date | null;
  estimatedMinutes: number | null;
}

export interface TaskUpdatePlan {
  /** Columns to write — only the keys the request actually sent. */
  data: TaskPatch;
  /** The subset that differs from the stored row, as recorded on the activity entry. */
  changes: Record<string, unknown>;
}

/**
 * Splits a PATCH into what to write and what actually changed.
 *
 * The two are deliberately not the same set: a field the client re-sent unchanged is still
 * written (harmless, and keeps the write idempotent) but must not produce an activity
 * entry or a realtime event, or every panel blur would look like an edit to the whole board.
 */
export function planTaskUpdate(existing: ExistingTask, dto: UpdateTaskDto): TaskUpdatePlan {
  const dueDate = parseDueDate(dto.dueDate);

  const data: TaskPatch = {
    ...(dto.title !== undefined ? { title: dto.title } : {}),
    ...(dto.description !== undefined ? { description: dto.description } : {}),
    ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(dto.estimatedMinutes !== undefined ? { estimatedMinutes: dto.estimatedMinutes } : {}),
  };

  const changes: Record<string, unknown> = {};
  if (dto.title !== undefined && dto.title !== existing.title) {
    changes.title = dto.title;
  }
  if (dto.description !== undefined && dto.description !== existing.description) {
    changes.description = dto.description;
  }
  if (dto.priority !== undefined && dto.priority !== existing.priority) {
    changes.priority = dto.priority;
  }
  if (dueDate !== undefined) {
    // Compared as ISO strings because two `Date` objects for the same instant are not `===`.
    const previous = existing.dueDate?.toISOString() ?? null;
    const next = dueDate?.toISOString() ?? null;
    if (previous !== next) changes.dueDate = next;
  }
  if (dto.estimatedMinutes !== undefined && dto.estimatedMinutes !== existing.estimatedMinutes) {
    changes.estimatedMinutes = dto.estimatedMinutes;
  }

  return { data, changes };
}
