import type { INestApplication } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { PLAN_LIMIT_ERROR } from '@kurul/shared-types';
import { REQUEST_BODY_TOO_LARGE_MESSAGE } from '../common/filters/all-exceptions.filter';
import { getRequestId } from '../common/logging/request-id';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { boundStreamedBody, declaresOversizedBody } from './auth-body-limit';
import { auth } from './auth';
import { isBlockedOrganizationMutation } from './organization-http-firewall';

/**
 * The one Better Auth route that creates an account.
 *
 * Checked by path rather than in a `databaseHooks.user.create.before` hook, and that is a
 * trade with a trigger. The hook would cover every account-creating path there could ever be,
 * but it can only refuse by throwing Better Auth's own `APIError`, whose body is not the error
 * envelope every other refusal in this API produces, and `docs/api-conventions.md` says there
 * is exactly one error format. Refusing at the mount keeps the envelope, next to the
 * organization firewall that already refuses here for the same architectural reason.
 *
 * **Trigger to move it into the database hook:** the first additional sign-up path (a social
 * provider, a magic link, anything that mints a `User` row without passing through here).
 * `emailAndPassword` is the only one enabled today (`auth.ts`), so today the two placements
 * cover exactly the same set of requests.
 */
const SIGN_UP_PATH = '/auth/sign-up/email';

function isSignUpRequest(req: Request): boolean {
  return req.method === 'POST' && (req.path.split('?')[0] ?? req.path) === SIGN_UP_PATH;
}

/**
 * Writes the error envelope the exception filter would have produced.
 *
 * By hand because no exception filter is listening below the Nest router, which is the reason
 * the organization firewall above writes its own. It carries the fields the filter would have
 * produced, `requestId` included: `requestIdMiddleware` runs above this mount, so the id in the
 * response body is the id in the `X-Request-Id` header and in the access log line.
 */
function refuse(
  req: Request,
  res: Response,
  statusCode: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  const requestId = getRequestId(req);
  res.status(statusCode).json({
    statusCode,
    error,
    message,
    ...extra,
    path: req.url,
    timestamp: new Date().toISOString(),
    ...(requestId === undefined ? {} : { requestId }),
  });
}

/** Mount Better Auth on the underlying Express instance (escape hatch from ADR 0004). */
export function mountBetterAuth(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  const authHandler = toNodeHandler(auth);
  const planLimits = app.get(PlanLimitsService);

  // Express 5 requires a named wildcard; braces also match the bare `/auth` base.
  expressApp.all('/auth/{*splat}', (req, res) => {
    // The API half of the `/auth/*` body ceiling, ahead of everything that could read the
    // stream. The `REQUEST_BODY_MAX_BYTES` parsers in `configure-app.ts` are registered below
    // this mount and never see these requests, and Better Auth reads the raw stream itself, so
    // without this check a sign-in body of any size streamed into the heap. A declared length
    // is refused here with the same envelope those parsers produce, before a byte of the body
    // is read; the length-less (chunked) case is bounded in `handle` below, once Better Auth
    // has taken the stream. See `auth-body-limit.ts` for the number and the reasoning.
    //
    // Answering before the body has arrived leaves the rest of it on the wire. Node reads and
    // discards it for us, so a client that keeps the connection (every browser, `fetch`, curl)
    // reads this envelope. A client that asked for `Connection: close` can instead see the
    // connection drop mid-upload, because Node closes the socket as soon as the response
    // finishes on a connection the client itself said it would not reuse. Draining a body of
    // any size to make that case uniform is the cost this check exists to refuse.
    if (declaresOversizedBody(req)) {
      refuse(
        req,
        res,
        413,
        STATUS_CODES[413] ?? 'Payload Too Large',
        REQUEST_BODY_TOO_LARGE_MESSAGE,
      );
      return;
    }

    if (isBlockedOrganizationMutation(req.path)) {
      res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Organization mutations must use the Nest workspace API (/workspaces).',
      });
      return;
    }

    void handle(req, res);
  });

  /**
   * The account ceiling, refused before Better Auth writes a row (ADR 0032).
   *
   * A ceiling refuses **sign-up only**. Signing in, verifying an address and every other
   * `/auth/*` route stay open at any count: an instance that has just been lowered below its
   * own user count must not lock out the people already on it.
   */
  async function handle(req: Request, res: Response): Promise<void> {
    if (isSignUpRequest(req)) {
      const refusal = await planLimits.signUpRefusal();
      if (refusal !== null) {
        refuse(req, res, 403, PLAN_LIMIT_ERROR, 'This instance is not accepting new accounts', {
          planLimit: refusal,
        });
        return;
      }
    }

    // Order matters: the auth handler takes the stream first, then the byte counter joins it.
    // `boundStreamedBody` explains why the other order would starve Better Auth's reader.
    const pending = authHandler(req, res);
    boundStreamedBody(req);
    await pending;
  }
}
