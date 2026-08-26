import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

/**
 * The largest request body the `/auth/*` mount accepts, in bytes: 64 KiB.
 *
 * Better Auth reads the raw request stream itself (ADR 0004), below the JSON and urlencoded
 * parsers that enforce `REQUEST_BODY_MAX_BYTES` on every Nest route (`configure-app.ts`), so
 * that ceiling never applied here: a `POST /auth/sign-in/email` was read to completion no
 * matter how large it was. Better Auth's own rate limiter bounds the *count* of such requests
 * (3 per 10 s per IP and path on sign-in, sign-up and change-password, 100 per 60 s on the
 * other auth routes), not their size, and eighteen unbounded bodies a minute is enough to
 * exhaust a container running with `--max-old-space-size=384`.
 *
 * **Why 64 KiB.** Every body Better Auth reads on this instance is a small JSON object: an
 * e-mail address, a password, a display name, a token. The largest legitimate one is a few
 * hundred bytes, so 64 KiB is two orders of magnitude of headroom, and still small enough that
 * the built-in attempt budget cannot be turned into a memory budget.
 *
 * **Why a constant and not an environment variable.** `REQUEST_BODY_MAX_BYTES` is tunable
 * because the Trello import will one day POST a real board export. Nothing comparable is on
 * the horizon for the auth routes, and a knob nobody turns is a knob that drifts from the
 * proxy figure it has to agree with. `docker/Caddyfile` carries the same number as
 * `request_body max_size` on `handle /auth/*`, `docs/self-hosting.md` as the nginx
 * `client_max_body_size` for `location /auth/`, and `storage/two-layer-limit.spec.ts` fails the
 * build if any of the three moves without the others. Unlike the `/api/*` pair, the proxy and
 * the API may be *equal* here: an auth body has no multipart envelope, so both layers count the
 * same bytes and the ordering rule (the proxy must never reject something the API would accept)
 * holds at equality.
 */
export const AUTH_BODY_MAX_BYTES = 65_536;

/**
 * The body length a request declares, or `null` when it declares none.
 *
 * `null` is the chunked case (`Transfer-Encoding: chunked`, no `Content-Length`), and also a
 * body-less request. Node's parser has already refused a malformed `Content-Length` with a
 * 400 before this runs, so the only non-integer that can arrive is the header's absence.
 */
export function declaredBodyBytes(req: Pick<IncomingMessage, 'headers'>): number | null {
  const raw = req.headers['content-length'];
  if (raw === undefined) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** True when the request announces a body larger than {@link AUTH_BODY_MAX_BYTES}. */
export function declaresOversizedBody(
  req: Pick<IncomingMessage, 'headers'>,
  maxBytes: number = AUTH_BODY_MAX_BYTES,
): boolean {
  const declared = declaredBodyBytes(req);
  return declared !== null && declared > maxBytes;
}

/** The error a streamed body is cut with, so a log line or a test can tell it from a client reset. */
export class AuthBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeded the ${maxBytes}-byte ceiling on /auth/*`);
    this.name = 'AuthBodyTooLargeError';
  }
}

/**
 * Bounds a body whose length was not declared ahead of time.
 *
 * A `Content-Length` over the ceiling is refused with a 413 before a byte is read (see
 * `mount-better-auth.ts`). A chunked body offers no such number, so the only way to bound it
 * is to count the bytes as they arrive, and by the time the count crosses the ceiling Better
 * Auth already owns the stream and may already be parsing it. There is no envelope to answer
 * with at that point that both layers would agree on, so the guard does the one thing that is
 * unambiguous: it destroys the request, which closes the connection and errors the stream
 * Better Auth is reading, so its handler settles instead of waiting on a body that will never
 * end. The reverse proxy in front of a shipped instance cuts such a body at the same figure
 * (`request_body max_size` on `handle /auth/*`) and is the layer that answers it with a
 * status; this guard is what keeps an instance exposed *without* that proxy bounded too.
 *
 * It is a second `data` listener beside Better Auth's own, so it must be attached **after**
 * the auth handler has taken the stream: a `data` listener switches a Readable to flowing
 * mode, and one attached first would drain chunks into nothing before Better Auth's reader
 * existed. `better-call`'s node adapter registers its listener synchronously inside
 * `toNodeHandler`, before its first `await`, which is what makes "call the handler, then
 * attach this" a safe order. `test/auth.e2e-spec.ts` pins both halves: a normal sign-in still
 * succeeds (the reader was not starved) and a chunked body past the ceiling is cut.
 *
 * `destroy` is always given the error, but it only reaches listeners that exist: Node's
 * `IncomingMessage` swallows it when nobody is listening, and the no-op listener registered
 * here guarantees the same for any other Readable, so a request Better Auth declined to read
 * (no `Content-Type`, for instance) cannot turn the cut into an uncaught `'error'` event.
 */
export function boundStreamedBody(req: Readable, maxBytes: number = AUTH_BODY_MAX_BYTES): void {
  let received = 0;
  req.on('data', (chunk: Buffer | string) => {
    received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    if (received > maxBytes && !req.destroyed) {
      req.once('error', () => undefined);
      req.destroy(new AuthBodyTooLargeError(maxBytes));
    }
  });
}
