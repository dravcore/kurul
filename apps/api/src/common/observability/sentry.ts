import { Logger } from '@nestjs/common';

/**
 * The shape of `@sentry/node` this module uses, expressed as a *type-only* import so the
 * package is never pulled into the require graph by the type annotation alone. The runtime
 * reference is the dynamic `import()` in {@link defaultSentryLoader} and nowhere else — see
 * the opt-in note on {@link initSentry}.
 */
type SentryApi = typeof import('@sentry/node');

/** `Sentry.init` options, without importing the package at runtime to name them. */
type SentryOptions = import('@sentry/node').NodeOptions;

/** The event object `beforeSend` receives; narrowed to the fields {@link scrubEvent} touches. */
type SentryEvent = import('@sentry/node').ErrorEvent;

/**
 * How the SDK is obtained. Injectable so tests can assert the *absence* of a load — the
 * opt-in guarantee below is only meaningful if something proves the package is never
 * reached when `SENTRY_DSN` is unset, and a spy loader is the only way to observe that.
 */
export type SentryLoader = () => Promise<SentryApi>;

const defaultSentryLoader: SentryLoader = () => import('@sentry/node');

const logger = new Logger('Sentry');

/**
 * The initialized SDK, or `undefined` while Sentry is off — which is the default and, for
 * most self-hosted installs, the permanent state. Module-level rather than a Nest provider
 * because {@link initSentry} runs in `main.ts` before the Nest container exists, and because
 * `AllExceptionsFilter` is constructed with `new` (see `configureApp`) and so cannot inject.
 */
let sentry: SentryApi | undefined;

/**
 * Context attached to a captured error. Deliberately the same three fields the JSON access
 * log already emits (`apps/api/src/common/logging/access-log.middleware.ts`), so a Sentry
 * issue and the log line for the same request join on `requestId` with one grep — that
 * correlation is the whole reason error tracking is worth turning on next to the log.
 */
export interface ServerErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
}

/**
 * Headers and cookies are stripped from every outbound event, by name, in
 * {@link scrubEvent}.
 *
 * `sendDefaultPii: false` already tells the SDK not to attach cookies, IP addresses or
 * request bodies. This list is the second layer: it holds regardless of what a future SDK
 * default, integration, or misconfigured `sendDefaultPii: true` decides to include. The API
 * carries Better Auth session cookies and invitation tokens — a captured `cookie` header is
 * a session handed to whoever can read the Sentry project.
 */
const SCRUBBED_HEADERS = ['cookie', 'set-cookie', 'authorization', 'proxy-authorization'];

/**
 * Removes the fields that must never leave this process, whatever produced them.
 *
 * What deliberately *does* survive: the exception type, message and stack; the request
 * method and route path; the `requestId` tag; and `user.id` (an opaque UUIDv7 — the same
 * identifier the access log already writes, and the minimum needed to answer "is this one
 * user or everyone"). Email, name and IP are dropped even though Sentry would happily group
 * by them.
 *
 * Exported and pure so the PII stance is a testable assertion rather than a claim in a doc.
 */
