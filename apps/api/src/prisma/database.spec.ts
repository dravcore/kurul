// The adapter is stubbed only so the real one does not reach into the mocked `pg` for its
// type parsers; this suite exercises pool lifecycle, not Prisma.
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));

// node-postgres throws when a pool is ended twice; the fake mirrors that so a regression in
// shutdown ownership fails here instead of only on a real SIGTERM.
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => {
    let ended = false;
    return {
      end: jest.fn(async () => {
        if (ended) throw new Error('Called end on pool more than once');
        ended = true;
      }),
    };
  }),
}));

type FakePool = { end: jest.Mock };

// The env vars this suite exercises, saved/restored around each test the same way
// `DATABASE_URL` already is below — several tests set one and must not leak it into the next.
const POOL_ENV_VARS = [
  'DATABASE_POOL_MAX',
  'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
  'DATABASE_STATEMENT_TIMEOUT_MS',
] as const;

describe('shared database shutdown', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://kurultay:kurultay@localhost:5432/kurultay';
    // Every pool-option test below sets a subset of these; clearing all three up front means
    // a test that forgets to clean up after itself fails at its own assertion, not two tests
    // later on an unrelated one.
    for (const name of POOL_ENV_VARS) delete process.env[name];
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    for (const name of POOL_ENV_VARS) delete process.env[name];
  });

  async function load() {
    const database = await import('./database');
    const pg = await import('pg');
    const poolConstructor = pg.Pool as unknown as jest.Mock;
    const pool = database.getSharedPool() as unknown as FakePool;
    return { database, pool, poolConstructor };
  }

  it('disconnects every registered client before ending the pool', async () => {
    const { database, pool } = await load();
    const order: string[] = [];
    pool.end.mockImplementation(async () => {
      order.push('pool.end');
    });

    database.registerPoolConsumer(async () => {
      order.push('prisma');
    });
    database.registerPoolConsumer(async () => {
      order.push('auth');
    });

    await database.closeSharedDatabase();

    expect(order).toEqual(['prisma', 'auth', 'pool.end']);
  });

  it('is harmless when both destroy hooks call it', async () => {
    const { database, pool } = await load();
    const disconnect = jest.fn(async () => {});
    database.registerPoolConsumer(disconnect);

    // PrismaService's hook, then AuthModule's — or the other way round; neither order throws.
    await database.closeSharedDatabase();
    await expect(database.closeSharedDatabase()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent shutdowns into one', async () => {
    const { database, pool } = await load();
    const disconnect = jest.fn(async () => {});
    database.registerPoolConsumer(disconnect);

    await Promise.all([database.closeSharedDatabase(), database.closeSharedDatabase()]);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('ends the pool even when a client fails to disconnect', async () => {
    const { database, pool } = await load();
    database.registerPoolConsumer(() => Promise.reject(new Error('disconnect failed')));

    await expect(database.closeSharedDatabase()).resolves.toBeUndefined();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh lifecycle when the pool is created again', async () => {
    const { database, poolConstructor } = await load();
    await database.closeSharedDatabase();

    const second = database.getSharedPool() as unknown as FakePool;
    await database.closeSharedDatabase();

    expect(poolConstructor).toHaveBeenCalledTimes(2);
    expect(second.end).toHaveBeenCalledTimes(1);
  });
});

describe('shared pool timeout configuration (DB-09)', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://kurultay:kurultay@localhost:5432/kurultay';
    for (const name of POOL_ENV_VARS) delete process.env[name];
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    for (const name of POOL_ENV_VARS) delete process.env[name];
  });

  async function loadPoolOptions() {
    const database = await import('./database');
    const pg = await import('pg');
    const poolConstructor = pg.Pool as unknown as jest.Mock;
    database.getSharedPool();
    // `new Pool(options)` — the constructor's single argument is the options object this
    // module built; asserting on it is how this suite checks the pool was actually configured
    // with a timeout, rather than merely that `getSharedPool` didn't throw.
    return poolConstructor.mock.calls[0][0] as Record<string, unknown>;
  }

  it('defaults to a bounded queue wait and a bounded statement, without capping idle time', async () => {
    const options = await loadPoolOptions();

    // 20/10s/30s: generous enough that nothing in today's normal traffic — including the
    // Better Auth calls seed.ts makes through this same pool — trips them, but finite, so pool
    // saturation and a runaway query both surface as a diagnosable error instead of a hang.
    expect(options.max).toBe(20);
    expect(options.connectionTimeoutMillis).toBe(10_000);
    expect(options.statement_timeout).toBe(30_000);
    // No override: `pg`'s own default (30s) already reclaims idle connections, so this module
    // does not set `idleTimeoutMillis` at all — asserting its absence catches a future edit
    // that adds one without also documenting why the default stopped being enough.
    expect(options.idleTimeoutMillis).toBeUndefined();
  });

  it('honors DATABASE_POOL_MAX', async () => {
    process.env.DATABASE_POOL_MAX = '5';
    const options = await loadPoolOptions();
    expect(options.max).toBe(5);
  });

  it('honors DATABASE_POOL_CONNECTION_TIMEOUT_MS', async () => {
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '2500';
    const options = await loadPoolOptions();
    expect(options.connectionTimeoutMillis).toBe(2500);
  });

  it('honors DATABASE_STATEMENT_TIMEOUT_MS', async () => {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = '5000';
    const options = await loadPoolOptions();
    expect(options.statement_timeout).toBe(5000);
  });

  it('rejects a non-integer DATABASE_STATEMENT_TIMEOUT_MS instead of silently disabling the timeout', async () => {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = 'forever';
    const database = await import('./database');
    // `envInt` throws rather than falling back — a typo here must fail loudly at boot, not
    // quietly `SET statement_timeout = NaN` (which Postgres also rejects, but only once a
    // connection is actually opened, i.e. on the first request instead of at startup).
    expect(() => database.getSharedPool()).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS/);
  });
});
