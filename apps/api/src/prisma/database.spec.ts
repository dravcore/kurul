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

describe('shared database shutdown', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://kurultay:kurultay@localhost:5432/kurultay';
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
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
