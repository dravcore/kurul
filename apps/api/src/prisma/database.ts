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
      // `pg`'s own default here is `0`, i.e. wait forever. Once all `max` connections are
      // checked out, a request that needs one more just queues — with no cap that queue is
      // unbounded, so a load spike stops looking like errors and starts looking like every
      // caller hanging in place (the client sees nothing until *its own* timeout, if it has
      // one, long after the operator would want to know the pool is saturated). 10s is short
      // enough that saturation surfaces as a clear, logged Postgres error instead of a silent
      // stall, and long enough that an ordinary request burst drains before tripping it.
      connectionTimeoutMillis: envInt('DATABASE_POOL_CONNECTION_TIMEOUT_MS', 10_000),
      // Sent as a Postgres startup parameter on every connection this pool opens (`pg`'s own
      // handshake, not a `SET` query this module issues), so it bounds one running statement
      // per connection, not the pool as a whole — a stuck query still occupies (and returns)
      // its connection within this window instead of holding one of the `max` slots forever.
      // Scoped to *this* pool only:
      //   - `prisma migrate deploy`/`dev` never touch it — migrations run through Prisma's own
      //     engine process against `DATABASE_URL` directly, not through `getSharedPool()`.
      //   - `apps/api/prisma/seed.ts` opens its own separate `Pool` for its bulk deletes and
      //     inserts, also untouched by this value. Only the Better Auth calls it makes
      //     (`signUpEmail`, `createOrganization`, sharing this pool via `auth.ts`) are subject
      //     to it, and those are ordinary lightweight queries nowhere near this budget.
      // Chosen as a `Pool` option rather than appending `options=-c statement_timeout=...` to
      // `DATABASE_URL`: the URL is operator-supplied and read verbatim by `prisma migrate` too
      // (see above), so rewriting it would leak this setting into a process it was never meant
      // to reach, and parsing/re-serializing a connection string the app doesn't own is its
      // own source of surprises (an existing `options=` param, unescaped edge cases). A `Pool`
      // config field applies only within this module, with no string surgery involved.
      statement_timeout: envInt('DATABASE_STATEMENT_TIMEOUT_MS', 30_000),
      // No explicit `idleTimeoutMillis` override: `pg`'s own default (30_000ms) already closes
      // connections that have sat idle in the pool for 30s, which is what keeps a quiet period
      // from holding `max` connections open against Postgres indefinitely. Nothing here was
      // broken, so there is nothing to add a knob for.
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
