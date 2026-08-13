import { Logger } from '@nestjs/common';
import {
  AUTH_RATE_LIMIT_KEY_PREFIX,
  AUTH_RATE_LIMIT_MAX,
  authRateLimitOptions,
  createRedisRateLimitStorage,
} from './auth-rate-limit';
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('fails open when Redis is unreachable, so an outage cannot lock everyone out of sign-in', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
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
