import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('TrustProxy');

/**
 * Header the app hands Better Auth as the sole source of client-IP truth (see
 * `configureTrustProxy` below and `advanced.ipAddress.ipAddressHeaders` in `auth/auth.ts`).
 *
 * Deliberately not `x-forwarded-for`: overwriting that well-known header would make a request
 * object lie about what the network actually delivered, which is exactly the kind of surprise
 * a maintainer six months from now would not expect from a header with a standard meaning. A
 * private name is safe to stamp unconditionally — a client cannot benefit from setting it,
 * because `configureTrustProxy`'s middleware overwrites it on every request, and nothing else
 * in this codebase or in `better-auth` reads it for any other purpose.
 */
export const RESOLVED_CLIENT_IP_HEADER = 'x-kurul-client-ip';

/**
 * Parses the `TRUST_PROXY` environment string into the value Express's `trust proxy` setting
 * expects. Express itself already accepts several shapes, and re-parsing here — rather than
 * handing the raw string straight to `app.set('trust proxy', raw)` — exists for exactly one
 * shape it does *not* distinguish from a no-op: an unset variable and the literal string
 * `"false"` both have to mean "off", which is the only overload of `app.set` this project
 * exposes to the environment. Everything else is passed through so Express's own (well-tested)
 * `proxy-addr`-based resolution does the actual work:
 *
 * - `false` / unset (the default) — nothing upstream is trusted; `req.ip` is always the TCP
 *   peer's address, and any `X-Forwarded-For` a client sends is ignored outright. Safe for a
 *   directly-exposed instance, and the only mode where a client cannot influence its own rate
 *   limit bucket by spoofing a header.
 * - `true` — trusts the *entire* forwarded chain, meaning the leftmost, fully client-supplied
 *   entry in `X-Forwarded-For` is taken as the real client IP with no verification at all. This
 *   is only safe when the API process is provably unreachable except through the proxy (for
 *   instance, the API port is not published outside a Docker network the proxy alone can
 *   reach) — on a directly-exposed instance it hands every attacker an unlimited rate-limit
 *   budget merely by sending a fabricated header. `configureTrustProxy` logs a warning when
 *   this value is used so the risk is visible at boot, not just in a comment.
 * - a bare integer (`"1"`, `"2"`, …) — hop-count mode: trusts exactly that many proxies
 *   counting outward from the TCP socket, then takes the next hop as the client. `"1"` is the
 *   common case (a single Caddy/Traefik box terminating TLS in front of the app, per the
 *   roadmap's reverse-proxy deployment) and is immune to a client prepending extra spoofed
 *   entries to `X-Forwarded-For`, because only the proxy-added hop closest to the socket is
 *   ever consulted.
 * - anything else (an IP, a CIDR range, a comma-separated list, or an Express/`proxy-addr`
 *   preset like `loopback`) — passed through verbatim for `proxy-addr` to compile. Lets an
 *   operator pin trust to the proxy's actual address instead of a hop count, which is the
 *   right choice when more than one process could sit at that hop (a container restart
 *   changing which loopback alias owns the socket, for instance).
 */
export function resolveTrustProxySetting(raw: string): boolean | number | string {
  const value = raw.trim();

  if (value === '' || value.toLowerCase() === 'false') {
    return false;
  }
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

/**
 * Rewrites `RESOLVED_CLIENT_IP_HEADER` to Express's own `req.ip` on every request, after `trust
 * proxy` has been applied.
 *
 * The rewrite exists because Better Auth's rate limiter never consults Express's `trust proxy`
 * setting — it re-derives an address by parsing `X-Forwarded-For` itself (see
 * `@better-auth/core/utils/ip`), and *without* its own `advanced.ipAddress.trustedProxies`
 * configured, it accepts a single-value header outright. That means a directly-exposed
 * instance with no reverse proxy at all is still spoofable through `/auth/*` today, entirely
 * independent of this project's own `trust proxy` setting: any client can send
 * `X-Forwarded-For: 1.2.3.4` and rotate that value to walk straight past the per-IP auth rate
 * limit. Handing Better Auth a header it always trusts — but which only this middleware is
 * ever allowed to set, unconditionally overwriting whatever a client sent — closes that gap
 * without reimplementing hop-count/CIDR proxy trust a second time in a different library's
 * format. It also means both routers (Nest's `ThrottlerGuard` via `req.ip`, and Better Auth via
 * this header) key on the exact same resolved address, computed once, by the one component
 * (`proxy-addr`, via Express) that actually understands the `TRUST_PROXY` value's shape.
 */
function stampResolvedClientIp(req: Request, _res: Response, next: NextFunction): void {
  if (req.ip !== undefined) {
    req.headers[RESOLVED_CLIENT_IP_HEADER] = req.ip;
  } else {
    // No TCP peer address at all — not a real scenario over the HTTP listener this app binds,
    // but dropping any inbound value here (rather than leaving a client-supplied one in place)
    // keeps the header's guarantee absolute: it is only ever this middleware's own output.
    delete req.headers[RESOLVED_CLIENT_IP_HEADER];
  }
  next();
}

/**
 * Applies `TRUST_PROXY` to the app: sets Express's `trust proxy`, which governs `req.ip` for
 * the Nest `ThrottlerGuard` (its default tracker is `req.ip`, see `throttler.guard.js`) and the
 * access log, and registers {@link stampResolvedClientIp} so Better Auth's independent IP
 * resolution lands on the same value. Registered once, ahead of every other middleware, so
 * nothing downstream can observe a request before the client identity for that request is
 * settled.
 */
export function configureTrustProxy(
  app: INestApplication,
  setting: boolean | number | string,
): void {
  if (setting === true) {
    logger.warn(
      'TRUST_PROXY=true trusts the entire X-Forwarded-For chain a client sends, with no ' +
        'verification — safe only when the API is unreachable except through the proxy. ' +
        'Prefer a hop count ("1") or the proxy\'s address/CIDR.',
    );
  }

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', setting);

  app.use(stampResolvedClientIp);
}
