import { Logger, type INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PLAN_LIMIT_ERROR, PlanLimitCode, SIGNUP_DISABLED_ERROR } from '@kurul/shared-types';
import { DEMO_MODE_ENV } from '../demo/demo-mode';
import { DEMO_RESTRICTED_MESSAGE } from '../demo/demo-restricted.guard';
import {
  createAuthRequestHandler,
  isDemoRestrictedAuthRequest,
  isSignUpRequest,
  mountBetterAuth,
} from './mount-better-auth';
import { SIGNUP_ENABLED_ENV } from './sign-up-policy';

/**
 * The refusals the mount answers below the Nest router, driven with a fake request and a fake
 * Better Auth handler so each branch can be pinned without a database. What only the e2e suite
 * (`test/auth.e2e-spec.ts`) can answer is that the real stack agrees: that the refused sign-up
 * wrote no row, and that the refused password change left the hash alone.
 */
describe('createAuthRequestHandler', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function fakeRequest(method: string, url: string, requestId?: string): Request {
    return {
      method,
      url,
      path: url.split('?')[0],
      ...(requestId === undefined ? {} : { requestId }),
    } as unknown as Request;
  }

  function fakeResponse(): { res: Response; status: jest.Mock; json: jest.Mock } {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { res: { status } as unknown as Response, status, json };
  }

  function build(refusal: { code: PlanLimitCode; limit: number; current: number } | null = null) {
    const signUpRefusal = jest.fn().mockResolvedValue(refusal);
    const authHandler = jest.fn().mockResolvedValue(undefined);
    const handle = createAuthRequestHandler({ signUpRefusal }, authHandler);
    return { handle, signUpRefusal, authHandler };
  }

  describe('registration closed', () => {
    it('refuses sign-up with the envelope and counts nothing', async () => {
      process.env[SIGNUP_ENABLED_ENV] = 'false';
      const { handle, signUpRefusal, authHandler } = build();
      const { res, status, json } = fakeResponse();

      await handle(fakeRequest('POST', '/auth/sign-up/email', 'req-0000001'), res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({
        statusCode: 403,
        error: SIGNUP_DISABLED_ERROR,
        message: expect.any(String),
        path: '/auth/sign-up/email',
        timestamp: expect.any(String),
        requestId: 'req-0000001',
      });
      // A closed door needs no head count: the ceiling query is never issued.
      expect(signUpRefusal).not.toHaveBeenCalled();
      expect(authHandler).not.toHaveBeenCalled();
    });

    it('leaves sign-in and every other auth route open', async () => {
      process.env[SIGNUP_ENABLED_ENV] = 'false';
      const { handle, authHandler } = build();

      for (const [method, url] of [
        ['POST', '/auth/sign-in/email'],
        ['GET', '/auth/get-session'],
        ['POST', '/auth/verify-email'],
        ['POST', '/auth/sign-out'],
      ]) {
        const { res, status } = fakeResponse();
        await handle(fakeRequest(method, url), res);
        expect(status).not.toHaveBeenCalled();
      }
      expect(authHandler).toHaveBeenCalledTimes(4);
    });

    it('is unaffected by demo mode in either direction', async () => {
      const { handle, authHandler } = build();

      // A demo keeps registration open: DEMO_MODE alone never closes the door.
      process.env[DEMO_MODE_ENV] = 'true';
      delete process.env[SIGNUP_ENABLED_ENV];
      const open = fakeResponse();
      await handle(fakeRequest('POST', '/auth/sign-up/email'), open.res);
      expect(open.status).not.toHaveBeenCalled();
      expect(authHandler).toHaveBeenCalledTimes(1);

      // And a demo does not force it open either: the switch is read on its own.
      process.env[SIGNUP_ENABLED_ENV] = 'false';
      const closed = fakeResponse();
      await handle(fakeRequest('POST', '/auth/sign-up/email'), closed.res);
      expect(closed.status).toHaveBeenCalledWith(403);
      expect(authHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('the account ceiling', () => {
    it('refuses sign-up with the plan-limit envelope once the switch has let it through', async () => {
      delete process.env[SIGNUP_ENABLED_ENV];
      const detail = { code: PlanLimitCode.Users, limit: 1, current: 1 };
      const { handle, authHandler } = build(detail);
      const { res, status, json } = fakeResponse();

      await handle(fakeRequest('POST', '/auth/sign-up/email', 'req-0000002'), res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          error: PLAN_LIMIT_ERROR,
          planLimit: detail,
          path: '/auth/sign-up/email',
          requestId: 'req-0000002',
        }),
      );
      expect(authHandler).not.toHaveBeenCalled();
    });

    it('hands sign-up to Better Auth when nothing refuses it', async () => {
      delete process.env[SIGNUP_ENABLED_ENV];
      const { handle, signUpRefusal, authHandler } = build();
      const { res, status } = fakeResponse();
      const req = fakeRequest('POST', '/auth/sign-up/email');

      await handle(req, res);

      expect(signUpRefusal).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
      expect(authHandler).toHaveBeenCalledWith(req, res);
    });
  });

  describe('the demo lock-out', () => {
    it('refuses a password change on a demo with the guard envelope', async () => {
      process.env[DEMO_MODE_ENV] = 'true';
      const { handle, authHandler } = build();
      const { res, status, json } = fakeResponse();

      await handle(fakeRequest('POST', '/auth/change-password', 'req-0000003'), res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({
        statusCode: 403,
        error: 'Forbidden',
        message: DEMO_RESTRICTED_MESSAGE,
        path: '/auth/change-password',
        timestamp: expect.any(String),
        requestId: 'req-0000003',
      });
      expect(authHandler).not.toHaveBeenCalled();
    });

    it('refuses change-email on the same rule, ready for the day the option is enabled', async () => {
      process.env[DEMO_MODE_ENV] = 'true';
      const { handle, authHandler } = build();
      const { res, status } = fakeResponse();

      await handle(fakeRequest('POST', '/auth/change-email'), res);

      expect(status).toHaveBeenCalledWith(403);
      expect(authHandler).not.toHaveBeenCalled();
    });

    it('lets a password change through on an ordinary instance', async () => {
      delete process.env[DEMO_MODE_ENV];
      const { handle, authHandler } = build();
      const { res, status } = fakeResponse();

      await handle(fakeRequest('POST', '/auth/change-password'), res);

      expect(status).not.toHaveBeenCalled();
      expect(authHandler).toHaveBeenCalledTimes(1);
    });

    /**
     * The guard's rule admits what is unrecoverable, not what is annoying: a revoked session
     * is a sign-in away and a renamed account is renamed back, so neither is refused.
     */
    it('leaves sign-in, sign-up, session revocation and update-user open on a demo', async () => {
      process.env[DEMO_MODE_ENV] = 'true';
      const { handle, authHandler } = build();

      for (const url of [
        '/auth/sign-in/email',
        '/auth/sign-up/email',
        '/auth/revoke-sessions',
        '/auth/update-user',
      ]) {
        const { res, status } = fakeResponse();
        await handle(fakeRequest('POST', url), res);
        expect(status).not.toHaveBeenCalled();
      }
      expect(authHandler).toHaveBeenCalledTimes(4);
    });
  });

  it('omits requestId when no middleware attached one', async () => {
    process.env[SIGNUP_ENABLED_ENV] = 'false';
    const { handle } = build();
    const { res, json } = fakeResponse();

    await handle(fakeRequest('POST', '/auth/sign-up/email'), res);

    expect(json.mock.calls[0][0]).not.toHaveProperty('requestId');
  });
});

describe('the path predicates', () => {
  function req(method: string, path: string): Request {
    return { method, path, url: path } as unknown as Request;
  }

  it('match the exact route and method, ignoring a query string', () => {
    expect(isSignUpRequest(req('POST', '/auth/sign-up/email'))).toBe(true);
    expect(isSignUpRequest(req('POST', '/auth/sign-up/email?x=1'))).toBe(true);
    expect(isSignUpRequest(req('GET', '/auth/sign-up/email'))).toBe(false);
    expect(isSignUpRequest(req('POST', '/auth/sign-in/email'))).toBe(false);

    expect(isDemoRestrictedAuthRequest(req('POST', '/auth/change-password'))).toBe(true);
    expect(isDemoRestrictedAuthRequest(req('POST', '/auth/change-password?x=1'))).toBe(true);
    expect(isDemoRestrictedAuthRequest(req('POST', '/auth/change-email'))).toBe(true);
    expect(isDemoRestrictedAuthRequest(req('GET', '/auth/change-password'))).toBe(false);
    expect(isDemoRestrictedAuthRequest(req('POST', '/auth/update-user'))).toBe(false);
  });
});

/**
 * The Express wiring, which is where the two things that have no filter above them live: the
 * boot-time read of the switches, and the answer to a handler that threw.
 */
describe('mountBetterAuth', () => {
  const original = { ...process.env };
  let logged: jest.SpyInstance;
  let reported: jest.SpyInstance;

  beforeEach(() => {
    // The mount writes its policy line and any fault through Nest's logger; neither belongs in
    // the test output, and the spies are what the boot case asserts on.
    logged = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    reported = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...original };
  });

  /**
   * Stands in for the Nest application: the Express instance whose `all` the mount registers on,
   * and the container it pulls `PlanLimitsService` out of. `get` ignores its token because the
   * mount asks for exactly one provider.
   */
  function fakeApp(planLimits: { signUpRefusal: jest.Mock }): {
    app: INestApplication;
    handlers: Array<(req: Request, res: Response) => void>;
  } {
    const handlers: Array<(req: Request, res: Response) => void> = [];
    const app = {
      getHttpAdapter: () => ({
        getInstance: () => ({
          all: (_path: string, handler: (req: Request, res: Response) => void) => {
            handlers.push(handler);
          },
        }),
      }),
      get: () => planLimits,
    } as unknown as INestApplication;
    return { app, handlers };
  }

  it('reads both switches at boot and refuses to start on a malformed one', () => {
    const { app } = fakeApp({ signUpRefusal: jest.fn() });

    process.env[SIGNUP_ENABLED_ENV] = 'fasle';
    expect(() => mountBetterAuth(app)).toThrow(/Invalid SIGNUP_ENABLED/);

    process.env[SIGNUP_ENABLED_ENV] = 'false';
    process.env[DEMO_MODE_ENV] = 'ture';
    expect(() => mountBetterAuth(app)).toThrow(/Invalid DEMO_MODE/);

    // Both readable: the mount starts and says which policy it is running.
    process.env[DEMO_MODE_ENV] = 'true';
    expect(() => mountBetterAuth(app)).not.toThrow();
    expect(logged).toHaveBeenCalledWith('Auth mount policy: signUpEnabled=false demoMode=true');
  });

  /**
   * The reason the boot read matters, and the belt to its braces: below the Nest router nothing
   * catches a rejection, so without this the caller waits on a socket that is never answered and
   * Node takes the process down with an unhandled rejection.
   */
  it('answers a rejected handler with the 500 envelope instead of leaking the rejection', async () => {
    delete process.env[SIGNUP_ENABLED_ENV];
    delete process.env[DEMO_MODE_ENV];
    const signUpRefusal = jest.fn().mockRejectedValue(new Error('the database is down'));
    const { app, handlers } = fakeApp({ signUpRefusal });

    mountBetterAuth(app);
    expect(handlers).toHaveLength(1);

    const json = jest.fn();
    const answered = new Promise<Record<string, unknown>>((resolve) => {
      json.mockImplementation((body: Record<string, unknown>) => resolve(body));
    });
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnValue({ json }),
      end: jest.fn(),
    } as unknown as Response;
    const req = {
      method: 'POST',
      url: '/auth/sign-up/email',
      path: '/auth/sign-up/email',
      requestId: 'req-0000004',
    } as unknown as Request;

    handlers[0]!(req, res);

    // Resolves only because the rejection was caught and turned into a response; an
    // unhandled rejection would leave this promise pending until the test times out.
    await expect(answered).resolves.toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'the database is down',
      path: '/auth/sign-up/email',
      timestamp: expect.any(String),
      requestId: 'req-0000004',
    });
    expect(reported).toHaveBeenCalledWith(
      'the database is down (requestId=req-0000004)',
      expect.any(String),
    );
  });

  /** Better Auth answered and then failed on the way out: no second envelope, but no hang. */
  it('only ends the response when the headers are already out', async () => {
    delete process.env[SIGNUP_ENABLED_ENV];
    delete process.env[DEMO_MODE_ENV];
    const signUpRefusal = jest.fn().mockRejectedValue(new Error('too late'));
    const { app, handlers } = fakeApp({ signUpRefusal });

    mountBetterAuth(app);

    const end = jest.fn();
    const ended = new Promise<void>((resolve) => {
      end.mockImplementation(() => resolve());
    });
    const status = jest.fn();
    const res = { headersSent: true, status, end } as unknown as Response;

    handlers[0]!(
      {
        method: 'POST',
        url: '/auth/sign-up/email',
        path: '/auth/sign-up/email',
      } as unknown as Request,
      res,
    );

    await expect(ended).resolves.toBeUndefined();
    expect(status).not.toHaveBeenCalled();
  });
});
