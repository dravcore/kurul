import type { Request, Response } from 'express';
import { PLAN_LIMIT_ERROR, PlanLimitCode, SIGNUP_DISABLED_ERROR } from '@kurul/shared-types';
import { DEMO_MODE_ENV } from '../demo/demo-mode';
import { DEMO_RESTRICTED_MESSAGE } from '../demo/demo-restricted.guard';
import {
  createAuthRequestHandler,
  isDemoRestrictedAuthRequest,
  isSignUpRequest,
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
