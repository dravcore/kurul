import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { envInt } from '../common/env';

/** Disconnect callback for a client that borrows connections from the shared pool. */
type PoolConsumer = () => Promise<void>;

let pool: Pool | undefined;
let closing: Promise<void> | undefined;
const consumers = new Set<PoolConsumer>();

function requireDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  return connectionString;
}

/** Process-wide `pg` pool shared by Nest PrismaService and Better Auth. */
export function getSharedPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(),
      // Unbounded pools risk exhausting Postgres `max_connections` under load; 20 is a
      // sensible default for a single API instance, override per-environment as needed.
      max: envInt('DATABASE_POOL_MAX', 20),
    });
    // A freshly created pool starts a new lifecycle, so a previous shutdown no longer
    // applies. Without this reset a process that re-creates the pool (tests) would see
    // `closeSharedDatabase` resolve immediately against the old, already-settled shutdown.
    closing = undefined;
  }
  return pool;
}

export function createSharedPrismaAdapter(): PrismaPg {
  return new PrismaPg(getSharedPool());
}

/**
 * Registers a client that borrows from the shared pool so that `closeSharedDatabase` can
 * disconnect it before the pool goes away.
 *
 * This module is the single owner of the pool's lifecycle. Callers do not disconnect their
 * own client at shutdown — Nest gives no ordering guarantee between `onModuleDestroy` hooks,
 * and a client disconnecting after the pool has ended throws "Called end on pool more than
 * once" / "cannot use a pool after calling end".
 */
export function registerPoolConsumer(disconnect: PoolConsumer): void {
  consumers.add(disconnect);
}

/**
 * Disconnects every registered client, then ends the shared pool.
 *
 * Idempotent and concurrency-safe: the first caller owns the shutdown and every later or
 * parallel caller awaits that same promise, so it does not matter whether `AuthModule` or
 * `PrismaService` gets its destroy hook first — both call this, the first one drains
 * everything and the second is a no-op.
 */
export async function closeSharedDatabase(): Promise<void> {
  closing ??= (async () => {
    const pending = [...consumers];
    consumers.clear();
    // `allSettled`: a client that fails to disconnect must not strand the pool open.
    await Promise.allSettled(pending.map((disconnect) => disconnect()));
    // Clear the handle before ending so a caller racing in cannot reach the dying pool.
    const current = pool;
    pool = undefined;
    await current?.end();
  })();
  await closing;
}
