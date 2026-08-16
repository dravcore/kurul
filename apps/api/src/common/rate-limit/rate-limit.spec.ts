import type { ExecutionContext } from '@nestjs/common';
import { seconds } from '@nestjs/throttler';
import {
  DEFAULT_RATE_LIMIT,
  INVITATION_RATE_LIMIT,
  RATE_LIMIT_ERROR_MESSAGE,
  RATE_LIMIT_WINDOW_SECONDS,
  rateLimitEnabled,
  TASK_SEARCH_RATE_LIMIT,
  taskListRateLimit,
  throttlerOptions,
} from './rate-limit';

/** Minimal ExecutionContext carrying only the query string the resolver reads. */
function contextWithQuery(query: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext;
}

describe('rate limit policy', () => {
  const originalEnabled = process.env.RATE_LIMIT_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.RATE_LIMIT_ENABLED;
    } else {
      process.env.RATE_LIMIT_ENABLED = originalEnabled;
    }
  });

  describe('rateLimitEnabled', () => {
    it('is on when nothing is configured', () => {
      delete process.env.RATE_LIMIT_ENABLED;

      expect(rateLimitEnabled()).toBe(true);
    });

    it('is off only when explicitly disabled', () => {
      process.env.RATE_LIMIT_ENABLED = 'false';

      expect(rateLimitEnabled()).toBe(false);
    });
  });

  describe('throttlerOptions', () => {
    it('gives every route a one-minute default budget', () => {
      delete process.env.RATE_LIMIT_ENABLED;

      const options = throttlerOptions();

      expect(options).toMatchObject({
        throttlers: [
          { name: 'default', ttl: seconds(RATE_LIMIT_WINDOW_SECONDS), limit: DEFAULT_RATE_LIMIT },
        ],
        errorMessage: RATE_LIMIT_ERROR_MESSAGE,
      });
    });

    it('reads the master switch once, at configuration time', () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      const options = throttlerOptions();

      // Flipping the variable afterwards must not resurrect the limits mid-process: a
      // per-request read would turn a boot-time setting into a runtime toggle.
      process.env.RATE_LIMIT_ENABLED = 'true';

      expect(options).not.toBeInstanceOf(Array);
      expect(!Array.isArray(options) && options.skipIf?.({} as ExecutionContext)).toBe(true);
    });
  });

  describe('taskListRateLimit', () => {
    it('applies the search ceiling when ?q= carries a term', () => {
      expect(taskListRateLimit(contextWithQuery({ q: 'invoice' }))).toBe(TASK_SEARCH_RATE_LIMIT);
    });

    it('applies the search ceiling when ?q= is repeated', () => {
      expect(taskListRateLimit(contextWithQuery({ q: ['a', 'b'] }))).toBe(TASK_SEARCH_RATE_LIMIT);
    });

    it('leaves ordinary board paging on the default ceiling', () => {
      expect(taskListRateLimit(contextWithQuery({ limit: '50' }))).toBe(DEFAULT_RATE_LIMIT);
    });

    it('treats a blank ?q= as no search — it never reaches the trigram scan', () => {
      expect(taskListRateLimit(contextWithQuery({ q: '   ' }))).toBe(DEFAULT_RATE_LIMIT);
    });
  });

  describe('policy numbers', () => {
    it('keeps the expensive endpoints below the API default', () => {
      expect(INVITATION_RATE_LIMIT).toBeLessThan(DEFAULT_RATE_LIMIT);
      expect(TASK_SEARCH_RATE_LIMIT).toBeLessThan(DEFAULT_RATE_LIMIT);
    });

    it('reads as an API message rather than an exception class name', () => {
      expect(RATE_LIMIT_ERROR_MESSAGE).toBe('Too many requests. Please try again later.');
    });
  });
});
