import { Logger } from '@nestjs/common';
import type { BetterAuthOptions } from 'better-auth';
import { Redis } from 'ioredis';
import { envString, isTestEnv } from '../common/env';
import { captureServerError } from '../common/observability/sentry';
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

/**
 * Cap on distinct keys the in-process fallback (see below) tracks at once.
 *
 * A credential-stuffing run during a Redis outage is exactly the traffic shape that would
 * otherwise grow this map without bound — one entry per distinct IP/path pair the attacker
 * rotates through. Capped, with the oldest entry evicted to make room for a new key, so the
 * fallback trades perfect accuracy for one attacker's rotated keys (an evicted key simply
 * starts a fresh window) rather than trading memory.
 */
const FALLBACK_MAX_ENTRIES = 10_000;

interface FallbackEntry {
  count: number;
  expiresAt: number;
}

/**
 * In-process counters backing {@link consumeInMemory}, keyed the same way the Redis storage
 * keys its counters (`AUTH_RATE_LIMIT_KEY_PREFIX` + the raw key Better Auth passed). Module
 * level, alongside `client`, for the same reason: one process, one degraded state, however
 * many times `createRedisRateLimitStorage` is called.
 */
const fallbackCounters = new Map<string, FallbackEntry>();

/**
 * True between a Redis failure and the next successful call — see the ERROR-level log pair
 * in `consume` below. Read by nothing else; it exists purely to tell "still down" from "just
 * went down" / "just came back" so those transitions log once each instead of once per
 * request.
 */
let degraded = false;

/**
 * In-process fixed-window counter, evaluated while Redis is unreachable. Mirrors
 * `CONSUME_SCRIPT`'s semantics on purpose — same fixed window, same "over `rule.max` blocks"
 * rule, same `retryAfter` in whole seconds — so a rule's behaviour does not visibly change
 * the moment Redis drops out from under it.
 *
 * **This is a floor, not the shared limit.** Each replica keeps its own map, so N replicas
 * behind a load balancer each enforce `rule.max` independently: the effective ceiling across
 * a fleet of N during an outage is `rule.max * N`, not `rule.max`. That is still a bounded
 * number instead of the unbounded one fail-open produced, and it is the best a per-process
 * fallback can promise without a second network dependency to be unavailable with Redis.
 *
 * Bounded memory, no timers: expired entries are only ever noticed and replaced lazily, on
 * the next `consume` call for that exact key — there is no sweep. What keeps the map's *size*
 * bounded under many distinct keys (rather than just each key's *lifetime*) is the
 * `FALLBACK_MAX_ENTRIES` eviction below, independent of expiry.
 */
function consumeInMemory(
  fallbackKey: string,
  rule: { window: number; max: number },
): { allowed: boolean; retryAfter: number | null } {
  const now = Date.now();
  const existing = fallbackCounters.get(fallbackKey);

  if (existing !== undefined && existing.expiresAt > now) {
    existing.count += 1;
    if (existing.count > rule.max) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
      };
    }
    return { allowed: true, retryAfter: null };
  }

  // Fresh window: either this key has never been seen, or its previous window expired — both
  // are "start counting from 1" the same way `INCR` on an absent key is in `CONSUME_SCRIPT`.
  if (existing === undefined && fallbackCounters.size >= FALLBACK_MAX_ENTRIES) {
    // `Map` iterates in insertion order, so the first key found is the oldest — evicted to
    // make room rather than left to grow the map past its cap.
    const oldestKey = fallbackCounters.keys().next().value;
    if (oldestKey !== undefined) {
      fallbackCounters.delete(oldestKey);
    }
  }

  fallbackCounters.set(fallbackKey, { count: 1, expiresAt: now + rule.window * 1000 });
  return { allowed: true, retryAfter: null };
}

let client: Redis | undefined;

/** Lazily opened so a process that never serves an auth request never opens the socket. */
function connection(redisUrl: string): Redis {
  if (!client) {
    const redis = new Redis({
      ...parseRedisUrl(redisUrl),
      lazyConnect: true,
      // A rate-limit check sits in front of every auth request. Queueing it across reconnect
      // attempts would make a Redis outage look like an auth outage; one retry then reject
      // lets `consume` fall back to its in-memory counter on the error path below instead of
      // blocking every request behind a connection that keeps retrying.
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
 * Test-only: drops the degraded-mode fallback state so specs do not leak counters or the
 * "already reported" transition flag into each other — mirrors `resetSentryForTesting`.
 */
export function resetAuthRateLimitFallbackForTesting(): void {
  degraded = false;
  fallbackCounters.clear();
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

        if (degraded) {
          // Recovered: the next request goes back to being counted by the shared Redis
          // counter, so the process's private view of it is not just stale but wrong —
          // dropped rather than left to seed a window a fresh `INCR` will re-open anyway.
          degraded = false;
          fallbackCounters.clear();
          logger.error('Auth rate-limit storage recovered — back to Redis-backed counters');
        }

        const [allowed, retryAfter] = result;
        return allowed === 1
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: retryAfter > 0 ? retryAfter : rule.window };
      } catch (error) {
        // Degraded, not fail-open: Redis being unreachable no longer means every request is
        // allowed. Each process keeps its own bounded, in-memory counter for exactly the
        // rule Redis would have enforced (see `consumeInMemory`) — a floor, not the shared
        // limit multi-replica deployments get from Redis, but a floor is what stands between
        // an outage and unthrottled credential stuffing, and pure fail-open left nothing there
        // at all (audit finding SEC-03).
        //
        // Reported once per transition, not once per request: an outage lasting the length of
        // a Redis restart must not turn into one log line — and, since this is an operational
        // failure rather than a single request's — one Sentry event (`captureServerError` is a
        // no-op unless `SENTRY_DSN` is set) per blocked sign-in attempt in between.
        if (!degraded) {
          degraded = true;
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            `Auth rate-limit storage unavailable — falling back to a per-process in-memory limit until Redis recovers: ${message}`,
          );
          captureServerError(error, { path: 'auth-rate-limit.consume' });
        }
        return consumeInMemory(key(raw), rule);
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
