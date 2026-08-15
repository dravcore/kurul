import type { NextFunction, Request, Response } from 'express';
import { getRequestId } from './logging/request-id';

/**
 * The methods this check applies to.
 *
 * Deliberately the *unsafe* half of the method table, not all of it. A `GET` that arrives
 * with a foreign `Origin` is a cross-origin **read**, and the browser already governs that:
 * it will refuse to hand the response to the calling script unless the CORS allowlist named
 * that origin. Rejecting those server-side would add nothing and would break the two
 * cross-origin reads the product actually performs — the Socket.io handshake, which is a `GET`
 * carrying the web app's `Origin` (see `realtime.gateway.ts`, which has its own CORS config),
 * and the attachment byte stream, which is a `GET` a browser issues from an `<img src>` or an
 * `<a download>` on the page itself. Neither is unprotected by being outside this list: the
 * attachment stream is behind the session cookie and the workspace guard's tenant scope, and it
 * answers `Cross-Origin-Resource-Policy: same-origin` so no other site can embed the bytes it
 * returns. The exemption is a boundary that was drawn, not a gap that was left.
 *
 * `OPTIONS` is absent for a different reason: it *is* the preflight. The CORS middleware
 * registered ahead of this one answers and ends preflight requests itself, so one never
 * reaches here — and if one did, refusing it would turn a policy answer the browser needs
 * into a network error it cannot explain.
 */
const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reduces a configured URL to the exact string a browser would put in `Origin`.
 *
 * `URL.origin` is the same serialisation the Fetch spec uses for the header, which is why it
 * is the comparison key rather than raw string equality: it lowercases the scheme and host,
 * drops any path, query or trailing slash, and omits the port when it is the scheme's default
 * (`https://example.com:443/` → `https://example.com`). A `WEB_URL` written any of those ways
 * therefore still matches the header the browser sends, and no deployment has to learn which
 * spelling this code wanted.
 *
 * An unparseable value throws instead of being skipped. This runs once, during bootstrap,
 * from the same place `main.ts` reads the rest of its configuration — the point of doing it
 * there is that a typo fails the process rather than silently producing an empty allowlist
 * that rejects every write the app receives.
 */
