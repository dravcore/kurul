import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The SDK is replaced wholesale so these tests can assert it is never *used*, and so that a
 * regression which starts initializing Sentry unconditionally fails here instead of quietly
 * opening a connection to sentry.io from every self-hosted install.
 *
 * `vi.hoisted` because `vi.mock` is lifted above the imports, so the spies have to exist
 * before the module factory runs.
 */
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentry);

describe('server instrumentation (no DSN configured — the shipped default)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('register() initializes nothing', async () => {
    const { register } = await import('./instrumentation');

    await expect(register()).resolves.toBeUndefined();

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('onRequestError() reports nothing and does not throw', async () => {
    const { onRequestError } = await import('./instrumentation');

    await onRequestError(
      new Error('render failed'),
      { path: '/boards/b_1', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/boards/[boardId]',
        routeType: 'render',
        revalidateReason: undefined,
      },
    );

    expect(sentry.captureRequestError).not.toHaveBeenCalled();
  });
});

describe('client instrumentation (no DSN configured — the shipped default)', () => {
  it('does not initialize Sentry when the module is loaded', async () => {
    vi.clearAllMocks();

    // Importing the module *is* the behaviour under test: it runs its top-level side effect.
    await import('./instrumentation-client');
    // The guarded path would be an unawaited dynamic import, so give a microtask turn before
    // concluding nothing happened.
    await Promise.resolve();

    expect(sentry.init).not.toHaveBeenCalled();
  });
});
