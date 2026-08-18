import { Logger } from '@nestjs/common';
import {
  AUTH_RATE_LIMIT_KEY_PREFIX,
  AUTH_RATE_LIMIT_MAX,
  authRateLimitOptions,
  createRedisRateLimitStorage,
  resetAuthRateLimitFallbackForTesting,
} from './auth-rate-limit';
import * as sentry from '../common/observability/sentry';
import { RATE_LIMIT_WINDOW_SECONDS } from '../common/rate-limit/rate-limit';

const evalMock = jest.fn();
const getMock = jest.fn();
const setMock = jest.fn();

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    eval: (...args: unknown[]) => evalMock(...args) as unknown,
    get: (...args: unknown[]) => getMock(...args) as unknown,
    set: (...args: unknown[]) => setMock(...args) as unknown,
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
}));

describe('authRateLimitOptions', () => {
  const original = {
    enabled: process.env.RATE_LIMIT_ENABLED,
    redisUrl: process.env.REDIS_URL,
    nodeEnv: process.env.NODE_ENV,
    jestWorker: process.env.JEST_WORKER_ID,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // `authRateLimitOptions` refuses to open a socket under Jest, which is exactly what the
    // non-test branches need to be observable — so the test-env markers come off here and are
    // put back in `afterEach`.
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [
      ['RATE_LIMIT_ENABLED', original.enabled],
      ['REDIS_URL', original.redisUrl],
      ['NODE_ENV', original.nodeEnv],
      ['JEST_WORKER_ID', original.jestWorker],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('turns Better Auth rate limiting on explicitly, rather than leaving it to the production-only default', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.REDIS_URL;

    expect(authRateLimitOptions()).toEqual({
      enabled: true,
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: AUTH_RATE_LIMIT_MAX,
    });
  });

  it('keeps the counters in Redis when one is configured', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';

    const options = authRateLimitOptions();

    expect(options).toMatchObject({
      enabled: true,
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: AUTH_RATE_LIMIT_MAX,
    });
    // `consume` is the atomic primitive Better Auth prefers; without it the limiter silently
    // degrades to a non-atomic check-then-increment that concurrent requests can slip past.
    expect(typeof options.customStorage?.consume).toBe('function');
  });

  it('never reaches for secondary storage — that would move sessions out of Postgres', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';

    expect(authRateLimitOptions()).not.toHaveProperty('storage');
  });

  it('falls back to the in-memory store, with a warning, when Redis is not configured', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.REDIS_URL;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const options = authRateLimitOptions();

    expect(options.customStorage).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL unset'));
  });

  it('follows the same master switch as the Nest throttler', () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    process.env.REDIS_URL = 'redis://localhost:6379';

    const options = authRateLimitOptions();

    expect(options.enabled).toBe(false);
    expect(options.customStorage).toBeUndefined();
  });
});

