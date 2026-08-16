/**
 * Sentry configuration for the web app, kept as a pure function so the opt-in stance and the
 * PII stance are both testable without loading the SDK (`lib/sentry-options.test.ts`).
 *
 * The API's counterpart lives in `apps/api/src/common/observability/sentry.ts` and reads
 * `process.env` directly, because a Node process can. This one cannot: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` at **build** time by textually substituting literal member
 * expressions, so `env.NEXT_PUBLIC_SENTRY_DSN` — a dynamic lookup on a value that was passed
 * in — would survive into the client bundle as a read of an object that does not exist there.
 * Hence the shape below: callers write the literal `process.env.NEXT_PUBLIC_SENTRY_DSN` at
 * the call site (where the compiler can see and replace it) and hand the *result* here.
 */
export interface WebSentryEnv {
  dsn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
  nodeEnv: string | undefined;
}

/**
 * The exact option set passed to `Sentry.init`. Spelled out as a closed interface rather
 * than reusing the SDK's wide `BrowserOptions` so that adding a field is a deliberate,
 * reviewable edit — this is the object that decides what leaves a self-hosted browser.
 */
export interface WebSentryOptions {
  dsn: string;
  environment: string;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  replaysSessionSampleRate: 0;
  replaysOnErrorSampleRate: 0;
  beforeSend: (event: SentryWebEvent) => SentryWebEvent;
}

/**
 * The event object `beforeSend` receives.
 *
 * A *type-only* import: it is erased at compile time, so naming the SDK's type here does not
 * pull `@sentry/nextjs` into the bundle — which is the whole point of the guarded dynamic
 * imports in `instrumentation.ts` and `instrumentation-client.ts`.
 */
export type SentryWebEvent = import('@sentry/nextjs').ErrorEvent;

/** Same list, same reasoning, as the API's `SCRUBBED_HEADERS`. */
const SCRUBBED_HEADERS = ['cookie', 'set-cookie', 'authorization'];

/**
 * Strips everything that could carry board content or a session out of a browser event.
 *
 * A browser event's `request.url` is the page the user was on, which is worth keeping — it
 * is how a stack trace becomes actionable. Its query string is not: search and filter terms
 * travel there (`?q=`), and those are user content, exactly as
 * `apps/api/src/common/logging/access-log.middleware.ts` argues for the access log.
 */
export function scrubWebEvent(event: SentryWebEvent): SentryWebEvent {
  if (event.request) {
    const { headers, url, ...request } = event.request;
    const queryStart = url === undefined ? -1 : url.indexOf('?');

    event.request = {
      ...request,
      ...(url !== undefined ? { url: queryStart === -1 ? url : url.slice(0, queryStart) } : {}),
      query_string: undefined,
      cookies: undefined,
      data: undefined,
      ...(headers
        ? {
            headers: Object.fromEntries(
              Object.entries(headers).filter(
                ([name]) => !SCRUBBED_HEADERS.includes(name.toLowerCase()),
              ),
            ),
          }
        : {}),
    };
  }

  if (event.user) {
    event.user = event.user.id === undefined ? {} : { id: event.user.id };
  }

  return event;
}

/**
 * Returns `Sentry.init` options, or `undefined` when error tracking is off.
 *
 * Off is the default and, for most self-hosted installs, the permanent state. `undefined`
 * rather than "options with an empty DSN" for the same reason as the API: the caller must be
 * able to skip loading the SDK entirely, so the browser of someone who never configured
 * Sentry never fetches the chunk, never installs global handlers, and never opens a socket
 * to a third party. See `instrumentation-client.ts` and `instrumentation.ts`.
 */
export function buildWebSentryOptions(env: WebSentryEnv): WebSentryOptions | undefined {
  const dsn = env.dsn?.trim();
  if (dsn === undefined || dsn === '') {
    return undefined;
  }

  return {
    dsn,
    environment: env.environment?.trim() || env.nodeEnv || 'development',
    ...(env.release?.trim() ? { release: env.release.trim() } : {}),
    sendDefaultPii: false,
    // No tracing: this baseline is error tracking (audit OPS-05), not a metrics stack.
    tracesSampleRate: 0,
    // Session Replay records the DOM — every task title, comment and workspace name on
    // screen — and ships it to Sentry. That is categorically more than "an error report",
    // and it is not something a self-hosted install should be able to switch on by
    // accident. Pinned to 0 in both directions rather than left to the SDK default.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: scrubWebEvent,
  };
}

/**
 * Reads the build-time environment. Every `process.env.NEXT_PUBLIC_*` below is a literal
 * member expression on purpose — see the note on {@link WebSentryEnv}. Kept next to the
 * builder so the two are edited together.
 */
export function webSentryOptionsFromEnv(): WebSentryOptions | undefined {
  return buildWebSentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    nodeEnv: process.env.NODE_ENV,
  });
}
