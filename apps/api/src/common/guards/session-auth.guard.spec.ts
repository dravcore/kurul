import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from './session-auth.guard';
import { auth } from '../../auth/auth';
import type { AuthedRequest } from '../types/request-context';

// `auth.ts` opens a Postgres pool at import time (see `workspace.service.spec.ts` for the same
// note) — this guard only ever calls `auth.api.getSession`, so that is the only surface mocked.
jest.mock('../../auth/auth', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

const api = auth.api as unknown as { getSession: jest.Mock };

function buildGuard(isPublic: boolean | undefined): SessionAuthGuard {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  return new SessionAuthGuard(reflector);
}

function mockContext(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
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
});