export function scrubEvent(event: SentryEvent): SentryEvent {
  if (event.request) {
    const { headers, ...request } = event.request;

    event.request = {
      ...request,
      // Query strings carry filter and search terms (`?q=`), which are user content for the
      // same reason `access-log.middleware.ts` truncates the path at `?`.
      query_string: undefined,
      cookies: undefined,
      // Request/response bodies: task titles, comment text, credentials on an auth route.
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
    // An allowlist, not a blocklist: a future SDK version adding `user.email` by default
    // must not silently start sending it.
    event.user = event.user.id === undefined ? {} : { id: event.user.id };
  }

  return event;
}

/**
 * Builds the `Sentry.init` options from the environment, or `undefined` when Sentry is off.
 *
 * `undefined` — not "options with an empty DSN" — is the off signal on purpose: the SDK
 * treats a blank DSN as "initialize but drop everything", which still installs its global
 * error handlers and OpenTelemetry hooks. This product is self-hosted, and a self-hosted
 * install that quietly stands up a telemetry pipeline nobody asked for is the thing
 * `docs/roadmap.md` §9.1 rules out. Off means the package is never loaded at all.
 */
export function sentryOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SentryOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (dsn === undefined || dsn === '') {
    return undefined;
  }

  return {
    dsn,
    // `SENTRY_ENVIRONMENT` exists separately from `NODE_ENV` because a self-hoster running
    // staging and production from the same image needs to tell the two apart, and both are
    // `NODE_ENV=production`.
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    // Left unset when the operator does not supply one. A wrong release tag is worse than
    // none: Sentry marks issues "regressed" against it and mails about resolved bugs.
    release: env.SENTRY_RELEASE?.trim() || undefined,
    // The SDK's own switch for cookies, IP addresses and request bodies. Off, and belt-and
    // -braces backed by `scrubEvent` above.
    sendDefaultPii: false,
    // No performance tracing, and not merely "sampled at zero by default": reliable tracing
    // needs the SDK loaded *before* express/pg/ioredis so OpenTelemetry can patch them,
    // which means a preloaded instrumentation entrypoint (`node --import`) that runs
    // unconditionally. That directly contradicts the opt-in guarantee above, and this
    // finding (audit OPS-05) asks for error tracking, not a metrics stack. Fixed at 0 rather
    // than exposed as an env var so nobody switches on a feature that would only half work.
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}

/** True once {@link initSentry} has actually loaded and initialized the SDK. */
export function isSentryEnabled(): boolean {
  return sentry !== undefined;
}

/**
 * Initializes Sentry if — and only if — `SENTRY_DSN` is set.
 *
 * Awaited from `bootstrap()` before `NestFactory.create`, so the first request cannot race
 * a half-initialized client. When the DSN is absent this returns without touching the
 * loader: no `@sentry/node` require, no OpenTelemetry registration, no global handlers, no
 * outbound socket. That is the property `sentry.spec.ts` pins.
 *
 * Failures here are logged and swallowed. Error tracking is an accessory; a bad DSN or an
 * SDK that throws on load must not stop the API from serving.
 */
export async function initSentry(load: SentryLoader = defaultSentryLoader): Promise<boolean> {
  const options = sentryOptionsFromEnv();
  if (options === undefined) {
    return false;
  }

  try {
    const api = await load();
    api.init(options);
    sentry = api;
    logger.log(`Error tracking enabled (environment=${String(options.environment)})`);
    return true;
  } catch (error) {
    logger.warn(
      `SENTRY_DSN is set but the SDK could not be initialized: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * Sends one server-side failure to Sentry, tagged so it can be joined against the logs.
 *
 * Callers decide *what* is worth sending; see the 4xx/5xx reasoning in
 * `all-exceptions.filter.ts`. A no-op (returning `false`) when Sentry is off, which is the
 * common case — every call site can stay unconditional.
 */
export function captureServerError(error: unknown, context: ServerErrorContext = {}): boolean {
  if (sentry === undefined) {
    return false;
  }

  try {
    sentry.withScope((scope) => {
      if (context.requestId !== undefined) {
        // A *tag*, not just context data: tags are indexed, so `requestId:<id>` is
        // searchable in the Sentry UI and lines up with the `requestId` field in the JSON
        // access log and the `X-Request-Id` header the client was handed.
        scope.setTag('requestId', context.requestId);
      }
      if (context.statusCode !== undefined) {
        scope.setTag('http.status_code', String(context.statusCode));
      }
      scope.setContext('request', {
        method: context.method ?? null,
        // The route path only — `all-exceptions.filter.ts` passes `request.url`, which can
        // carry a query string, so it is truncated here rather than trusted.
        path: context.path === undefined ? null : context.path.split('?')[0],
      });
      sentry?.captureException(error);
    });
    return true;
  } catch {
    // Reporting an error must never become the error. Nothing to log to either — the
    // logger is what this is a companion to, and the failure has already been logged there.
    return false;
  }
}

/**
 * Drains the transport queue before the process exits.
 *
 * Sentry batches events, so a crash-exit is exactly the case where the last — and most
 * interesting — event is still in the buffer. Bounded, because a hung Sentry endpoint must
 * not turn a fast crash into a two-minute hang.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (sentry === undefined) {
    return;
  }

  try {
    await sentry.close(timeoutMs);
  } catch {
    // Same reasoning as `captureServerError`: shutdown must not fail because telemetry did.
  } finally {
    sentry = undefined;
  }
}

/** Test-only: drops the module-level client so specs do not leak state into each other. */
export function resetSentryForTesting(): void {
  sentry = undefined;
}
