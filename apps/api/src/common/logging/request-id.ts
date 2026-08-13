import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';

/**
 * Correlation id header. `X-Request-Id` is the de-facto spelling used by reverse proxies and
 * load balancers, so an id minted upstream (nginx, Traefik, a cloud LB) flows straight
 * through instead of the API inventing a competing one.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * A request id is echoed back in a response header, written into logs, and returned inside
 * the error envelope, so an inbound value is only trusted when it is unmistakably inert:
 * URL/header-safe characters only, and short enough that a client cannot use the header as
 * free log storage. Anything else (header injection attempts, a comma-joined duplicate
 * header, a megabyte of text) is discarded and replaced by a freshly generated id — the
 * request still gets correlated, just not with an id the caller chose.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._~-]{8,128}$/;

/** Express request with the correlation id attached by {@link requestIdMiddleware}. */
export type RequestWithId = Request & { requestId?: string };

/** Returns the inbound header value when it is safe to reuse, otherwise `undefined`. */
export function sanitizeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value) ? value : undefined;
}

/** Reads the id an earlier middleware attached, without assuming the middleware ran. */
export function getRequestId(request: unknown): string | undefined {
  return typeof request === 'object' && request !== null
    ? sanitizeRequestId((request as RequestWithId).requestId)
    : undefined;
}

/**
 * Assigns every request a correlation id: reuse a safe inbound `X-Request-Id`, otherwise
 * mint a UUIDv7 (the id shape used everywhere else in the product, and time-ordered, so log
 * lines sort by it). The id is attached to the request for downstream consumers (access log,
 * exception filter) and echoed on the response so a client — or a user pasting a failure
 * into an issue — can name the exact request.
 *
 * Written as a plain Express middleware rather than a Nest one because it must also cover the
 * Better Auth mount, which bypasses the Nest router entirely (ADR 0004 escape hatch).
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = sanitizeRequestId(req.headers['x-request-id']) ?? uuidv7();

  (req as RequestWithId).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
