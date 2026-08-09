import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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
    pool = new Pool({ connectionString: requireDatabaseUrl() });
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
