import { Logger } from '@nestjs/common';
import type { BetterAuthOptions } from 'better-auth';
import { Redis } from 'ioredis';
import { envString, isTestEnv } from '../common/env';
import { rateLimitEnabled, RATE_LIMIT_WINDOW_SECONDS } from '../common/rate-limit/rate-limit';
import { parseRedisUrl } from '../common/redis-url';

type AuthRateLimitOptions = NonNullable<BetterAuthOptions['rateLimit']>;
type AuthRateLimitStorage = NonNullable<AuthRateLimitOptions['customStorage']>;

const logger = new Logger('AuthRateLimit');

/** Ceiling for an ordinary Better Auth endpoint, per client IP and path. */
export const AUTH_RATE_LIMIT_MAX = 100;

/** Namespace so the counters cannot collide with the Socket.io adapter or the BullMQ queue. */
export const AUTH_RATE_LIMIT_KEY_PREFIX = 'kurul:auth-rate-limit:';

/**
 * Fixed-window counter, evaluated in one round trip so the check and the increment cannot be
 * interleaved — N simultaneous sign-in attempts can no longer all read the same stale count
 * before any of them writes.
 *
 * `INCR` creates the key at 1 with no expiry, so the `ttl < 0` branch is what opens the
 * window. It doubles as a repair: a key that somehow outlived its TTL (a failed `EXPIRE`, a
 * restore from an RDB snapshot) gets one, instead of pinning a client at "over the limit"
 * forever.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if count > tonumber(ARGV[2]) then
  return {0, ttl}
end
return {1, -1}
`;

let client: Redis | undefined;

/** Lazily opened so a process that never serves an auth request never opens the socket. */
function connection(redisUrl: string): Redis {
  if (!client) {
    const redis = new Redis({
      ...parseRedisUrl(redisUrl),
      lazyConnect: true,
      // A rate-limit check sits in front of every auth request. Queueing it across reconnect
      // attempts would make a Redis outage look like an auth outage; one retry then reject
      // lets `consume` fall open on the error path below.
      maxRetriesPerRequest: 1,
    });
    // ioredis emits `error` on every failed reconnect, and an EventEmitter with no `error`
    // listener turns the first one into an uncaught exception that takes the API down.
    redis.on('error', (error: Error) => {
      logger.debug(`Auth rate-limit Redis error: ${error.message}`);
    });
    client = redis;
  }

  return client;
}

/** Releases the rate-limit connection; called from `AuthModule`'s destroy hook. */
export async function closeAuthRateLimitStorage(): Promise<void> {
  const redis = client;
  client = undefined;
  await redis?.quit().catch(() => undefined);
}

/**
 * Redis-backed storage for Better Auth's rate limiter.
 *
 * Deliberately `customStorage` rather than the `secondaryStorage` route: Better Auth's
 * secondary storage is *also* its session store, so wiring one would move sessions out of
 * Postgres and make a Redis outage log everybody out. `customStorage` is scoped to the rate
 * limiter and nothing else, which is the only part this change is about.
 */
export function createRedisRateLimitStorage(redisUrl: string): AuthRateLimitStorage {
  const key = (raw: string): string => `${AUTH_RATE_LIMIT_KEY_PREFIX}${raw}`;

  return {
    // Better Auth only calls `get`/`set` when the storage has no `consume` (see its
    // `legacyConsume` fallback). Both are implemented because the interface requires them,
    // and both read the same counter `consume` writes so they cannot drift.
    get: async (raw) => {
      const stored = await connection(redisUrl).get(key(raw));
      if (stored === null) {
        return null;
      }
      const count = Number(stored);
      return Number.isFinite(count) ? { key: raw, count, lastRequest: Date.now() } : null;
    },
    set: async (raw, value) => {
      await connection(redisUrl).set(key(raw), value.count, 'EX', RATE_LIMIT_WINDOW_SECONDS);
    },
    consume: async (raw, rule) => {
      try {
        const result = (await connection(redisUrl).eval(
          CONSUME_SCRIPT,
          1,
          key(raw),
          rule.window,
          rule.max,
        )) as [number, number];
        const [allowed, retryAfter] = result;
        return allowed === 1
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: retryAfter > 0 ? retryAfter : rule.window };
      } catch (error) {
        // Fail open. Rate limiting is defence in depth here — Better Auth still requires a
        // correct password, and the Nest throttler still covers the rest of the API — so a
        // Redis blip must not turn into "nobody can sign in".
        logger.warn(
          `Auth rate-limit storage unavailable, allowing request: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { allowed: true, retryAfter: null };
      }
    },
  };
}

/**
 * Better Auth's `rateLimit` block.
 *
 * Better Auth mounts on raw Express, outside the Nest router (ADR 0004), so the global
 * `ThrottlerGuard` never sees `/auth/*` — this is the only thing standing between the API and
 * an unthrottled credential-stuffing loop. Upstream enables its limiter in production only
 * and keeps the counters in process memory; both are made explicit here.
 *
 * No `customRules`: Better Auth already ships stricter built-in rules for the paths that
 * matter (`/sign-in*`, `/sign-up*`, `/change-password`, `/change-email` at 3 per 10s;
 * `/forget-password*`, `/request-password-reset`, `/send-verification-email` at 3 per 60s),
 * and overriding them here could only loosen them.
 */
export function authRateLimitOptions(): AuthRateLimitOptions {
  const enabled = rateLimitEnabled();
  const base: AuthRateLimitOptions = {
    enabled,
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: AUTH_RATE_LIMIT_MAX,
  };

  if (!enabled) {
    return base;
  }

  // Jest runs many suites in parallel in one process tree and never tears this client down;
  // the in-memory store is correct there, as it is for a single-instance deployment.
  if (isTestEnv()) {
    return base;
  }

  const redisUrl = envString('REDIS_URL', '');
  if (redisUrl === '') {
    // Kurul runs without Redis by design (see `HealthService`), so this is a supported
    // configuration, not an error: Better Auth's in-memory store still limits this instance.
    logger.warn(
      'REDIS_URL unset — auth rate-limit counters stay in memory (per instance, lost on restart)',
    );
    return base;
  }

  return { ...base, customStorage: createRedisRateLimitStorage(redisUrl) };
}
