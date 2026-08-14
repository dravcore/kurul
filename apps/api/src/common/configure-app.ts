import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { mountBetterAuth } from '../auth/mount-better-auth';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { createAccessLogMiddleware } from './logging/access-log.middleware';
import { requestIdMiddleware } from './logging/request-id';
import { createOriginCheckMiddleware, resolveAllowedOrigins } from './origin-check';
import { configureTrustProxy } from './trust-proxy';
import { validationExceptionFactory } from './validation/validation-exception.factory';

/** Shared Nest bootstrap (HTTP app + e2e) so pipes/filters/CORS/auth stay in sync. */
export function configureApp(
  app: INestApplication,
  options: { corsOrigin: string; trustProxy: boolean | number | string },
): void {
  // Settles who the client actually is before anything else runs: `req.ip` (read by the
  // access log below and by the Nest `ThrottlerGuard`'s default tracker) and the header Better
  // Auth's independent rate limiter is configured to trust (`auth/auth.ts`) both depend on it.
  configureTrustProxy(app, options.trustProxy);

  // Registered first so every response — Nest routes, the Better Auth mount below, and CORS
  // preflights — carries the same baseline headers.
  app.use(
    helmet({
      // This service only ever answers with JSON (see AllExceptionsFilter) — it renders no
      // HTML, serves no static assets, and embeds no third-party resources. So instead of
      // helmet's browser-app defaults (`default-src 'self'`, a `script-src`, an inline-friendly
      // `style-src`), lock the policy down to the API shape: nothing is allowed to load,
      // nothing may frame us, and no `<base>`/form target can be smuggled into a response that
      // some browser decides to sniff as a document. CSP only governs document/worker contexts,
      // so this cannot affect `fetch`/XHR JSON reads or the Socket.io transport.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      // The API is not a page and must never be framed, so DENY beats helmet's SAMEORIGIN.
      frameguard: { action: 'deny' },
      // The web app is a separate origin (WEB_URL) that legitimately reads this API, so the
      // default `same-origin` CORP would be wrong here. Cross-origin access stays gated by the
      // CORS allowlist configured below.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // HSTS keeps helmet's default (max-age 1 year, includeSubDomains). No environment
      // conditional is needed: browsers ignore Strict-Transport-Security on plain-HTTP
      // responses, so it is inert for local/dev over http and takes effect only once the
      // deployment terminates TLS.
    }),
  );

  // Correlation and access logging sit above everything that answers a request, for the same
  // reason helmet does: the Better Auth mount below bypasses the Nest router (ADR 0004), and
  // so does anything Express rejects before routing. Registered here, one middleware pair
  // covers Nest routes, auth traffic, CORS preflights and 404s alike. Order within the pair
  // matters — the id has to exist before the access log reads it.
  app.use(requestIdMiddleware);
  app.use(createAccessLogMiddleware());

  app.enableCors({
    origin: options.corsOrigin,
    credentials: true,
  });

  // The server-side half of the cross-origin story, and the only half that survives a
  // deployment where the session cookie is not `SameSite=Lax` — see `origin-check.ts` for the
  // measurements behind that. Two things about its position here are load-bearing:
  //
  //   * **After `enableCors`**, so the CORS middleware still answers and ends preflight
  //     `OPTIONS` requests itself. A rejection issued before the browser has been told the
  //     policy turns a readable 403 into an unexplainable network error.
  //   * **Before `mountBetterAuth`**, so it covers the Better Auth mount too. That mount
  //     bypasses the Nest router (ADR 0004), which is why this is a middleware and not a
  //     guard: `/auth/sign-in/email` and `/auth/sign-out` were both measured answering `200`
  //     to a cross-site POST, so the auth routes needed this at least as much as `/workspaces`
  //     did. Better Auth's own `originCheck` is untouched and still runs underneath.
  //
  // The allowlist is derived from the CORS origin rather than configured separately, so the
  // browser-side and server-side allowlists cannot drift apart.
  app.use(createOriginCheckMiddleware(resolveAllowedOrigins(options.corsOrigin)));

  mountBetterAuth(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
