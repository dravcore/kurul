import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { MemberRole } from '@kurul/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceGuard } from './workspace.guard';
import type { AuthedRequest, AuthenticatedUser } from '../types/request-context';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';

function user(): AuthenticatedUser {
  return {
    id: USER_ID,
    email: 'member@example.com',
    name: 'Member',
    avatarUrl: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01'),
  };
}

/** The guard only ever reads `params`, `user` and writes `membership`. */
function mockRequest(overrides: Partial<AuthedRequest> = {}): AuthedRequest {
  return {
    params: { workspaceId: WORKSPACE_ID },
    user: user(),
    ...overrides,
  } as AuthedRequest;
}

function mockContext(request: AuthedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(membership: unknown) {
  const findUnique = jest.fn().mockResolvedValue(membership);
  const prisma = { workspaceMember: { findUnique } } as unknown as PrismaService;
  return { guard: new WorkspaceGuard(prisma), findUnique };
}

describe('WorkspaceGuard', () => {
  it('resolves the membership onto the request', async () => {
    const { guard, findUnique } = buildGuard({
      id: 'm1',
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      role: MemberRole.MEMBER,
    });
    const request = mockRequest();

    await expect(guard.canActivate(mockContext(request))).resolves.toBe(true);

    expect(findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: USER_ID } },
    });
    expect(request.membership).toEqual({
      id: 'm1',
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      role: MemberRole.MEMBER,
    });
  });

  it('rejects a non-member with 404 rather than 403', async () => {
    const { guard } = buildGuard(null);

    // A 403 would confirm the workspace exists to someone who cannot see it.
    await expect(guard.canActivate(mockContext(mockRequest()))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a membership row whose role is not a known MemberRole', async () => {
    const { guard } = buildGuard({
      id: 'm1',
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      role: 'SUPERUSER',
    });
    const request = mockRequest();

    await expect(guard.canActivate(mockContext(request))).rejects.toBeInstanceOf(NotFoundException);
    expect(request.membership).toBeUndefined();
  });

  it('rejects an unauthenticated request without querying', async () => {
    const { guard, findUnique } = buildGuard(null);
    const request = mockRequest({ user: undefined });

    await expect(guard.canActivate(mockContext(request))).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['empty', { workspaceId: '' }],
    ['not a string', { workspaceId: ['a', 'b'] }],
  ])('rejects a %s workspaceId param without querying', async (_label, params) => {
    const { guard, findUnique } = buildGuard(null);
    const request = mockRequest({ params: params as AuthedRequest['params'] });

    await expect(guard.canActivate(mockContext(request))).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
