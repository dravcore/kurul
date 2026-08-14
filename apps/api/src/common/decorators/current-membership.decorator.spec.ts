import type { ExecutionContext } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { CurrentMembership } from './current-membership.decorator';
import { getParamDecoratorFactory } from './decorator-test-helpers';
import type { AuthedRequest, WorkspaceMembership } from '../types/request-context';

function mockContext(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function membership(): WorkspaceMembership {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
    workspaceId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50',
    userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53',
    role: MemberRole.ADMIN,
  };
}

describe('@CurrentMembership', () => {
  const factory = getParamDecoratorFactory<WorkspaceMembership>(CurrentMembership);

  it('returns the membership WorkspaceGuard resolved onto the request', () => {
    const request = { membership: membership() };

    expect(factory(undefined, mockContext(request))).toBe(request.membership);
  });

  /**
   * `WorkspaceMemberService.removeMember`/`updateMemberRole`/`leave` trust `membership.role`
   * for the last-OWNER and role-hierarchy checks (`workspace-member.service.ts`) — every one of
   * those checks is void if a handler could ever be called with a membership that silently
   * defaulted to `undefined`. Throwing here makes a controller wired without `WorkspaceGuard`
   * fail loudly instead of handing that undefined straight into an authorization decision.
   */
  it('throws instead of handing a controller an undefined membership', () => {
    expect(() => factory(undefined, mockContext({}))).toThrow(
      'CurrentMembership used without WorkspaceGuard',
    );
  });
});
