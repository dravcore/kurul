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
   * It sits in the shared include rather than in either branch because both reads need it: the
   * card renders the badge and the panel renders it beside the list it loads from its own
   * endpoint (ADR 0024). Carrying attachment rows into a board list instead is what P2-8 spent
   * a task undoing, and that part of decision D2 holds.
   *
   * **What does not hold is how this compiles, and it was measured rather than assumed.** The
   * plan and an earlier version of this comment said `_count` becomes a correlated subquery.
   * Prisma 7 emits this instead:
   *
   *     LEFT JOIN (SELECT "taskId", COUNT(*) FROM "Attachment" WHERE 1=1 GROUP BY "taskId")
   *
   * — an aggregate over the **whole table**, filtered by nothing. It is not scoped to the
   * board, to the workspace, or to the 51 rows the page returns.
   *
   * Measured on the seeded 1 000-task board (`SEED_LARGE_BOARD_TASKS=1000`), Postgres 18,
   * `EXPLAIN (ANALYZE, BUFFERS)` of the first page:
   *
   * | `Attachment` rows | without `_count`     | with `_count`             |
   * | ----------------- | -------------------- | ------------------------- |
   * | 592               | 0.148 ms, 13 buffers | 0.380 ms, 21 buffers      |
   * | 100 592           | 0.070 ms, 13 buffers | 19.878 ms, 2 509 buffers  |
   *
   * The 100 000 extra rows are on tasks the first page never shows, so the payload is
   * identical — only the table behind the aggregate grew. At that size the planner switches
   * from `GroupAggregate` to `HashAggregate` over a full `Seq Scan`, and a `HashAggregate`
   * cannot stop early for the `LIMIT`.
   *
   * A plan that does not have that shape exists and is 100× cheaper: with `enable_seqscan=off`
   * the same SQL runs in **0.192 ms with 8 buffers**, streaming `Attachment_taskId_id_idx`
   * (decision D4's index) through a `GroupAggregate` that the merge join stops early. The
   * planner does not choose it because it costs the aggregate as if it had to complete.
   *
   * So this is a cost-model outcome, not an inherent one, and the remedies are a question for
   * whoever owns the read: a scoped `groupBy` over the ids the page returned (measured
   * 0.168 ms, 158 buffers), a raw `LATERAL`, or taking the count out of the list read as the
   * P3-1 plan's fallback says. None of them is done here — this comment exists so the next
   * reader does not re-derive the measurement from a sentence that was wrong.
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
