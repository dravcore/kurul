import {
  captureServerError,
  flushSentry,
  initSentry,
  isSentryEnabled,
  resetSentryForTesting,
  scrubEvent,
  sentryOptionsFromEnv,
  type SentryLoader,
} from './sentry';

type SentryApi = typeof import('@sentry/node');

interface FakeScope {
  setTag: jest.Mock;
  setContext: jest.Mock;
}

/**
 * A stand-in for `@sentry/node` that records what the SDK would have been asked to do.
 *
 * The real package is deliberately never imported by this spec: the whole point of the
 * module under test is that the SDK is reachable only through the injected loader, and a
 * spec that imported it would stop being able to tell whether production code did too.
 */
function createFakeSentry(): {
  api: SentryApi;
  init: jest.Mock;
  captureException: jest.Mock;
  close: jest.Mock;
  scope: FakeScope;
} {
  const scope: FakeScope = { setTag: jest.fn(), setContext: jest.fn() };
  const init = jest.fn();
  const captureException = jest.fn();
  const close = jest.fn(() => Promise.resolve(true));
  const withScope = jest.fn((callback: (s: FakeScope) => void) => {
    callback(scope);
  });

  return {
    api: { init, captureException, close, withScope } as unknown as SentryApi,
    init,
    captureException,
    close,
    scope,
  };
}

describe('sentryOptionsFromEnv', () => {
  it('returns undefined when SENTRY_DSN is absent', () => {
    expect(sentryOptionsFromEnv({})).toBeUndefined();
  });

  it.each(['', '   '])('returns undefined when SENTRY_DSN is blank (%p)', (dsn) => {
    expect(sentryOptionsFromEnv({ SENTRY_DSN: dsn })).toBeUndefined();
  });

  it('builds options from the DSN, trimming stray whitespace', () => {
    const options = sentryOptionsFromEnv({ SENTRY_DSN: '  https://k@o.ingest.sentry.io/1  ' });

    expect(options?.dsn).toBe('https://k@o.ingest.sentry.io/1');
  });

  it('never enables the SDK PII switch and never samples traces', () => {
    const options = sentryOptionsFromEnv({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' });

    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.tracesSampleRate).toBe(0);
    expect(options?.beforeSend).toBe(scrubEvent);
  });

  it('prefers SENTRY_ENVIRONMENT over NODE_ENV so staging and prod are distinguishable', () => {
    const options = sentryOptionsFromEnv({
      SENTRY_DSN: 'https://k@o.ingest.sentry.io/1',
      SENTRY_ENVIRONMENT: 'staging',
      NODE_ENV: 'production',
    });

    expect(options?.environment).toBe('staging');
  });

  it('falls back to NODE_ENV, then to development', () => {
    const dsn = 'https://k@o.ingest.sentry.io/1';

    expect(sentryOptionsFromEnv({ SENTRY_DSN: dsn, NODE_ENV: 'production' })?.environment).toBe(
      'production',
    );
    expect(sentryOptionsFromEnv({ SENTRY_DSN: dsn })?.environment).toBe('development');
  });

  it('leaves release unset unless one is supplied', () => {
    const dsn = 'https://k@o.ingest.sentry.io/1';

    expect(sentryOptionsFromEnv({ SENTRY_DSN: dsn })?.release).toBeUndefined();
    expect(
      sentryOptionsFromEnv({ SENTRY_DSN: dsn, SENTRY_RELEASE: '  ' })?.release,
    ).toBeUndefined();
    expect(sentryOptionsFromEnv({ SENTRY_DSN: dsn, SENTRY_RELEASE: 'v0.2.0' })?.release).toBe(
      'v0.2.0',
    );
  });
});

describe('scrubEvent', () => {
  it('drops session cookies and authorization headers, whatever their casing', () => {
    const event = scrubEvent({
      request: {
        method: 'POST',
        url: '/workspaces/w_1/tasks',
        headers: {
          Cookie: 'better-auth.session_token=secret',
          AUTHORIZATION: 'Bearer secret',
          'proxy-authorization': 'Basic secret',
          'set-cookie': 'better-auth.session_token=secret',
          'user-agent': 'Mozilla/5.0',
          'content-type': 'application/json',
        },
      },
    });

    expect(event.request?.headers).toEqual({
      'user-agent': 'Mozilla/5.0',
      'content-type': 'application/json',
    });
  });

  it('drops cookies, request bodies and query strings', () => {
    const event = scrubEvent({
      request: {
        url: '/workspaces/w_1/tasks',
        query_string: 'q=confidential+search',
        cookies: { 'better-auth.session_token': 'secret' },
        data: { title: 'Task title nobody agreed to share' },
      },
    });

    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    // The route itself is what makes the event useful, so it survives.
    expect(event.request?.url).toBe('/workspaces/w_1/tasks');
  });

  it('reduces the user to an opaque id — never email, name or IP', () => {
    const event = scrubEvent({
      user: {
        id: '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d',
        email: 'someone@example.com',
        username: 'someone',
        ip_address: '203.0.113.7',
      },
    });

    expect(event.user).toEqual({ id: '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d' });
  });

  it('empties the user entirely when there is no id to keep', () => {
    expect(scrubEvent({ user: { email: 'someone@example.com' } }).user).toEqual({});
  });

  it('leaves an event with neither request nor user untouched', () => {
    expect(scrubEvent({ message: 'boom' })).toEqual({ message: 'boom' });
  });
});

describe('initSentry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SENTRY_DSN;
    resetSentryForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSentryForTesting();
  });

  /**
   * The single most important assertion in this file. Kurultay is self-hosted; an install
   * that loads a telemetry SDK nobody configured — even one that then sends nothing — is a
   * broken promise. Asserting on the *loader* rather than on `init` is what makes this a
   * real guarantee: it proves `@sentry/node` is never even required.
   */
  it('does not load the SDK at all when SENTRY_DSN is unset', async () => {
    const load = jest.fn<ReturnType<SentryLoader>, []>();

    await expect(initSentry(load)).resolves.toBe(false);

    expect(load).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('does not load the SDK when SENTRY_DSN is present but blank', async () => {
    process.env.SENTRY_DSN = '  ';
    const load = jest.fn<ReturnType<SentryLoader>, []>();

    await expect(initSentry(load)).resolves.toBe(false);

    expect(load).not.toHaveBeenCalled();
  });

  it('initializes the SDK with the environment-derived options when a DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
    process.env.SENTRY_ENVIRONMENT = 'production';
    process.env.SENTRY_RELEASE = 'v0.2.0';
    const fake = createFakeSentry();

    await expect(initSentry(() => Promise.resolve(fake.api))).resolves.toBe(true);

    expect(fake.init).toHaveBeenCalledTimes(1);
    expect(fake.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@o.ingest.sentry.io/1',
        environment: 'production',
        release: 'v0.2.0',
        sendDefaultPii: false,
        tracesSampleRate: 0,
      }),
    );
    expect(isSentryEnabled()).toBe(true);
  });

  it('keeps the API bootable when the SDK fails to load', async () => {
    process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';

    await expect(initSentry(() => Promise.reject(new Error('offline')))).resolves.toBe(false);

    expect(isSentryEnabled()).toBe(false);
  });
});

