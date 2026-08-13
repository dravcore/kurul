/**
 * Proves the DB-09 fix against a real Postgres instead of only a mocked `pg` (see
 * `src/prisma/database.spec.ts` for the unit-level coverage of which options `getSharedPool`
 * passes to `new Pool(...)`): with the pool capped at one connection, a second concurrent
 * query has nothing to acquire and must queue. Before `connectionTimeoutMillis` existed, that
 * queue had no ceiling — this test is the regression guard for that specific failure mode, not
 * just for the option being wired through.
 *
 * Deliberately bypasses `createTestApp()` — this suite is about the shared `pg` pool itself,
 * not the Nest app built on top of it, and each e2e spec file gets its own Jest module
 * registry, so importing `../src/prisma/database` fresh here cannot collide with the pool any
 * other spec file's `createTestApp()` call creates.
 */
describe('Shared pool connection-timeout enforcement (e2e)', () => {
  const originalMax = process.env.DATABASE_POOL_MAX;
  const originalConnectionTimeout = process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS;

  afterEach(async () => {
    if (originalMax === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = originalMax;
    if (originalConnectionTimeout === undefined) {
      delete process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS;
    } else {
      process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = originalConnectionTimeout;
    }

    const database = await import('../src/prisma/database');
    await database.closeSharedDatabase();
  });

  it(
    'rejects a queued query once DATABASE_POOL_CONNECTION_TIMEOUT_MS elapses, instead of ' +
      'waiting for the busy connection to free up',
    async () => {
      process.env.DATABASE_POOL_MAX = '1';
      process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '300';
      jest.resetModules();
      const database = await import('../src/prisma/database');
      const pool = database.getSharedPool();

      // Holds the pool's one and only connection for far longer than the 300ms timeout below,
      // so the second query has nothing to acquire and is forced into the pending queue.
      const holder = pool.query('SELECT pg_sleep(2)');
      // A query that fails inside `Promise.all` still leaves the other member unhandled until
      // that member also settles — attach a no-op catch so Jest does not also flag the
      // deliberately-slow holder as an unhandled rejection if something upstream goes wrong.
      holder.catch(() => {});

      const start = Date.now();
      await expect(pool.query('SELECT 1')).rejects.toThrow(/timeout/i);
      const elapsed = Date.now() - start;

      // Bounded near the configured 300ms, not "eventually, once `pg_sleep(2)` finishes 2s
      // later" — 1500ms is generous scheduler slack while staying far short of that 2000ms, so
      // this fails if `connectionTimeoutMillis` silently stops being wired through.
      expect(elapsed).toBeLessThan(1500);

      // Let the holder finish on its own before `afterEach` ends the pool, so shutdown does
      // not have to wait out the remainder of the two-second sleep itself.
      await holder;
    },
    5_000,
  );
});
