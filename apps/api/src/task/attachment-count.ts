import type { Prisma } from '../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';

export type AttachmentCountDb = PrismaService | Prisma.TransactionClient;

/**
 * How many attachments a set of tasks has, scoped to exactly those tasks.
 *
 * This exists because Prisma's `_count` in an `include` does not do what it reads like it
 * does, and the difference is a board-list regression that grows with the instance rather
 * than with the page. `include: { _count: { select: { attachments: true } } }` compiles to
 *
 *     LEFT JOIN (SELECT "taskId", COUNT(*) FROM "Attachment" WHERE 1=1 GROUP BY "taskId")
 *
 * — an aggregate over the **whole table**, filtered by nothing: not by board, not by
 * workspace, not by the rows the page returns. Measured on the seeded 1 000-task board
 * (`SEED_LARGE_BOARD_TASKS=1000`, Postgres 18, `EXPLAIN (ANALYZE, BUFFERS)` of the first
 * page), with the extra attachment rows deliberately placed on tasks that page never shows:
 *
 * | `Attachment` rows | no count             | `_count` include          | this function        |
 * | ----------------- | -------------------- | ------------------------- | -------------------- |
 * | 592               | 0.148 ms, 13 buffers | 0.380 ms, 21 buffers      | —                    |
 * | 100 592           | 0.070 ms, 13 buffers | 19.878 ms, 2 509 buffers  | 0.168 ms, 158 buffers |
 *
 * At 100 000 rows the `_count` include costs **19.878 ms and 2 509 shared buffers** against
 * **0.168 ms and 158** here, for the identical answer — because the planner switches to a
 * `HashAggregate` over a full `Seq Scan`, and a `HashAggregate` cannot stop early for the
 * `LIMIT`. That is the board read P2-8 spent a task making cheap, handed back.
 *
 * **The index was never the problem, and this is the part worth reading before "simplifying"
 * this back to `_count`.** A plan that streams `Attachment_taskId_id_idx` (ADR 0024 decision
 * D4's index) through a `GroupAggregate` the merge join stops early exists and runs the very
 * same SQL in 0.192 ms with 8 buffers — `SET enable_seqscan = off` produces it. The planner
 * does not pick it because it prices the unfiltered aggregate as if it had to complete. An
 * `IN` list of the page's ids removes the choice: there is nothing to scan but the matching
 * index entries.
 *
 * The cost is one extra round trip. Against 19.7 ms it is noise, and `TaskDto.attachmentCount`
 * is unchanged — same number, different way of arriving at it.
 */
export async function countAttachmentsByTask(
  db: AttachmentCountDb,
  taskIds: string[],
): Promise<Map<string, number>> {
  // An empty page would otherwise send `IN ()`, which is a round trip whose answer is known.
  if (taskIds.length === 0) return new Map();

  const groups = await db.attachment.groupBy({
    by: ['taskId'],
    where: { taskId: { in: taskIds } },
    _count: { _all: true },
  });

  return new Map(groups.map((group) => [group.taskId, group._count._all]));
}

/**
 * The same count for one task. A task with none is `0`, never `null` — `attachmentCount` is a
 * number on the DTO and "none" is a real answer, not a missing one.
 */
export function countAttachments(db: AttachmentCountDb, taskId: string): Promise<number> {
  return db.attachment.count({ where: { taskId } });
}
