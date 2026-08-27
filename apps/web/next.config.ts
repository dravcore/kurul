import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { getSecurityHeaders } from './lib/security-headers';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@kurul/shared-types', '@kurul/auth-access'],
  // Applied to every route (`source: '/:path*'`) — there is no route in this app that should
  // ship without them, including the public `(auth)` shell.
  //
  // Content-Security-Policy is the one security header *not* here: it names a per-request
  // nonce, and `headers()` runs once at build/start and returns the same array for every
  // request, so a nonce minted here would be a single fixed string that never rotates — no
  // better than the `'unsafe-inline'` it replaced, and harder to reason about. `proxy.ts`
  // mints it per request instead, which is also what lets Next stamp the same nonce onto its
  // own hydration scripts. The split is deliberate rather than incidental: constants belong
  // in static config, where they also cover the `_next/static` and `_next/image` routes the
  // proxy's matcher skips.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getSecurityHeaders(),
      },
    ];
  },
  // Forces the Sentry variables to *exist* as inlined build-time constants even when nobody
  // set them, which is what makes the `if (process.env.NEXT_PUBLIC_SENTRY_DSN)` guards in
  // `instrumentation.ts` / `instrumentation-client.ts` statically dead code.
  //
  // Next.js only substitutes a `NEXT_PUBLIC_*` expression it has a value for; an *unset*
  // variable is left as a runtime lookup, the guard stays reachable, and the bundler emits
  // ~570 kB of `@sentry/nextjs` into `.next/static` that no browser ever requests. Mapping
  // the unset case to `''` here turns that back into `if ("")`, which the minifier deletes
  // along with the dynamic import. Verified by building both ways and grepping the chunks.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? '',
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? '',
  },
};

const config = withNextIntl(nextConfig);

/**
 * Sentry's build plugin is applied **only** when a DSN is configured.
 *
 * Wrapping unconditionally would be the documented default, but it changes every build for
 * the benefit of the installs that opted in: the plugin rewrites the webpack/Turbopack
 * config, annotates output, and reaches for `sentry-cli`. CI builds with no DSN — which is
 * every CI build here, and every self-hoster who never configured error tracking — take the
 * untouched `next build` path instead, so the plugin cannot be the reason a build breaks
 * for someone who is not using it.
 *
 * When the plugin *is* applied:
 *
 * - **Source map upload is off unless `SENTRY_AUTH_TOKEN` is set.** Upload needs a token,
 *   an org and a project; a build that has a DSN but no token would otherwise emit warnings
 *   (and, on some plugin versions, generate maps it then cannot ship) for no gain. Without
 *   upload the browser stack traces stay minified — set the token plus `SENTRY_ORG` and
 *   `SENTRY_PROJECT` to get readable ones. Documented in `docs/development.md`.
 * - **`telemetry: false`.** The plugin otherwise reports build metadata to Sentry at build
 *   time. Enabling error tracking is a choice about *runtime* errors; it is not consent to
 *   be measured while compiling.
 * - **`silent: true` / `disableLogger: true`.** Keeps `next build` output readable and drops
 *   the SDK's debug logging from the production bundle.
 */
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();

export default sentryDsn
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      telemetry: false,
      silent: true,
      disableLogger: true,
      sourcemaps: { disable: !sentryAuthToken },
      // Vercel-specific cron monitoring; this product deploys with Docker Compose.
      automaticVercelMonitors: false,
    })
  : config;
