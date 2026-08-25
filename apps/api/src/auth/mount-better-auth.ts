import { Logger, type INestApplication } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { PLAN_LIMIT_ERROR, SIGNUP_DISABLED_ERROR, type PlanLimitDetail } from '@kurul/shared-types';
import { isProductionEnv } from '../common/env';
import { getRequestId } from '../common/logging/request-id';
import { captureServerError } from '../common/observability/sentry';
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

const logger = new Logger('BetterAuthMount');

/**
 * The two switches this mount refuses on, resolved once and written to the boot log.
 *
 * Called for its throw as much as for its line. `envBool` refuses a spelling it cannot read as
 * a boolean, and both switches are otherwise read only inside the request handler below, where
 * no exception filter is listening: `SIGNUP_ENABLED=fasle` would leave the very route the
 * switch exists to close hanging with no response at all, and take the process down with an
 * unhandled rejection. Reading them here, at bootstrap, turns an operator's typo back into what
 * it should be, a container that refuses to start, which is the bargain
 * `PlanLimitsService.onModuleInit` already makes for `PLAN_MAX_*` and `ATTACHMENT_MAX_BYTES`.
 *
 * The values are described, not cached. Every read below stays live, which is what lets a test
 * flip either variable around a single request instead of rebuilding the container.
 */
function describeAuthMountPolicy(): string {
  return `Auth mount policy: signUpEnabled=${signUpEnabled()} demoMode=${demoModeEnabled()}`;
}

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
 * Answers a handler that threw with the `500` envelope, by hand.
 *
 * Nothing above catches it. `mountBetterAuth` hands the handler straight to Express, so a
 * rejected promise there is an unhandled rejection: the socket never gets a response, and under
 * Node's default `--unhandled-rejections=throw` the process exits with it. `AllExceptionsFilter`
 * only ever sees faults inside the Nest router, so this reproduces the envelope it would have
 * written for the same fault one layer up, exactly as `refuse` reproduces the `403`.
 *
 * The message follows the filter's rule too: the cause is published outside production and
 * withheld inside it, so a deployed instance never leaks an internal string to a caller.
 *
 * `headersSent` means Better Auth already answered and then failed on the way out. There is no
 * envelope left to write at that point, so the response is only ended, which is still the
 * difference between a closed socket and a hung one.
 */
function failClosed(req: Request, res: Response, cause: unknown): void {
  const requestId = getRequestId(req);
  const error =
    cause instanceof Error ? cause : new Error(`Non-Error exception thrown: ${String(cause)}`);
  const suffix = requestId === undefined ? '' : ` (requestId=${requestId})`;
  logger.error(`${error.message}${suffix}`, error.stack);
  captureServerError(error, {
    ...(requestId === undefined ? {} : { requestId }),
    ...(typeof req.method === 'string' ? { method: req.method } : {}),
    ...(typeof req.url === 'string' ? { path: req.url } : {}),
    statusCode: 500,
  });

  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(500).json({
    statusCode: 500,
    error: 'Internal Server Error',
    message: isProductionEnv() ? 'An unexpected error occurred' : error.message,
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
 *
 * Rejecting is allowed: `mountBetterAuth` answers a thrown handler with `failClosed`, so the
 * head count query failing on a dead database is a `500` and not a hung socket.
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

  // Before anything is wired: `describeAuthMountPolicy` reads both switches, and a malformed
  // one throws out of `bootstrap()` rather than out of a request nobody is catching.
  logger.log(describeAuthMountPolicy());

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

    handle(req, res).catch((cause: unknown) => {
      failClosed(req, res, cause);
    });
  });
}
