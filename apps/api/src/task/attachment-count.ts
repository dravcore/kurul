import type { Prisma } from '../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';

export type AttachmentCountDb = PrismaService | Prisma.TransactionClient;

/**
 * How many attachments a set of tasks has, scoped to exactly those tasks.
 *
 * `TaskDto.attachmentCount` used to come from `include: { _count: { select: { attachments:
 * true } } }`. The reason it does not any more is narrower than it first looked, and the
 * honest version of it is worth the paragraphs, because the first version of this comment
 * carried a number that does not reproduce.
 *
 * **What is a fact about the SQL, not about a plan:** Prisma compiles that include into
 *
 *     LEFT JOIN (SELECT "taskId", COUNT(*) FROM "Attachment" WHERE 1=1 GROUP BY "taskId")
 *
 * — an aggregate over the whole table, filtered by nothing: not by board, not by workspace,
 * not by the 51 rows the page returns. It is only cheap when the planner picks a merge join
 * whose `GroupAggregate` the `LIMIT` can stop early, so the cost of a board page depends on a
 * plan choice rather than on the page.
 *
 * **What was measured** — Postgres 18 in Docker on an Apple-silicon laptop, seeded 1 000-task
 * board, `EXPLAIN (ANALYZE, BUFFERS)` of the first page, both statements verbatim as emitted:
 *
 * | dataset                                          | `_count` include        | this function          |
 * | ------------------------------------------------ | ----------------------- | ---------------------- |
 * | 181 710 rows over 108 320 tasks (realistic)      | 0.118 ms, 10 buffers    | 0.078 ms, 5 buffers    |
 * | 150 601 rows over ~800 tasks (skewed)            | 0.089 ms, 8 buffers     | 0.062 ms, 4 buffers    |
 * | 1 151 401 rows over ~800 tasks (extreme skew)    | 0.095 ms, 4 buffers     | 40.126 ms, parallel scan |
 * | 100 592 rows, one build, not reproduced since    | 19.878 ms, 2 509 buffers | —                     |
 *
 * Read that table honestly. On realistic data both shapes are sub-millisecond and the
 * difference between them is noise — and this function pays a second round trip the include
 * does not, so end to end it is *not* the cheaper of the two there. The 19.878 ms row is one
 * observation, on one build of the database, where the planner chose `HashAggregate` over a
 * full `Seq Scan` and then had to `Sort` for the merge join; the identical script has not
 * produced it since. The extreme-skew row is the mirror image, and this function is the one
 * that loses it: 800 tasks holding a million rows makes the planner estimate ~71 000 matches
 * for 51 ids and switch to a parallel `Seq Scan`. Neither of those distributions is what an
 * instance looks like.
 *
 * **So the case for this function is not "it is faster".** It is that its cost is bounded by
 * the page (`Index Cond: taskId = ANY(...)` over `Attachment_taskId_id_idx`, ADR 0024's D4
 * index) for every distribution a real instance has, while the include's cost is bounded by
 * the table and depends on a plan choice that was observed to flip once. That is a smaller
 * claim than the one this comment used to make, and it is the one the evidence supports.
 *
 * If someone measures the include holding its plan across the distributions that matter, going
 * back to it is a defensible one-commit change — it is one statement instead of two, and
 * `TaskDto.attachmentCount` never moved either way. What is not defensible is doing it
 * because the include *reads* simpler, without measuring.
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
