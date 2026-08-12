import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@kurultay/shared-types';
import { RolesGuard } from './roles.guard';
import type { AuthedRequest } from '../types/request-context';

function mockContext(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(mockContext({}))).toBe(true);
  });

  it('allows when membership role is listed', () => {
    const reflector = {
      getAllAndOverride: () => [MemberRole.OWNER, MemberRole.ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(
      guard.canActivate(
        mockContext({
          membership: {
            id: 'm1',
            workspaceId: 'w1',
            userId: 'u1',
            role: MemberRole.ADMIN,
          },
        }),
      ),
    ).toBe(true);
  });

  it('forbids when membership role is insufficient', () => {
    const reflector = {
      getAllAndOverride: () => [MemberRole.OWNER],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() =>
      guard.canActivate(
        mockContext({
          membership: {
            id: 'm1',
            workspaceId: 'w1',
            userId: 'u1',
            role: MemberRole.GUEST,
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
