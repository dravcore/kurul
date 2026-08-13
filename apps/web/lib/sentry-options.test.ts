import { describe, expect, it } from 'vitest';
import {
  buildWebSentryOptions,
  scrubWebEvent,
  webSentryOptionsFromEnv,
  type SentryWebEvent,
  type WebSentryEnv,
} from './sentry-options';

const DSN = 'https://key@o1.ingest.sentry.io/1';

function env(overrides: Partial<WebSentryEnv> = {}): WebSentryEnv {
  return {
    dsn: undefined,
    environment: undefined,
    release: undefined,
    nodeEnv: undefined,
    ...overrides,
  };
}

describe('buildWebSentryOptions', () => {
  /**
   * The load-bearing assertion. Kurultay is self-hosted: a browser that contacts Sentry
   * because the app shipped with tracking wired in — rather than because the operator turned
   * it on — is a broken promise, and `undefined` here is what lets `instrumentation-client.ts`
   * skip loading the SDK chunk entirely rather than initializing a no-op client.
   */
  it('returns undefined when no DSN was configured', () => {
    expect(buildWebSentryOptions(env())).toBeUndefined();
  });

  it.each(['', '   '])('returns undefined for a blank DSN (%p)', (dsn) => {
    expect(buildWebSentryOptions(env({ dsn }))).toBeUndefined();
  });

  it('trims the DSN so a stray newline in .env does not become a broken endpoint', () => {
    expect(buildWebSentryOptions(env({ dsn: `  ${DSN}\n` }))?.dsn).toBe(DSN);
  });

  it('never enables PII, tracing or session replay', () => {
    const options = buildWebSentryOptions(env({ dsn: DSN }));

    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.tracesSampleRate).toBe(0);
    // Session Replay would ship the rendered DOM — task titles, comments, workspace names.
    expect(options?.replaysSessionSampleRate).toBe(0);
    expect(options?.replaysOnErrorSampleRate).toBe(0);
    expect(options?.beforeSend).toBe(scrubWebEvent);
  });

  it('prefers an explicit environment over NODE_ENV, then falls back', () => {
    expect(
      buildWebSentryOptions(env({ dsn: DSN, environment: 'staging', nodeEnv: 'production' }))
        ?.environment,
    ).toBe('staging');
    expect(buildWebSentryOptions(env({ dsn: DSN, nodeEnv: 'production' }))?.environment).toBe(
      'production',
    );
    expect(buildWebSentryOptions(env({ dsn: DSN }))?.environment).toBe('development');
  });

  it('omits release entirely unless one is supplied', () => {
    expect(buildWebSentryOptions(env({ dsn: DSN }))).not.toHaveProperty('release');
    expect(buildWebSentryOptions(env({ dsn: DSN, release: '  ' }))).not.toHaveProperty('release');
    expect(buildWebSentryOptions(env({ dsn: DSN, release: 'v0.2.0' }))?.release).toBe('v0.2.0');
  });
});

/**
 * Sentry's `ErrorEvent` requires an explicit `type: undefined` (it is what distinguishes an
 * error event from a transaction one), which every literal below would otherwise repeat.
 */
function errorEvent(partial: Omit<SentryWebEvent, 'type'>): SentryWebEvent {
  return { type: undefined, ...partial };
}

describe('scrubWebEvent', () => {
  it('drops session cookies and authorization headers regardless of casing', () => {
    const event = scrubWebEvent(
      errorEvent({
        request: {
          url: 'https://kurultay.example/boards/b_1',
          headers: {
            Cookie: 'better-auth.session_token=secret',
            AUTHORIZATION: 'Bearer secret',
            'user-agent': 'Mozilla/5.0',
          },
        },
      }),
    );

    expect(event.request?.headers).toEqual({ 'user-agent': 'Mozilla/5.0' });
  });

  it('keeps the page URL but drops its query string, cookies and body', () => {
    const event = scrubWebEvent(
      errorEvent({
        request: {
          url: 'https://kurultay.example/boards/b_1?q=confidential+search',
          query_string: 'q=confidential+search',
          cookies: { 'better-auth.session_token': 'secret' },
          data: { title: 'a task title' },
        },
      }),
    );

    expect(event.request?.url).toBe('https://kurultay.example/boards/b_1');
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
  });

  it('reduces the user to an opaque id', () => {
    const event = scrubWebEvent(
      errorEvent({
        user: { id: 'u_1', email: 'someone@example.com', ip_address: '203.0.113.7' },
      }),
    );

    expect(event.user).toEqual({ id: 'u_1' });
  });

  it('leaves an event without request or user untouched', () => {
    expect(scrubWebEvent(errorEvent({ message: 'boom' }))).toEqual({
      type: undefined,
      message: 'boom',
    });
  });
});

describe('webSentryOptionsFromEnv', () => {
  /**
   * `NEXT_PUBLIC_SENTRY_DSN` is unset in this repo's `.env.example` and in CI, which is the
   * shipped default — so the reader must return `undefined` and the instrumentation entry
   * points must therefore never reach `import('@sentry/nextjs')`. If this ever starts
   * returning options, every browser loading the app starts talking to a third party.
   */
  it('reports error tracking as off with the repository default environment', () => {
    expect(process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').toBe('');
    expect(webSentryOptionsFromEnv()).toBeUndefined();
  });
});
