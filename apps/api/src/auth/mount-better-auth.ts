import type { INestApplication } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { PLAN_LIMIT_ERROR } from '@kurul/shared-types';
import { getRequestId } from '../common/logging/request-id';
import { PlanLimitsService } from '../plan/plan-limits.service';
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

/** Mount Better Auth on the underlying Express instance (escape hatch from ADR 0004). */
export function mountBetterAuth(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  const authHandler = toNodeHandler(auth);
  const planLimits = app.get(PlanLimitsService);

  // Express 5 requires a named wildcard; braces also match the bare `/auth` base.
  expressApp.all('/auth/{*splat}', (req, res) => {
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
   * The envelope is written by hand because no exception filter is listening below the Nest
   * router, which is the reason the organization firewall above writes its own. It carries the
   * fields the filter would have produced, `requestId` included: `requestIdMiddleware` runs
   * above this mount, so the id in the response body is the id in the `X-Request-Id` header
   * and in the access log line.
   *
   * A ceiling refuses **sign-up only**. Signing in, verifying an address and every other
   * `/auth/*` route stay open at any count: an instance that has just been lowered below its
   * own user count must not lock out the people already on it.
   */
  async function handle(req: Request, res: Response): Promise<void> {
    if (isSignUpRequest(req)) {
      const refusal = await planLimits.signUpRefusal();
      if (refusal !== null) {
        const requestId = getRequestId(req);
        res.status(403).json({
          statusCode: 403,
          error: PLAN_LIMIT_ERROR,
          message: 'This instance is not accepting new accounts',
          planLimit: refusal,
          path: req.url,
          timestamp: new Date().toISOString(),
          ...(requestId === undefined ? {} : { requestId }),
        });
        return;
      }
    }

    await authHandler(req, res);
  }
}
