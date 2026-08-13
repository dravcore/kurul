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
 * which belongs in a log aggregator. What is here is the minimum needed to answer "which
 * request, how did it end, how long did it take, and who made it".
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
 * The path without its query string. Filters travel in the query (`?assigneeId=`, `?q=`), and
 * a search term is user content — the route is what an access log is actually for.
 */
function pathOf(req: Request): string {
  const url = req.originalUrl !== undefined && req.originalUrl !== '' ? req.originalUrl : req.url;
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
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
      };

      write(JSON.stringify(line));
    });

    next();
  };
}
