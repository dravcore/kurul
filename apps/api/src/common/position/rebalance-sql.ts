import type { Prisma } from '../../generated/prisma';
import type { PrismaService } from '../../prisma/prisma.service';

export type RebalanceDb = PrismaService | Prisma.TransactionClient;

export type PositionUpdate = { id: string; position: number };

/**
 * Bulk-writes rebalanced task positions in a single round trip instead of one
 * UPDATE per sibling. Scoped by `columnId` so a stale id can never touch another column.
 */
export async function batchUpdateTaskPositions(
  db: RebalanceDb,
  columnId: string,
  updates: PositionUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  const ids = updates.map((update) => update.id);
  const positions = updates.map((update) => update.position);
  await db.$executeRaw`
    UPDATE "Task" AS t
    SET position = v.position
    FROM unnest(${ids}::text[], ${positions}::float8[]) AS v(id, position)
    WHERE t.id = v.id AND t."columnId" = ${columnId}
  `;
}

/**
 * Bulk-writes rebalanced column positions in a single round trip instead of one
 * UPDATE per sibling. Scoped by `boardId` so a stale id can never touch another board.
 */
export async function batchUpdateColumnPositions(
  db: RebalanceDb,
  boardId: string,
  updates: PositionUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  const ids = updates.map((update) => update.id);
  const positions = updates.map((update) => update.position);
  await db.$executeRaw`
    UPDATE "Column" AS c
    SET position = v.position
    FROM unnest(${ids}::text[], ${positions}::float8[]) AS v(id, position)
    WHERE c.id = v.id AND c."boardId" = ${boardId}
  `;
}
