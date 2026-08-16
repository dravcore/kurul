import type { Instrumentation } from 'next';
import { webSentryOptionsFromEnv } from '@/lib/sentry-options';

/**
 * Server-side (and edge-runtime) error tracking for the web app.
 *
 * Next.js calls `register()` once per runtime before any request is handled, and
 * `onRequestError` for every uncaught error in a server component, route handler or server
 * action. Both are no-ops unless `NEXT_PUBLIC_SENTRY_DSN` was set at build time — the
 * dynamic `import()` below is the only reference to `@sentry/nextjs` in this file, so when
 * error tracking is off the SDK is never loaded, never patches anything, and never opens a
 * socket. That is the opt-in guarantee `lib/sentry-options.test.ts` pins, and the reason
 * this file is not the usual `Sentry.init(...)` at module scope.
 */
export async function register(): Promise<void> {
  // The literal `process.env.NEXT_PUBLIC_SENTRY_DSN` guard, rather than a check on the
  // options object, for the reason spelled out in `instrumentation-client.ts`: Next.js
  // inlines it at build time, so with error tracking off the minifier drops this block and
  // the dynamic import with it, keeping `@sentry/nextjs` out of the traced server output.
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  const options = webSentryOptionsFromEnv();
  if (options === undefined) {
    return;
  }

  const Sentry = await import('@sentry/nextjs');
  Sentry.init(options);
}

/**
 * Reports a server-render failure: an uncaught error in a server component, route handler or
 * server action.
 *
 * The same guard is repeated rather than hoisted into a shared helper, because it only does
 * its job — letting the minifier delete the dynamic import — when the literal
 * `process.env.NEXT_PUBLIC_SENTRY_DSN` expression sits in the same block as the `import()`.
 * A helper that returned the same boolean would be an opaque function call to the bundler
 * and the SDK would be traced into the server output regardless.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN || webSentryOptionsFromEnv() === undefined) {
    return;
  }

  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(error, request, context);
};
