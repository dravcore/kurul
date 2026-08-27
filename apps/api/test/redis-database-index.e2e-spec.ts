import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import {
  AUTH_RATE_LIMIT_KEY_PREFIX,
  closeAuthRateLimitStorage,
  createRedisRateLimitStorage,
} from '../src/auth/auth-rate-limit';
import { parseRedisUrl } from '../src/common/redis-url';
import { RedisHealthClient } from '../src/health/redis-health.client';
import { DueSoonWorker } from '../src/notification/due-soon.worker';
import type { NotificationService } from '../src/notification/notification.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import type { RealtimeService } from '../src/realtime/realtime.service';

/**
 * `REDIS_URL`'s database index, end to end (#190).
 *
 * The bug this guards was invisible to a unit test on purpose: `parseRedisUrl` dropped the
 * URL's pathname, so an instance told to use `redis://host:6379/3` opened every connection on
 * database 0 and said nothing about it. A spec that asserts the parser's *return value* would
 * have caught nothing before the fix and proves nothing after it — the parser is one of five
 * places the value has to survive.
 *
 * So every assertion here is made against a live Redis, from outside the connection under
 * test: either the server's own `CLIENT LIST` (which reports the database each connection
 * `SELECT`ed) or an independent observer client opened on a known index. The three consumers
 * are exercised through the production classes that own them — auth rate limiting, the
 * BullMQ due-soon queue, the Socket.io adapter — plus the readiness probe, rather than
 * through a copy of their connection code.
 *
 * Reverting `parseRedisUrl` turns all four red: every connection lands on database 0, so the
 * rate-limit key appears under the observer watching 0, the queue's keys never show up under
 * the one watching 3, and `CLIENT LIST` reports `db=0` for the new sockets.
 */

/** The index this spec claims. Arbitrary, but it must not be 0 — that is the failure value. */
const TEST_DB = 3;

const BASE_URL = process.env.REDIS_URL?.trim() ?? '';

