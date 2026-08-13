import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { getSecurityHeaders } from './lib/security-headers';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@kurultay/shared-types', '@kurultay/auth-access'],
  // Applied to every route (`source: '/:path*'`) — there is no route in this app that should
  // ship without them, including the public `(auth)` shell.
  //
  // This is `headers()`, not `middleware.ts`, on purpose, and that choice is the reason
  // `script-src` carries `'unsafe-inline'` instead of a nonce (see
  // `lib/security-headers.ts` for the rest of the CSP's reasoning). A nonce only defends
  // anything if it is unpredictable and different per response, which requires generating it
  // per request — Next's documented pattern for that reads the nonce back out of the request
  // in middleware and threads it through `headers()` on `NextResponse`. `headers()` here is
  // static Next config: it runs once at build/start and returns the same array for every
  // request, so a "nonce" produced this way would not rotate and would carry none of a real
  // nonce's guarantee. Wiring a per-request nonce through middleware, the root layout and
  // every inline script Next/`next-themes` emit is a materially larger change than "add
  // headers()" — it was scoped out here rather than shipped half-verified, and is left for a
  // follow-up if `'unsafe-inline'` ever needs tightening.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