describe('createRedisRateLimitStorage', () => {
  const storage = createRedisRateLimitStorage('redis://localhost:6379');
  const rule = { window: RATE_LIMIT_WINDOW_SECONDS, max: 5 };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(sentry, 'captureServerError').mockReturnValue(false);
    // Every `describe.each` and every plain `it` below shares the module-level fallback
    // state (`degraded`, the counters map) with every other one — the same reason
    // `createRedisRateLimitStorage` keeps a single Redis `client` module-wide. Reset it
    // before each test so "already reported" and stale counts from a previous test cannot
    // leak into the next one's assertions.
    resetAuthRateLimitFallbackForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetAuthRateLimitFallbackForTesting();
  });

  it('namespaces its keys so they cannot collide with the Socket.io adapter or BullMQ', async () => {
    evalMock.mockResolvedValue([1, -1]);

    await storage.consume?.('127.0.0.1-/sign-in/email', rule);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      `${AUTH_RATE_LIMIT_KEY_PREFIX}127.0.0.1-/sign-in/email`,
      rule.window,
      rule.max,
    );
  });

  it('allows a request that lands inside the window', async () => {
    evalMock.mockResolvedValue([1, -1]);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it('reports how long the caller has to wait once the window is full', async () => {
    evalMock.mockResolvedValue([0, 42]);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: false,
      retryAfter: 42,
    });
  });

  it('falls back to the whole window when Redis reports no usable TTL', async () => {
    evalMock.mockResolvedValue([0, -1]);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: false,
      retryAfter: rule.window,
    });
  });

  it('degrades to an in-memory limit when Redis is unreachable, rather than allowing every request', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Still allowed: a single request is inside the fallback's own window too.
    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    expect(sentry.captureServerError).toHaveBeenCalledTimes(1);
  });

  it('blocks past the limit under the fallback — an outage no longer means unlimited attempts', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    for (let i = 0; i < rule.max; i++) {
      await expect(storage.consume?.('flood', rule)).resolves.toMatchObject({ allowed: true });
    }

    await expect(storage.consume?.('flood', rule)).resolves.toMatchObject({
      allowed: false,
      retryAfter: expect.any(Number),
    });
  });

  it('tracks distinct keys separately under the fallback', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    for (let i = 0; i < rule.max; i++) {
      await storage.consume?.('a', rule);
    }
    // "a" is now at the limit; "b" has never been consumed and must not inherit its count.
    await expect(storage.consume?.('a', rule)).resolves.toMatchObject({ allowed: false });
    await expect(storage.consume?.('b', rule)).resolves.toMatchObject({ allowed: true });
  });

  it("frees a blocked key's fallback window once it expires", async () => {
    jest.useFakeTimers();
    try {
      evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let i = 0; i < rule.max; i++) {
        await storage.consume?.('expiring', rule);
      }
      await expect(storage.consume?.('expiring', rule)).resolves.toMatchObject({
        allowed: false,
      });

      jest.advanceTimersByTime((rule.window + 1) * 1000);

      await expect(storage.consume?.('expiring', rule)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps the fallback at a bounded number of distinct keys instead of growing without limit', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    // A single request per key is enough to prove the point at max: 1 — the second request
    // for a still-tracked key is blocked, a fresh one is allowed.
    const capRule = { window: RATE_LIMIT_WINDOW_SECONDS, max: 1 };
    const overCap = 10_001;

    await storage.consume?.('key-0', capRule);
    for (let i = 1; i < overCap; i++) {
      await storage.consume?.(`key-${i}`, capRule);
    }

    // If `key-0` were still tracked, this second request for it would be blocked (count 2 >
    // max 1). It is allowed instead, which is only possible if it was evicted to make room —
    // proof the map did not grow past its cap under `overCap` distinct keys.
    await expect(storage.consume?.('key-0', capRule)).resolves.toMatchObject({ allowed: true });
  }, 30_000);

  it('goes back to Redis once it answers again, and logs the recovery once', async () => {
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await storage.consume?.('key', rule);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));

    evalMock.mockResolvedValue([1, -1]);
    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('recovered'));
  });

  it('does not log or report a repeat outage once already degraded — no per-request spam', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await storage.consume?.('key', rule);
    await storage.consume?.('key', rule);
    await storage.consume?.('key', rule);

    expect(error).toHaveBeenCalledTimes(1);
    expect(sentry.captureServerError).toHaveBeenCalledTimes(1);
  });

  it('reads back the counter `consume` writes', async () => {
    getMock.mockResolvedValue('7');

    await expect(storage.get('key')).resolves.toMatchObject({ key: 'key', count: 7 });
    expect(getMock).toHaveBeenCalledWith(`${AUTH_RATE_LIMIT_KEY_PREFIX}key`);
  });

  it('reports an unknown key as absent rather than as a zero count', async () => {
    getMock.mockResolvedValue(null);

    await expect(storage.get('key')).resolves.toBeNull();
  });

  it('writes with an expiry, so a counter can never outlive its window', async () => {
    setMock.mockResolvedValue('OK');

    await storage.set('key', { key: 'key', count: 3, lastRequest: Date.now() });

    expect(setMock).toHaveBeenCalledWith(
      `${AUTH_RATE_LIMIT_KEY_PREFIX}key`,
      3,
      'EX',
      RATE_LIMIT_WINDOW_SECONDS,
    );
  });
});
