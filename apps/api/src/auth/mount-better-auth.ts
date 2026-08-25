import type { INestApplication } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { PLAN_LIMIT_ERROR, SIGNUP_DISABLED_ERROR, type PlanLimitDetail } from '@kurul/shared-types';
import { getRequestId } from '../common/logging/request-id';
import { DEMO_RESTRICTED_MESSAGE } from '../demo/demo-restricted.guard';
import { demoModeEnabled } from '../demo/demo-mode';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { auth } from './auth';
import { isBlockedOrganizationMutation } from './organization-http-firewall';
import { signUpEnabled } from './sign-up-policy';

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
 *
 * The same trade bounds what the `SIGNUP_ENABLED` switch can be: the mount runs ahead of the
 * body parsers (`configure-app.ts`) and never sees the sign-up email, so "closed unless a
 * pending invitation names the address" cannot be decided here. That mode belongs in the
 * database hook, and adding it is the second trigger to move.
 */
const SIGN_UP_PATH = '/auth/sign-up/email';

/**
 * The Better Auth routes a demo refuses, for the reason `DemoRestrictedGuard` states: they take
 * the shared account away from every other visitor, and the reset is not a recovery path.
 *
 * `change-password` is the live one: the demo's password is published, so the "current
 * password" Better Auth asks for is public and one successful request locks everybody out
 * until the reset writes `DEMO_PASSWORD` back. `change-email` is refused by Better Auth itself
 * on every instance today (`user.changeEmail` is not enabled in `auth.ts`), and is listed here
 * so that switching the option on does not silently open it on the demo. The guard's comment
 * carries the list of what is deliberately *not* here.
 */
const DEMO_RESTRICTED_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/auth/change-password',
  '/auth/change-email',
]);

function pathWithoutQuery(req: Request): string {
  return req.path.split('?')[0] ?? req.path;
}

export function isSignUpRequest(req: Request): boolean {
  return req.method === 'POST' && pathWithoutQuery(req) === SIGN_UP_PATH;
}

export function isDemoRestrictedAuthRequest(req: Request): boolean {
  return req.method === 'POST' && DEMO_RESTRICTED_AUTH_PATHS.has(pathWithoutQuery(req));
}

/** What a refusal below the Nest router says, beyond the fields the envelope always carries. */
interface Refusal {
  error: string;
  message: string;
  planLimit?: PlanLimitDetail;
}

/**
 * Writes the `403` envelope by hand.
 *
 * By hand because no exception filter is listening below the Nest router, which is the reason
 * the organization firewall writes its own. It carries the fields the filter would have
 * produced, `requestId` included: `requestIdMiddleware` runs above this mount, so the id in
 * the response body is the id in the `X-Request-Id` header and in the access log line.
 */
function refuse(req: Request, res: Response, refusal: Refusal): void {
  const requestId = getRequestId(req);
  res.status(403).json({
    statusCode: 403,
    error: refusal.error,
    message: refusal.message,
    ...(refusal.planLimit === undefined ? {} : { planLimit: refusal.planLimit }),
    path: req.url,
    timestamp: new Date().toISOString(),
    ...(requestId === undefined ? {} : { requestId }),
  });
}

/**
 * The per-request half of the mount, built apart from the Express wiring so a unit test can
 * drive it with a fake request and a fake Better Auth handler.
 *
 * Three refusals live here, in the order they are cheapest to answer:
 *
 * 1. **Demo lock-out.** `POST /auth/change-password` on a demo instance, refused with the
 *    same envelope `DemoRestrictedGuard` produces for the two Nest routes on its list.
 * 2. **Registration closed.** `SIGNUP_ENABLED=false` refuses sign-up before anything is
 *    counted; a closed door needs no head count.
 * 3. **The account ceiling** (ADR 0032), refused before Better Auth writes a row.
 *
 * Every one of them refuses **sign-up or the one named route only**. Signing in, verifying an
 * address and every other `/auth/*` route stay open whatever the switches say: an instance
 * that has just closed registration, or been lowered below its own user count, must not lock
 * out the people already on it.
 */
export function createAuthRequestHandler(
  planLimits: Pick<PlanLimitsService, 'signUpRefusal'>,
  authHandler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    if (isDemoRestrictedAuthRequest(req) && demoModeEnabled()) {
      refuse(req, res, { error: 'Forbidden', message: DEMO_RESTRICTED_MESSAGE });
      return;
    }

    if (isSignUpRequest(req)) {
      if (!signUpEnabled()) {
        refuse(req, res, {
          error: SIGNUP_DISABLED_ERROR,
          message: 'Sign-up is disabled on this instance',
        });
        return;
      }

      const refusal = await planLimits.signUpRefusal();
      if (refusal !== null) {
        refuse(req, res, {
          error: PLAN_LIMIT_ERROR,
          message: 'This instance is not accepting new accounts',
          planLimit: refusal,
        });
        return;
      }
    }

    await authHandler(req, res);
  };
}

/** Mount Better Auth on the underlying Express instance (escape hatch from ADR 0004). */
export function mountBetterAuth(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  const handle = createAuthRequestHandler(app.get(PlanLimitsService), toNodeHandler(auth));

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
}
