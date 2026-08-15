import type { Priority } from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';

export const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { id: 'asc' },
  },
  labels: {
    include: { label: true },
    orderBy: { id: 'asc' },
  },
  /**
   * The card's attachment badge: a number, never the rows.
   *
   * `_count` compiles to a correlated subquery, so it costs one aggregate per task and carries
   * no attachment rows into a board list — the same trade `checklistSummaryInclude` makes one
   * projection down, and the reason P2-8's board read stays cheap. It sits in the shared
   * include rather than in either branch because both reads need it: the card renders the
   * badge and the panel renders it beside the list it loads from its own endpoint (ADR 0024).
   */
  _count: { select: { attachments: true } },
} satisfies Prisma.TaskInclude;

/**
 * Checklist shape the board list needs: one boolean per item, nothing else.
 *
 * The card only shows `done/total`, and that is the whole reason this projection exists.
 * P2-8 spent a task making the board list cheap; loading full checklist rows for every card
 * on a thousand-task board would hand that back. A boolean per item is the narrowest thing
 * that can still answer the badge.
 */
const checklistSummaryInclude = {
  checklists: { select: { items: { select: { isDone: true } } } },
} satisfies Prisma.TaskInclude;

/** Checklist shape the task panel needs: the full items, in position order. */
const checklistDetailInclude = {
  checklists: {
    orderBy: { position: 'asc' },
    include: { items: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.TaskInclude;

/** Board list reads: relations plus the summary-only checklist projection. */
export const taskListInclude = { ...taskInclude, ...checklistSummaryInclude };

/** Single-task reads: relations plus the full checklists. */
export const taskDetailInclude = { ...taskInclude, ...checklistDetailInclude };

/**
 * The columns every task read shares, whichever include it used.
 *
 * Spelled out rather than derived from `Prisma.TaskGetPayload` so unit tests can build a
 * row without the client's generated payload types. `label.color` stays `string` here —
 * this is the database shape, and narrowing it to a slot is the mapper's job.
 */
export type TaskRowBase = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
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
  _count: { attachments: number };
};

/** A task row as read with `taskListInclude`: checklist items reduced to their state. */
export type TaskListRow = TaskRowBase & {
  checklists: Array<{ items: Array<{ isDone: boolean }> }>;
};

/** A task row as read with `taskDetailInclude`: the full checklists, in position order. */
export type TaskDetailRow = TaskRowBase & {
  checklists: Array<{
    id: string;
    title: string;
    position: number;
    items: Array<{ id: string; content: string; isDone: boolean; position: number }>;
  }>;
};
