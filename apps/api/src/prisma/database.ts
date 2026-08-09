import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { envInt } from '../common/env';

let pool: Pool | undefined;
let ending: Promise<void> | undefined;

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
  }
  return pool;
}

export function createSharedPrismaAdapter(): PrismaPg {
  return new PrismaPg(getSharedPool());
}

/** Idempotent pool shutdown after all Prisma clients have disconnected. */
export async function endSharedPool(): Promise<void> {
  if (ending) {
    await ending;
    return;
  }
  if (!pool) {
    return;
  }

  ending = (async () => {
    await pool?.end();
    pool = undefined;
  })();

  try {
    await ending;
  } finally {
    ending = undefined;
  }
}
