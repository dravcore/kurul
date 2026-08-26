import type { NextFunction, Request, Response } from 'express';
import type { AuthedRequest } from '../types/request-context';
import { stdoutWriter, type LogWriter } from './json-log';
import { getRequestId } from './request-id';

/**
 * One line per finished HTTP request, emitted as JSON so a collector can index the fields
 * instead of regex-ing a human-readable format.
 *
 * The field list is deliberately closed. Request bodies, query strings, headers and cookies
 * never appear: this API carries session cookies, invitation tokens and task content, none of
 * which belongs in a log aggregator. Where a secret rides in the path itself rather than
 * beside it, `REDACTED_PATH_PREFIXES` takes it out of `path` too. What is here is the minimum
 * needed to answer "which request, how did it end, how long did it take, who made it, and
 * where from".
 */
export interface AccessLogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  requestId?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: string;
  ip: string;
}

// Re-exported so existing importers (and this file's own spec) keep their import path while
// the type itself lives with the sink it describes — `json-log.ts` is now shared with the
// retention cleanup worker, which emits its own JSON line through the same transport.
export type { LogWriter } from './json-log';

function levelFor(status: number): AccessLogLine['level'] {
  if (status >= 500) {
    return 'error';
  }
  return status >= 400 ? 'warn' : 'info';
}

/**
 * Route prefixes whose remaining path carries a secret rather than an identifier, and the
 * placeholder written in its place.
 *
 * Dropping the query string used to be enough on its own, because every secret this API hands
 * out travelled either in a query (`/auth/verify-email?token=`) or in a request body. Better
 * Auth's password-reset link does not: it is `GET /auth/reset-password/<token>`, opened by the
 * recipient's browser, so the live token would otherwise be written to stdout verbatim and be
 * spendable by anyone who can read the log until the user submits the form. That is a wider
 * set of people than can read the database, especially once logs are shipped somewhere.
 *
 * Match on the prefix and discard everything after it, rather than parsing out one segment: a
 * path that only looks like the route (`/auth/reset-password/<token>/anything`) must not walk
 * past the redaction. Compared case-insensitively because Express's router is, by default.
 */
const REDACTED_PATH_PREFIXES: ReadonlyArray<{ prefix: string; placeholder: string }> = [
  { prefix: '/auth/reset-password/', placeholder: ':token' },
];

/**
 * The path without its query string. Filters travel in the query (`?assigneeId=`, `?q=`), and
 * a search term is user content — the route is what an access log is actually for.
 *
 * Also without any secret the route itself carries: see `REDACTED_PATH_PREFIXES`.
 */
function pathOf(req: Request): string {
  const url = req.originalUrl !== undefined && req.originalUrl !== '' ? req.originalUrl : req.url;
  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  return redactSecretSegments(path);
}

function redactSecretSegments(path: string): string {
  const lowered = path.toLowerCase();
  for (const { prefix, placeholder } of REDACTED_PATH_PREFIXES) {
    // `length >` and not `>=`: with nothing after the prefix there is no secret to hide, and
    // the real (404-shaped) path is more useful than a placeholder that implies a token.
    if (lowered.startsWith(prefix) && path.length > prefix.length) {
      // The original casing of the prefix is kept, so an oddly-cased request still shows up
      // as the odd thing it is.
      return `${path.slice(0, prefix.length)}${placeholder}`;
    }
  }
  return path;
}

/**
 * Structured HTTP access log.
 *
 * A plain Express middleware, not a Nest interceptor, for two reasons: an interceptor never
 * sees the Better Auth mount (raw Express, ADR 0004) and never sees requests rejected before
 * the router — so sign-in traffic and 404s, the two things an access log is most often opened
 * for, would be missing. Registered ahead of that mount in `configureApp`.
 *
 * The line is emitted on `finish` — after the response is fully written — so `status` and
 * `durationMs` are the real ones, and `userId` picks up the user that `SessionAuthGuard`
 * attached during the request, which has not happened yet when the middleware itself runs.
 */
export function createAccessLogMiddleware(write: LogWriter = stdoutWriter) {
  return function accessLog(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const requestId = getRequestId(req);
      const userId = (req as AuthedRequest).user?.id;

      const line: AccessLogLine = {
        ts: new Date().toISOString(),
        level: levelFor(res.statusCode),
        ...(requestId !== undefined ? { requestId } : {}),
        method: req.method,
        path: pathOf(req),
        status: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
        ...(userId !== undefined ? { userId } : {}),
        // Express's own trust-proxy-aware resolution (`common/trust-proxy.ts` configures
        // `app.set('trust proxy', ...)`), not a raw header — unconfigured, this is always the
        // TCP peer, immune to a client-supplied X-Forwarded-For. Never undefined for a real
        // socket connection, so unlike userId/requestId it is not conditionally omitted.
        ip: req.ip ?? 'unknown',
      };

      write(JSON.stringify(line));
    });

    next();
  };
}
