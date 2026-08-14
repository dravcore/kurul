/** ioredis / BullMQ connection options, as far as `REDIS_URL` describes them. */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  /** Logical database index. Absent when the URL names none — ioredis then uses 0. */
  db?: number;
}

/**
 * The database index `REDIS_URL` asks for, or `undefined` when it names none.
 *
 * Two spellings reach here, because both are in circulation: the path segment
 * (`redis://host:6379/3`, what `redis-cli -u` and the Redis URI convention use) and a `db`
 * query parameter (`redis://host:6379?db=3`, which ioredis accepts when it parses a URL
 * itself). Supporting only one would leave the other silently dropped — the defect this
 * function exists to stop (#190).
 *
 * Everything that is not a plain non-negative integer throws instead of being coerced.
 * `Number('')` is 0 and `Number('abc')` is NaN, so a lenient reading of a typo sends the
 * whole instance to database 0 — which is precisely the silent wrong-database outcome an
 * operator who wrote an index was trying to avoid. There is no upper bound because there is
 * no fixed one: Redis's `databases` directive is configurable, so the server is the only
 * authority on whether index 42 exists, and it says so on `SELECT`.
 */
function parseDatabaseIndex(url: URL): number | undefined {
  // `new URL('redis://host')` leaves `pathname` empty (redis: is not a special scheme), and a
  // bare trailing slash carries no index either.
  const path = url.pathname.replace(/^\//, '');
  const query = url.searchParams.get('db');

  if (path !== '' && query !== null && path !== query) {
    throw new Error(
      `Invalid REDIS_URL: database index given twice and they disagree (path "${path}", query "${query}")`,
    );
  }

  const raw = path !== '' ? path : (query ?? '');
  if (raw === '') {
    return undefined;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `Invalid REDIS_URL: database index must be a non-negative integer, received "${raw}"`,
    );
  }

  return Number(raw);
}

/**
 * Parse `REDIS_URL` into ioredis / BullMQ connection options.
 *
 * Every ioredis and BullMQ construction in the API goes through here, so whatever this drops
 * is dropped process-wide — which is how the database index used to disappear (#190). Self
 * hosters point several apps at one Redis and separate them by index; that separation only
 * exists if `db` is carried through to the client, since `SELECT` is per connection and
 * cannot be applied from outside the app.
 */
export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const db = parseDatabaseIndex(url);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    // Kept even when it is 0: "the URL said 0" and "the URL said nothing" are different facts,
    // and only the first one is an instruction.
    ...(db === undefined ? {} : { db }),
  };
}