export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Not a valid origin URL: ${value}`);
  }

  if (url.origin === 'null') {
    // `new URL('data:…').origin` and friends serialise to the literal "null", which is also
    // the header value a sandboxed iframe sends — allowlisting it would hand every sandboxed
    // document a pass. Refuse the configuration instead.
    throw new Error(`URL has no usable origin: ${value}`);
  }

  return url.origin;
}

/**
 * The origins allowed to make state-changing requests.
 *
 * One entry, and it is the *same* `WEB_URL` that configures CORS (`configureApp`) and the
 * Socket.io gateway. That is the point: the browser-side allowlist and the server-side one
 * can never drift, because there is only one value to set. A deployment that serves the web
 * app from two hostnames is already broken by the single-origin CORS config, so a second,
 * independently-configured list here would add a footgun without adding a capability.
 *
 * The API's own origin (`BETTER_AUTH_URL`) is deliberately *not* included. Under the
 * documented reverse-proxy topology it is the same string as `WEB_URL` anyway, and under a
 * split one the API origin serves no document at all — it answers JSON under a
 * `default-src 'none'` CSP — so nothing there could ever legitimately originate a write.
 */
export function resolveAllowedOrigins(webUrl: string): string[] {
  return [normalizeOrigin(webUrl)];
}

/**
 * The origin a request claims to come from, or `null` when it claims nothing.
 *
 * `Origin` is authoritative and checked first. `Referer` is the fallback, not because it is
 * as trustworthy — it is a URL, not an origin, and privacy settings strip it — but because a
 * request that carries one and not the other still tells us where it came from, and there is
 * no reason to ignore evidence a client volunteered.
 *
 * Neither header is a value a page can set: both are on the Fetch forbidden-header list, so
 * `fetch`/XHR from attacker-controlled JavaScript cannot forge or delete them.
 */
export function claimedOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    // Includes the literal `"null"` a sandboxed iframe or a cross-origin redirect sends.
    // `normalizeOrigin` refuses to put that string in the allowlist, so it falls through to
    // a rejection below — which is the intent: a document that was stripped of its origin is
    // exactly the kind of caller this check exists to stop.
    return origin;
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer !== '') {
    try {
      return new URL(referer).origin;
    } catch {
      // A malformed `Referer` says nothing about where the request came from. Fall through
      // to the no-evidence case rather than reject: browsers do not send malformed ones, so
      // this is a non-browser client, and see `createOriginCheckMiddleware` for why those
      // are not the threat here.
      return null;
    }
  }

  return null;
}

/**
 * Rejects state-changing requests that announce an origin outside the allowlist.
 *
 * ## Why this exists at all
 *
 * Until this middleware, every CSRF defence the API had lived in the browser. The session
 * cookie is `SameSite=Lax` (measured: Better Auth emits `SameSite=Lax` on both
 * `session_token` and `session_data`, with `crossSubDomainCookies` disabled in `auth/auth.ts`
 * there is no code path that emits `SameSite=None`), and cross-origin reads are gated by the
 * CORS allowlist. Server-side there was nothing: a `POST /workspaces` carrying a valid
 * session cookie and `Origin: https://evil.example` was answered `201`.
 *
 * Under the topology `docker/Caddyfile` sets up — web and API behind one hostname — `Lax`
 * genuinely holds, and this middleware is a second layer rather than the only one. It is
 * written for the deployments that leave that path:
 *
 *   * **A split-domain deployment.** `WEB_URL`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_API_URL`
 *     are independent settings and the dev loop itself runs the two apps on separate ports,
 *     so publishing the API on its own domain remains a supported shape. A session cookie
 *     cannot survive that without `SameSite=None`, and the moment it is set the `Lax` layer
 *     is gone.
 *   * **A subdomain split** (`app.example.com` + `api.example.com`) via
 *     `advanced.crossSubDomainCookies`. `Lax` is a *same-site* rule, so it keeps sending the
 *     cookie for requests made by every other subdomain of `example.com` — including one an
 *     operator does not control.
 *
 * And in the first of those, CORS is not the "one remaining layer" it is easy to assume. A
 * cross-site `<form method="POST" enctype="application/x-www-form-urlencoded">` is a *simple
 * request*: no preflight is sent, so no CORS decision is ever made, and the write lands
 * before the browser discards the response the attacker never needed to read. That vector is
 * live here rather than theoretical — Nest's Express adapter installs `urlencoded` body
 * parsing by default, and a form-encoded `POST /workspaces` was measured returning `201` with
 * a created workspace. So for the single most CSRF-prone request shape there were zero
 * layers, not one.
 *
 * ## Why "reject when it disagrees" and not "require agreement"
 *
 * A request with neither header passes. That reads like a hole and is not, because of who
 * can be in each case:
 *
 *   * **A browser making the attack always sends `Origin`.** Fetch requires it on every
 *     request whose method is not `GET`/`HEAD` — `fetch`, XHR and form navigations alike,
 *     across every current engine. There is no cross-site request shape that both carries
 *     the victim's cookie and omits the header.
 *   * **Everything with no headers is not a browser**: `curl`, a CI script, a native client,
 *     the integration suite. None of them can be induced to replay a victim's ambient
 *     credentials by a page the victim visits, which is the entire mechanism of CSRF.
 *
 * Rejecting the header-less case would therefore break every non-browser caller of the API
 * while closing nothing — including `apps/web/middleware.ts`, whose server-side session
 * lookup runs in Node, where `fetch` sets no `Origin`.
 *
 * ## Why an Express middleware rather than a Nest guard or interceptor
 *
 * For the same reason helmet and the request-id middleware are: `/auth/*` is served by raw
 * Express below the Nest router (ADR 0004 escape hatch), so no Nest guard, interceptor or
 * pipe can see it. Measured on the unprotected build, Better Auth's own `originCheck` did not
 * refuse a cross-site `POST /auth/sign-in/email` or `POST /auth/sign-out` — both answered
 * `200` with `Origin: https://evil.example` — because that check guards redirect targets
 * (`callbackURL`), not the credential endpoints themselves. Registered here, one middleware
 * covers both routers, and Better Auth's own check is left entirely intact underneath it.
 *
 * It writes its own response body for the same structural reason: `AllExceptionsFilter` is
 * bound to the Nest router, so an error thrown from here would reach Express's default HTML
 * error handler instead. The envelope below is therefore assembled by hand to match the one
 * `docs/api-conventions.md` specifies, field for field, including the correlation id
 * `requestIdMiddleware` attached upstream.
 */
export function createOriginCheckMiddleware(
  allowedOrigins: readonly string[],
): (req: Request, res: Response, next: NextFunction) => void {
  const allowed = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = claimedOrigin(req);
    if (origin === null || allowed.has(origin)) {
      next();
      return;
    }

    const requestId = getRequestId(req);
    res.status(403).json({
      statusCode: 403,
      error: 'Forbidden',
      // Names the rule, never the allowlist: an attacker who could read this response would
      // be told which origin to spoof — and the one caller that legitimately hits this, an
      // operator with a misconfigured WEB_URL, finds the value in the access log line for
      // the same request id rather than in a body a browser hands to a hostile page.
      message: 'Cross-origin state-changing request rejected',
      path: req.path,
      timestamp: new Date().toISOString(),
      ...(requestId !== undefined ? { requestId } : {}),
    });
  };
}
