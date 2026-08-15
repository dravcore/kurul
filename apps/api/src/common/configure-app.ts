import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { mountBetterAuth } from '../auth/mount-better-auth';
import { envInt } from './env';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { createAccessLogMiddleware } from './logging/access-log.middleware';
import { requestIdMiddleware } from './logging/request-id';
import { createOriginCheckMiddleware, resolveAllowedOrigins } from './origin-check';
import { configureTrustProxy } from './trust-proxy';
import { validationExceptionFactory } from './validation/validation-exception.factory';

/**
 * The largest JSON or urlencoded request body the API will read — 1 MiB.
 *
 * Until issue #214 this project had no such number. Express's body-parser defaults to **100 kB**
 * when nothing sets a limit, and nothing here did, so 100 kB was the API's real ceiling: a
 * decision by omission, recorded in no file, discoverable only by sending a large body and
 * watching what came back. Naming it is most of the fix; the value itself is the smaller half.
 *
 * **Why 1 MiB.** The largest single field any DTO in this codebase accepts is 2048 characters
 * (`CreateAttachmentDto.url`), and no endpoint takes an array body, so today's largest
 * legitimate request is a few kilobytes. 1 MiB is roughly two orders of magnitude of headroom
 * over that — generous enough that no honest client meets it, small enough that a body sits in
 * memory for a moment rather than being a denial-of-service primitive (`ValidationPipe` and
 * `class-transformer` both walk the parsed object, so the cost of a body is not linear in its
 * size). Ten times the accidental default it replaces, which is the direction the accident was
 * wrong in.
 *
 * **Why it is a variable and not a constant.** P3-3 (Trello import) will POST a real board
 * export as a JSON body, and a real export passes 100 kB easily and can pass 1 MiB. That item
 * has to raise this number deliberately, and when it does the change is one environment variable
 * and one line in `.env.example` — not the discovery that a limit existed at all. Raising it is
 * not free: this is a **memory** ceiling as much as a size one, exactly as
 * `ATTACHMENT_MAX_BYTES` is, and N concurrent requests cost up to N × this value of heap.
 *
 * This is the size of a **parsed body**, and it is unrelated to `ATTACHMENT_MAX_BYTES`: an
 * upload is `multipart/form-data`, which neither of these parsers touches — multer reads it, and
 * carries its own limit (`attachment/attachment.module.ts`).
 */
export const DEFAULT_REQUEST_BODY_MAX_BYTES = 1_048_576;

/**
 * Reads `REQUEST_BODY_MAX_BYTES`, falling back to {@link DEFAULT_REQUEST_BODY_MAX_BYTES}.
 *
 * Called from `main.ts` before the container is built, so a nonsensical value fails the process
 * at boot rather than turning every request into a 413 nobody can explain. `envInt` already
 * rejects anything that is not a plain integer; the extra check here is the one it cannot make
 * generically — a limit of `0` or a negative one would reject every request body, including the
 * empty one.
 */
export function resolveRequestBodyMaxBytes(): number {
  const bytes = envInt('REQUEST_BODY_MAX_BYTES', DEFAULT_REQUEST_BODY_MAX_BYTES);
  if (bytes < 1) {
    throw new Error(
      `Invalid REQUEST_BODY_MAX_BYTES: expected a positive byte count, received "${bytes}"`,
    );
  }

  return bytes;
}

/**
 * The one method `configureApp` needs beyond `INestApplication`.
 *
 * `useBodyParser` is declared on `NestExpressApplication`, but it is implemented on
 * `NestApplication` itself — it forwards to whichever adapter is installed — so every app this
 * function is handed already has it, including the ones `Test.createTestingModule` builds.
 * Borrowing the platform's own signature rather than hand-writing one keeps the narrowing
 * honest: if Nest renames or re-shapes the method, this stops compiling instead of silently
 * doing nothing at runtime. Same technique, and the same reason, as the `set` narrowing in
 * `configureTrustProxy`.
 */
type BodyParserCapable = Pick<NestExpressApplication, 'useBodyParser'>;

/** Shared Nest bootstrap (HTTP app + e2e) so pipes/filters/CORS/auth stay in sync. */
export function configureApp(
  app: INestApplication,
  options: {
    corsOrigin: string;
    trustProxy: boolean | number | string;
    /** Defaults to {@link DEFAULT_REQUEST_BODY_MAX_BYTES}; `main.ts` passes the resolved value. */
    bodyLimitBytes?: number;
  },
): void {
  // Settles who the client actually is before anything else runs: `req.ip` (read by the
  // access log below and by the Nest `ThrottlerGuard`'s default tracker) and the header Better
  // Auth's independent rate limiter is configured to trust (`auth/auth.ts`) both depend on it.
  configureTrustProxy(app, options.trustProxy);

  // Registered first so every response — Nest routes, the Better Auth mount below, and CORS
  // preflights — carries the same baseline headers.
  app.use(
    helmet({
      // This service answers with JSON everywhere except one endpoint (see AllExceptionsFilter
      // for the JSON half, and attachment/attachment.controller.ts for the exception, which
      // streams stored bytes). It renders no HTML, serves no static assets, and embeds no
      // third-party resources. So instead of helmet's browser-app defaults (`default-src
      // 'self'`, a `script-src`, an inline-friendly `style-src`), lock the policy down to the
      // API shape: nothing is allowed to load, nothing may frame us, and no `<base>`/form
      // target can be smuggled into a response that some browser decides to sniff as a
      // document. CSP only governs document/worker contexts, so this cannot affect `fetch`/XHR
      // JSON reads or the Socket.io transport.
      //
      // The attachment stream does not weaken any of that, and the reason is the serving
      // policy rather than this policy: the only family served `Content-Disposition: inline` is
      // the four raster image types, and a raster image is not a document context — it loads
      // nothing, so there is nothing for `default-src 'none'` to have to stop. Every other
      // type, PDF included, is served `attachment` and never becomes a browsing context at all.
      // `text/html` and `image/svg+xml` are refused at upload for exactly this reason
      // (ADR 0022, ADR 0024).
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
      // CORS allowlist configured below. One handler overrides this back to `same-origin` on
      // its own responses — the attachment download — because the reasoning above is about the
      // web app reading the API, and does not extend to user-uploaded bytes that nothing
      // off-origin should be embedding (attachment-download.service.ts).
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

  // The body parsers, registered **last** among the middleware — which is exactly where Nest
  // would have put them. `NestApplication.init()` installs `express.json()` and
  // `express.urlencoded()` itself, after every `app.use` above has already run, and it skips a
  // parser whose middleware function name it finds on the stack. Registering them here therefore
  // moves nothing: it substitutes an explicit limit for an implicit one and leaves the order
  // byte-for-byte as it was. That order is load-bearing twice over. The Better Auth mount above
  // bypasses the Nest router (ADR 0004) and reads the raw request stream itself, so a parser
  // ahead of it would hand it an already-consumed body; and `origin-check.ts` must reject a
  // cross-origin write *before* anything buffers it, which is what `configure-app.spec.ts` pins.
  //
  // Both parsers, not just `json`: `urlencoded` is a second parser with its own limit, and
  // leaving it on the default would keep a 100 kB ceiling behind any form-encoded POST.
  // `extended: true` matches what Nest configures, so this is a limit change and nothing else.
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_REQUEST_BODY_MAX_BYTES;
  const bodyParserApp = app as INestApplication & BodyParserCapable;
  bodyParserApp.useBodyParser('json', { limit: bodyLimit });
  bodyParserApp.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

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