describe('captureServerError', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' };
    resetSentryForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSentryForTesting();
  });

  it('is a silent no-op while Sentry is off', () => {
    resetSentryForTesting();

    expect(captureServerError(new Error('boom'), { requestId: 'abc' })).toBe(false);
  });

  it('tags the event with the request id so it joins the access log', async () => {
    const fake = createFakeSentry();
    await initSentry(() => Promise.resolve(fake.api));

    const error = new Error('boom');
    expect(
      captureServerError(error, {
        requestId: '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d',
        method: 'POST',
        path: '/workspaces/w_1/tasks',
        statusCode: 500,
      }),
    ).toBe(true);

    expect(fake.scope.setTag).toHaveBeenCalledWith(
      'requestId',
      '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d',
    );
    expect(fake.scope.setTag).toHaveBeenCalledWith('http.status_code', '500');
    expect(fake.scope.setContext).toHaveBeenCalledWith('request', {
      method: 'POST',
      path: '/workspaces/w_1/tasks',
    });
    expect(fake.captureException).toHaveBeenCalledWith(error);
  });

  it('strips the query string from the reported path', async () => {
    const fake = createFakeSentry();
    await initSentry(() => Promise.resolve(fake.api));

    captureServerError(new Error('boom'), { path: '/tasks?q=confidential+search' });

    expect(fake.scope.setContext).toHaveBeenCalledWith('request', {
      method: null,
      path: '/tasks',
    });
  });

  it('omits the request-id tag when the request carries no correlation id', async () => {
    const fake = createFakeSentry();
    await initSentry(() => Promise.resolve(fake.api));

    captureServerError(new Error('boom'), { method: 'GET' });

    expect(fake.scope.setTag).not.toHaveBeenCalledWith('requestId', expect.anything());
  });

  it('swallows an SDK that throws — reporting an error must not become the error', async () => {
    const fake = createFakeSentry();
    fake.captureException.mockImplementation(() => {
      throw new Error('transport exploded');
    });
    await initSentry(() => Promise.resolve(fake.api));

    expect(captureServerError(new Error('boom'))).toBe(false);
  });
});

describe('flushSentry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' };
    resetSentryForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSentryForTesting();
  });

  it('resolves immediately when Sentry is off', async () => {
    resetSentryForTesting();

    await expect(flushSentry()).resolves.toBeUndefined();
  });

  it('closes the transport with a bounded timeout', async () => {
    const fake = createFakeSentry();
    await initSentry(() => Promise.resolve(fake.api));

    await flushSentry(1234);

    expect(fake.close).toHaveBeenCalledWith(1234);
    expect(isSentryEnabled()).toBe(false);
  });

  it('does not reject when the transport fails to close', async () => {
    const fake = createFakeSentry();
    fake.close.mockRejectedValue(new Error('endpoint hung'));
    await initSentry(() => Promise.resolve(fake.api));

    await expect(flushSentry()).resolves.toBeUndefined();
  });
});