/** `BASE_URL` pointed at {@link TEST_DB}, whatever host/port/password the environment uses. */
function urlWithDb(db: number): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${db}`;
  return url.toString();
}

function observerFor(db: number): Redis {
  return new Redis({ ...parseRedisUrl(BASE_URL), db, lazyConnect: true, maxRetriesPerRequest: 1 });
}

/** `CLIENT LIST` rows, reduced to the two fields this spec cares about. */
async function clientList(observer: Redis): Promise<{ id: number; db: number }[]> {
  const raw = (await observer.client('LIST')) as string;
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => ({
      id: Number(/(?:^|\s)id=(\d+)/.exec(line)?.[1] ?? -1),
      db: Number(/(?:^|\s)db=(\d+)/.exec(line)?.[1] ?? -1),
    }));
}

/**
 * Connection ids are monotonic per server, so "every row with an id above this one" is exactly
 * the set of connections opened after the call — no name or address matching needed, and no
 * assumption that this suite is the only client of the Redis it was given.
 */
async function highestClientId(observer: Redis): Promise<number> {
  return Math.max(...(await clientList(observer)).map((row) => row.id));
}

async function databasesOfClientsAfter(observer: Redis, sinceId: number): Promise<number[]> {
  const rows = await clientList(observer);
  return rows.filter((row) => row.id > sinceId && row.id !== -1).map((row) => row.db);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for Redis state');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Without a Redis there is nothing to measure, and the API supports running with none
 * (`docs/testing.md`), so a developer's `pnpm test:e2e` must not fail for want of one. CI
 * always sets `REDIS_URL`, which is where this spec is a gate. The warning is deliberate: a
 * silently skipped file reads like a passing one.
 */
const describeWithRedis = BASE_URL === '' ? describe.skip : describe;
if (BASE_URL === '') {
  console.warn(
    '[redis-database-index] REDIS_URL is unset — skipping. The #190 database-index guard did NOT run.',
  );
}

describeWithRedis('REDIS_URL database index (e2e)', () => {
  let onTestDb: Redis;
  let onDbZero: Redis;
  let savedRedisUrl: string | undefined;

  beforeAll(async () => {
    onTestDb = observerFor(TEST_DB);
    onDbZero = observerFor(0);
    await Promise.all([onTestDb.connect(), onDbZero.connect()]);
    savedRedisUrl = process.env.REDIS_URL;
    // The queue, the adapter and the readiness probe all read the environment themselves.
    process.env.REDIS_URL = urlWithDb(TEST_DB);
  });

  afterAll(async () => {
    if (savedRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = savedRedisUrl;
    }
    await closeAuthRateLimitStorage();
    await Promise.all([onTestDb?.quit(), onDbZero?.quit()]);
  });

  it('sanity-checks that the two observers really are on different databases', async () => {
    const key = `kurul:190:observer-check:${Date.now()}`;
    await onTestDb.set(key, 'x', 'EX', 30);
    expect(await onTestDb.get(key)).toBe('x');
    expect(await onDbZero.get(key)).toBeNull();
    await onTestDb.del(key);
  });

  /**
   * Auth rate limiting. The storage is handed the URL directly, so this is the shortest path
   * from `REDIS_URL` to a key, and the key is asserted where it must be *and* where it must
   * not be — "present on 3" alone would still pass if the write had also gone to 0.
   */
  it('writes auth rate-limit counters to the database the URL names', async () => {
    const probe = `190-probe-${Date.now()}`;
    const key = `${AUTH_RATE_LIMIT_KEY_PREFIX}${probe}`;
    const storage = createRedisRateLimitStorage(urlWithDb(TEST_DB));

    // `consume` is the storage's only operation as of better-auth 1.7, and the counter it
    // increments is the same key the removed `set` used to write, so this still exercises the
    // shortest path from `REDIS_URL` to a key. One consume of a fresh key leaves it at 1.
    await storage.consume(probe, { window: 60, max: 10 });

    expect(await onTestDb.get(key)).toBe('1');
    expect(await onDbZero.get(key)).toBeNull();

    await onTestDb.del(key);
    await closeAuthRateLimitStorage();
  });

  /**
   * BullMQ. Registering the job scheduler writes `bull:due-soon:*` keys; those are the queue's
   * whole identity, so where they land is where two instances either share a queue or do not.
   *
   * Database 0 is checked by *difference* rather than by emptiness: CI runs this suite against
   * one Redis in which every other spec file's `createTestApp()` has already registered the
   * same queue on database 0. What must be true is that this worker added nothing there.
   */
  it('registers the due-soon queue in the database the URL names', async () => {
    const prisma = { task: { findMany: async () => [] } } as unknown as PrismaService;
    const notifications = { emitUnreadChanged: () => {} } as unknown as NotificationService;
    const worker = new DueSoonWorker(prisma, notifications);

    const zeroBefore = (await onDbZero.keys('bull:due-soon:*')).sort();

    try {
      await worker.onModuleInit();
      await waitFor(async () => (await onTestDb.keys('bull:due-soon:*')).length > 0);

      const onThree = await onTestDb.keys('bull:due-soon:*');
      expect(onThree).toContain('bull:due-soon:repeat:due-soon-scan');
      expect((await onDbZero.keys('bull:due-soon:*')).sort()).toEqual(zeroBefore);
    } finally {
      await worker.onApplicationShutdown();
      const created = await onTestDb.keys('bull:due-soon:*');
      if (created.length > 0) await onTestDb.del(...created);
    }
  }, 20_000);

  /**
   * The readiness probe and the Socket.io adapter own connections but write no keys of their
   * own, so they are measured the only way that is left: by asking the server which database
   * the sockets they opened are sitting on.
   */
  it('opens the readiness probe connection on the database the URL names', async () => {
    const since = await highestClientId(onDbZero);
    const probe = new RedisHealthClient();

    try {
      await probe.ping();
      const databases = await databasesOfClientsAfter(onDbZero, since);
      expect(databases.length).toBeGreaterThan(0);
      expect(databases).not.toContain(0);
      expect(new Set(databases)).toEqual(new Set([TEST_DB]));
    } finally {
      await probe.onApplicationShutdown();
    }
  }, 20_000);

  it('opens both Socket.io adapter connections on the database the URL names', async () => {
    const adapters: unknown[] = [];
    // `use` as well as `adapter`: `afterInit` registers the handshake-auth middleware on the
    // server before it attaches the adapter, and this fake stands in for a real one.
    const server = {
      adapter: (factory: unknown) => adapters.push(factory),
      use: () => {},
    } as unknown as Server;
    const gateway = new RealtimeGateway(
      {} as unknown as PrismaService,
      { attachServer: () => {} } as unknown as RealtimeService,
    );

    // `attachRedisAdapter` refuses to open a socket under Jest — a unit test that never tears
    // one down would hang the run. This spec does tear it down, and the connection path is the
    // thing under test, so the guard is lifted for the duration of the call and put back.
    const savedWorkerId = process.env.JEST_WORKER_ID;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    delete process.env.NODE_ENV;

    const since = await highestClientId(onDbZero);
    try {
      gateway.afterInit(server);
      // pub and sub: the adapter duplicates its client, and the duplicate has to inherit the
      // index as well — a `duplicate()` that lost it would leave half the fan-out elsewhere.
      await waitFor(async () => (await databasesOfClientsAfter(onDbZero, since)).length >= 2);

      const databases = await databasesOfClientsAfter(onDbZero, since);
      expect(adapters).toHaveLength(1);
      // At least two, not exactly two: the assertion that carries the weight is the set below —
      // *every* connection opened during this test is on the requested index — and that one is
      // not weakened by an extra socket appearing (a reconnect, a client this suite does not
      // own). Pinning the count instead would fail on a stray connection that is on database 3,
      // which is the outcome this test exists to see.
      expect(databases.length).toBeGreaterThanOrEqual(2);
      expect(new Set(databases)).toEqual(new Set([TEST_DB]));
    } finally {
      if (savedWorkerId !== undefined) process.env.JEST_WORKER_ID = savedWorkerId;
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
      await gateway.onApplicationShutdown();
    }
  }, 20_000);

  /**
   * The limit of what an index buys, measured rather than assumed: Redis pub/sub is not
   * scoped by database, so the Socket.io fan-out channel is shared by every consumer of the
   * server no matter which index each one selected. Keyspaces (rate-limit counters, BullMQ)
   * are separated; channels are not. Documented here because the opposite is the natural
   * assumption, and `e2e/stack-env.ts` used to record it as one.
   */
  it('does not isolate pub/sub channels, only keyspaces', async () => {
    const subscriber = new Redis({ ...parseRedisUrl(urlWithDb(TEST_DB)) });
    const publisher = new Redis({ ...parseRedisUrl(urlWithDb(0)) });
    const channel = `kurul:190:channel:${Date.now()}`;

    try {
      const delivered = new Promise<string>((resolve) => {
        subscriber.on('message', (_channel, payload: string) => resolve(payload));
      });
      await subscriber.subscribe(channel);
      await waitFor(async () => (await publisher.publish(channel, 'crosses-databases')) > 0);

      await expect(delivered).resolves.toBe('crosses-databases');
    } finally {
      await Promise.all([subscriber.quit(), publisher.quit()]);
    }
  });

  /**
   * #204: `parseRedisUrl` used to drop `url.username`, so a URL naming a Redis 6+ ACL user
   * authenticated as `default` instead. Proven by reverting the fix and running just this
   * test: the connection does not fail (this server's `default` is `nopass`, the Compose
   * default, so an unauthenticated session is already `default` with full permissions), it
   * silently succeeds as the wrong user, `ACL WHOAMI` returns `"default"` where the assertion
   * below expects the ACL username, and the test goes red on that mismatch, not on a thrown
   * connection error.
   */
  it('authenticates as the ACL user REDIS_URL names, not default', async () => {
    const username = `kurul-204-${Date.now()}`;
    const password = 'acl-check-pw';
    await onDbZero.acl('SETUSER', username, 'on', `>${password}`, '~*', '+@all');

    try {
      const url = new URL(urlWithDb(TEST_DB));
      url.username = username;
      url.password = password;
      const client = new Redis({
        ...parseRedisUrl(url.toString()),
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });

      try {
        await client.connect();
        await expect(client.acl('WHOAMI')).resolves.toBe(username);
      } finally {
        await client.quit();
      }
    } finally {
      await onDbZero.acl('DELUSER', username);
    }
  });
});
