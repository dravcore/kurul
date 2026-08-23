import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from './session-auth.guard';
import { auth } from '../../auth/auth';
import type { TokenService } from '../../token/token.service';
import type { AuthedRequest } from '../types/request-context';

// note) — this guard only ever calls `auth.api.getSession`, so that is the only surface mocked.
jest.mock('../../auth/auth', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

const api = auth.api as unknown as { getSession: jest.Mock };

const tokenService = { resolve: jest.fn() };

function buildGuard(isPublic: boolean | undefined): SessionAuthGuard {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  return new SessionAuthGuard(reflector, tokenService as unknown as TokenService);
}

function mockContext(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const TOKEN_USER = {
  id: 'u1',
  email: 'member@example.com',
  name: 'Member',
  avatarUrl: null,
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function tokenRequest(
  authorization: string,
  params: Record<string, string> = { workspaceId: 'w1' },
): Partial<AuthedRequest> {
  return { headers: { authorization }, params } as unknown as Partial<AuthedRequest>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

/**
 * `SessionAuthGuard` is the one gate every non-`@Public()` route in the app sits behind —
 * `RolesGuard` and `WorkspaceGuard` both assume `request.user` is already populated by the time
 * they run. A regression here is not "one endpoint breaks", it is "authentication silently stops
 * being enforced", which is exactly why the audit flagged this file at 0% coverage.
 */
describe('SessionAuthGuard', () => {
  it('skips the session lookup entirely for a @Public() route', async () => {
    const guard = buildGuard(true);

    await expect(guard.canActivate(mockContext({}))).resolves.toBe(true);
    expect(api.getSession).not.toHaveBeenCalled();
  });

  it('rejects a request with no session', async () => {
    api.getSession.mockResolvedValue(null);
    const guard = buildGuard(undefined);

    await expect(
      guard.canActivate(mockContext({ headers: {} } as Partial<AuthedRequest>)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a session with no user attached', async () => {
    api.getSession.mockResolvedValue({ session: { id: 's1' }, user: undefined });
    const guard = buildGuard(undefined);

    await expect(
      guard.canActivate(mockContext({ headers: {} } as Partial<AuthedRequest>)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves the session user onto the request and allows the request through', async () => {
    api.getSession.mockResolvedValue({
      session: { id: 's1' },
      user: {
        id: 'u1',
        email: 'member@example.com',
        name: 'Member',
        image: 'https://example.com/avatar.png',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const guard = buildGuard(undefined);
    const request: Partial<AuthedRequest> = { headers: {} } as Partial<AuthedRequest>;

    await expect(guard.canActivate(mockContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'u1',
      email: 'member@example.com',
      name: 'Member',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(request.accessToken).toBeUndefined();
  });

  it('maps a missing image to null rather than leaving it undefined', async () => {
    api.getSession.mockResolvedValue({
      session: { id: 's1' },
      user: {
        id: 'u1',
        email: 'member@example.com',
        name: 'Member',
        image: null,
        emailVerified: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const guard = buildGuard(undefined);
    const request: Partial<AuthedRequest> = { headers: {} } as Partial<AuthedRequest>;

    await guard.canActivate(mockContext(request));
    expect(request.user?.avatarUrl).toBeNull();
  });

  /**
   * The second credential. Every case below shares one property: once an `Authorization`
   * header is present the cookie is never consulted, so `getSession` must not be called.
   */
  describe('with a personal access token', () => {
    it('resolves the token user and pins the request to the token workspace', async () => {
      tokenService.resolve.mockResolvedValue({ id: 't1', workspaceId: 'w1', user: TOKEN_USER });
      const guard = buildGuard(undefined);
      const request = tokenRequest('Bearer kurul_pat_secret');

      await expect(guard.canActivate(mockContext(request))).resolves.toBe(true);
      expect(tokenService.resolve).toHaveBeenCalledWith('kurul_pat_secret');
      expect(request.user).toEqual(TOKEN_USER);
      expect(request.accessToken).toEqual({ id: 't1', workspaceId: 'w1' });
      expect(api.getSession).not.toHaveBeenCalled();
    });

    it('answers 401 for a token the service does not recognise', async () => {
      tokenService.resolve.mockResolvedValue(null);
      const guard = buildGuard(undefined);

      await expect(
        guard.canActivate(mockContext(tokenRequest('Bearer kurul_pat_unknown'))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(api.getSession).not.toHaveBeenCalled();
    });

    /**
     * A Bearer credential that is not ours is still a Bearer credential: the client asked to
     * be identified by it, and quietly falling back to a cookie it also happened to send would
     * run the request as somebody the script author never meant.
     */
    it('answers 401 for a Bearer header that is not a Kurul token, without consulting the cookie', async () => {
      api.getSession.mockResolvedValue({ session: { id: 's1' }, user: { id: 'u1' } });
      const guard = buildGuard(undefined);

      await expect(
        guard.canActivate(mockContext(tokenRequest('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokenService.resolve).not.toHaveBeenCalled();
      expect(api.getSession).not.toHaveBeenCalled();
    });

    it('answers 404 when the route addresses a workspace other than the token workspace', async () => {
      tokenService.resolve.mockResolvedValue({ id: 't1', workspaceId: 'w1', user: TOKEN_USER });
      const guard = buildGuard(undefined);
      const request = tokenRequest('Bearer kurul_pat_secret', { workspaceId: 'w2' });

      await expect(guard.canActivate(mockContext(request))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(request.user).toBeUndefined();
    });

    it('answers 403 on a route with no workspace in its path', async () => {
      tokenService.resolve.mockResolvedValue({ id: 't1', workspaceId: 'w1', user: TOKEN_USER });
      const guard = buildGuard(undefined);
      const request = tokenRequest('Bearer kurul_pat_secret', {});

      await expect(guard.canActivate(mockContext(request))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(request.user).toBeUndefined();
    });
  });
});
