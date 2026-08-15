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
  /*
    There is deliberately no `_count: { select: { attachments: true } }` here, and it is not an
    omission — it was here, it was measured, and it came out.

    Prisma 7 compiles that include into an aggregate over the **whole** `Attachment` table
    (`... WHERE 1=1 GROUP BY "taskId"`, joined afterwards), scoped to no board, no workspace and
    no page. On the seeded 1 000-task board the first page went from 0.070 ms / 13 buffers to
    19.878 ms / 2 509 once the table held 100 000 rows — rows belonging to tasks that page never
    returns. The card's badge is a number either way; what grew was a scan nobody asked for.

    The badge now reads `attachmentCount`, filled by `countAttachmentsByTask` from the ids the
    page actually returned. The full numbers, the plan the planner declines to pick, and why an
    index alone does not fix it are in `attachment-count.ts` — read that before putting `_count`
    back, because it reads like the simpler option and is not.
  */
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
 *
 * `attachmentCount` is the one field on this type that no include produces: it is attached by
 * the caller from `countAttachmentsByTask`, for the reason written above and in
 * `attachment-count.ts`. Keeping it on the row rather than threading it through the mapper's
 * signature means the read that knows the page is the read that scopes the count, and every
 * `toTaskDetailDto` call site stays as it was.
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
  attachmentCount: number;
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
