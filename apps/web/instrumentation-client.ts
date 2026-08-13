import { webSentryOptionsFromEnv } from '@/lib/sentry-options';

/**
 * Browser-side error tracking. Next.js loads this file before the app hydrates.
 *
 * Written as a top-level side effect (not an exported `register()`) so it works regardless
 * of which client-instrumentation hooks a given Next.js minor calls, and `void import(...)`
 * rather than top-level `await` so hydration is never blocked on a telemetry SDK.
 *
 * The outer `if` tests `process.env.NEXT_PUBLIC_SENTRY_DSN` **directly**, rather than the
 * `options` object the rest of this file uses, and that redundancy is the point. Next.js
 * substitutes the literal member expression at build time, so with the DSN unset — the
 * default — the condition becomes a constant-falsy check and the minifier deletes the whole
 * block, `import('@sentry/nextjs')` included. No Sentry chunk is emitted at all: the SDK is
 * absent from the build output, not merely never fetched. Guarding on the function's return
 * value instead would leave the dynamic import reachable to the bundler, which emits ~570 kB
 * of Sentry into `.next/static` that no browser would ever request but every image would
 * carry. (Measured: that is exactly what happens when the check is written the other way.)
 *
 * `NEXT_PUBLIC_SENTRY_DSN` is inlined at **build** time (see `lib/sentry-options.ts`), so
 * turning error tracking on or off requires rebuilding the web image, exactly like
 * `NEXT_PUBLIC_API_URL`.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const options = webSentryOptionsFromEnv();

  if (options !== undefined) {
    void import('@sentry/nextjs').then((Sentry) => {
      Sentry.init(options);
    });
  }
}
