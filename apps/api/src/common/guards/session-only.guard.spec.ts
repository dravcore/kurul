import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SessionOnlyGuard } from './session-only.guard';
import type { AuthedRequest } from '../types/request-context';

function mockContext(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SessionOnlyGuard', () => {
  it('admits a cookie session', () => {
    expect(new SessionOnlyGuard().canActivate(mockContext({}))).toBe(true);
  });

  it('refuses a request that authenticated with a personal access token', () => {
    expect(() =>
      new SessionOnlyGuard().canActivate(
        mockContext({ accessToken: { id: 't1', workspaceId: 'w1' } }),
      ),
    ).toThrow(ForbiddenException);
  });
});
