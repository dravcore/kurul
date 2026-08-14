import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, MemberRole } from '@kurultay/shared-types';
import { APIError } from 'better-auth/api';
import type { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { auth } from '../auth/auth';
import type { WorkspaceMembership } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { evictUserFromWorkspaceSockets } from '../realtime/workspace-socket-eviction';
import { WorkspaceMemberService } from './workspace-member.service';

// `auth.ts` opens a Postgres pool and demands DATABASE_URL / BETTER_AUTH_SECRET at import
// time. These tests are about the rules the service enforces around the plugin, not the
// plugin itself, so the module is replaced wholesale.
jest.mock('../auth/auth', () => ({
  auth: {
    api: {
      removeMember: jest.fn(),
      updateMemberRole: jest.fn(),
      leaveOrganization: jest.fn(),
    },
  },
}));

jest.mock('../realtime/workspace-socket-eviction', () => ({
  evictUserFromWorkspaceSockets: jest.fn<Promise<void>, [string, string]>(),
}));

const api = auth.api as unknown as {
  removeMember: jest.Mock;
  updateMemberRole: jest.Mock;
  leaveOrganization: jest.Mock;
};

const evictMock = jest.mocked(evictUserFromWorkspaceSockets);

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const OWNER_USER = '0198e2c0-9a1b-7f04-8c3d-000000000001';
const ADMIN_USER = '0198e2c0-9a1b-7f04-8c3d-000000000002';
const MEMBER_USER = '0198e2c0-9a1b-7f04-8c3d-000000000003';
const SECOND_OWNER_USER = '0198e2c0-9a1b-7f04-8c3d-000000000004';

interface MemberSeed {
  userId: string;
  role: MemberRole;
}

interface PrismaStub {
  workspaceMember: { findUnique: jest.Mock; count: jest.Mock };
}

/**
 * Builds the service over a Prisma stub backed by an in-memory roster, so `findUnique` and
 * the OWNER `count` can never disagree with each other the way two hand-written mocks would.
 */
function buildService(roster: MemberSeed[]): {
  service: WorkspaceMemberService;
  prisma: PrismaStub;
  activityService: { record: jest.Mock };
} {
  const rows = roster.map((seed, index) => ({
    id: `0198e2c0-9a1b-7f04-8c3d-1000000000${String(index).padStart(2, '0')}`,
    workspaceId: WORKSPACE_ID,
    userId: seed.userId,
    role: seed.role as string,
    user: { name: `User ${index}`, avatarUrl: null },
  }));

  const prisma: PrismaStub = {
    workspaceMember: {
      findUnique: jest.fn(
        (args: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) =>
          Promise.resolve(
            rows.find(
              (row) =>
                row.workspaceId === args.where.workspaceId_userId.workspaceId &&
                row.userId === args.where.workspaceId_userId.userId,
            ) ?? null,
          ),
      ),
      count: jest.fn((args: { where: { workspaceId: string; role: string } }) =>
        Promise.resolve(
          rows.filter(
            (row) => row.workspaceId === args.where.workspaceId && row.role === args.where.role,
          ).length,
        ),
      ),
    },
  };

  const activityService = { record: jest.fn().mockResolvedValue({ id: 'activity' }) };

  return {
    service: new WorkspaceMemberService(
      prisma as unknown as PrismaService,
      activityService as unknown as ActivityService,
    ),
    prisma,
    activityService,
  };
}

function actorOf(userId: string, role: MemberRole): WorkspaceMembership {
  return {
    id: `membership-${userId}`,
    workspaceId: WORKSPACE_ID,
    userId,
    role,
  };
}

const request = { headers: {} } as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  api.removeMember.mockResolvedValue({ member: { id: 'member-id' } });
  api.updateMemberRole.mockResolvedValue({ id: 'member-id' });
  api.leaveOrganization.mockResolvedValue({ id: 'member-id' });
  evictMock.mockResolvedValue(undefined);
});

const OWNER_AND_ADMIN: MemberSeed[] = [
  { userId: OWNER_USER, role: MemberRole.OWNER },
  { userId: ADMIN_USER, role: MemberRole.ADMIN },
  { userId: MEMBER_USER, role: MemberRole.MEMBER },
];

const TWO_OWNERS: MemberSeed[] = [
  { userId: OWNER_USER, role: MemberRole.OWNER },
  { userId: SECOND_OWNER_USER, role: MemberRole.OWNER },
  { userId: ADMIN_USER, role: MemberRole.ADMIN },
];

describe('WorkspaceMemberService.removeMember', () => {
  /**
   * The point of routing through `auth.api.removeMember` rather than `prisma.delete`:
   * `organizationHooks.afterRemoveMember` is what evicts the user's sockets, and it only runs
   * when the plugin performs the delete. A direct eviction call here would mean the delete had
   * bypassed the plugin.
   */
  it('removes the member through Better Auth so afterRemoveMember evicts their sockets', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await service.removeMember(
      WORKSPACE_ID,
      MEMBER_USER,
      actorOf(ADMIN_USER, MemberRole.ADMIN),
      request,
    );

    expect(api.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ organizationId: WORKSPACE_ID }),
      }),
    );
    // Addressed by membership row id, which is what the plugin's `memberIdOrEmail` expects.
    const body = api.removeMember.mock.calls[0]?.[0]?.body as { memberIdOrEmail: string };
    expect(body.memberIdOrEmail).toMatch(/^0198e2c0-/);
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('refuses self-removal and names the leave endpoint', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const thrown = await service
      .removeMember(WORKSPACE_ID, ADMIN_USER, actorOf(ADMIN_USER, MemberRole.ADMIN), request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).message).toContain('members/me/leave');
    expect(api.removeMember).not.toHaveBeenCalled();
  });

  it('404s for a user who is not a member of this workspace', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await expect(
      service.removeMember(
        WORKSPACE_ID,
        '0198e2c0-9a1b-7f04-8c3d-0000000000ff',
        actorOf(OWNER_USER, MemberRole.OWNER),
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(api.removeMember).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN removing an OWNER', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const thrown = await service
      .removeMember(WORKSPACE_ID, OWNER_USER, actorOf(ADMIN_USER, MemberRole.ADMIN), request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(api.removeMember).not.toHaveBeenCalled();
  });

  /**
   * Authorization is answered before workspace state, so an ADMIN aiming at the sole OWNER is
   * told they are not allowed — never how many owners the workspace has.
   */
  it('answers 403 rather than 409 when an ADMIN targets the only OWNER', async () => {
    const { service, prisma } = buildService(OWNER_AND_ADMIN);

    await expect(
      service.removeMember(
        WORKSPACE_ID,
        OWNER_USER,
        actorOf(ADMIN_USER, MemberRole.ADMIN),
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.workspaceMember.count).not.toHaveBeenCalled();
  });

  it('lets an OWNER remove a co-owner while another OWNER remains', async () => {
    const { service } = buildService(TWO_OWNERS);

    await service.removeMember(
      WORKSPACE_ID,
      SECOND_OWNER_USER,
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    expect(api.removeMember).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the plugin loses the last-owner race', async () => {
    const { service } = buildService(TWO_OWNERS);
    api.removeMember.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'You cannot leave the organization as the only owner',
        code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
      }),
    );

    const thrown = await service
      .removeMember(WORKSPACE_ID, SECOND_OWNER_USER, actorOf(OWNER_USER, MemberRole.OWNER), request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toContain('last OWNER');
  });

  /**
   * Better Auth raises its own permission denial as `401`. Passing that through would tell the
   * web client the session expired and bounce an authenticated user to sign-in.
   */
  it("translates the plugin's 401 permission denial into 403", async () => {
    const { service } = buildService(OWNER_AND_ADMIN);
    api.removeMember.mockRejectedValue(
      new APIError('UNAUTHORIZED', {
        message: 'You are not allowed to delete this member',
        code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
      }),
    );

    await expect(
      service.removeMember(
        WORKSPACE_ID,
        MEMBER_USER,
        actorOf(ADMIN_USER, MemberRole.ADMIN),
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rethrows an unknown failure untouched', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);
    const failure = new Error('pool drained');
    api.removeMember.mockRejectedValue(failure);

    await expect(
      service.removeMember(
        WORKSPACE_ID,
        MEMBER_USER,
        actorOf(ADMIN_USER, MemberRole.ADMIN),
        request,
      ),
    ).rejects.toBe(failure);
  });
});

describe('WorkspaceMemberService.updateMemberRole', () => {
  it('changes the role through Better Auth and answers with the new one', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const updated = await service.updateMemberRole(
      WORKSPACE_ID,
      MEMBER_USER,
      { role: MemberRole.GUEST },
      actorOf(ADMIN_USER, MemberRole.ADMIN),
      request,
    );

    expect(api.updateMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          role: MemberRole.GUEST,
          organizationId: WORKSPACE_ID,
        }),
      }),
    );
    expect(updated.role).toBe(MemberRole.GUEST);
    expect(updated.userId).toBe(MEMBER_USER);
  });

  it('writes nothing when the requested role is the one already held', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const unchanged = await service.updateMemberRole(
      WORKSPACE_ID,
      MEMBER_USER,
      { role: MemberRole.MEMBER },
      actorOf(ADMIN_USER, MemberRole.ADMIN),
      request,
    );

    expect(api.updateMemberRole).not.toHaveBeenCalled();
    expect(unchanged.role).toBe(MemberRole.MEMBER);
  });

  it('refuses an ADMIN demoting an OWNER', async () => {
    const { service } = buildService(TWO_OWNERS);

    await expect(
      service.updateMemberRole(
        WORKSPACE_ID,
        OWNER_USER,
        { role: MemberRole.MEMBER },
        actorOf(ADMIN_USER, MemberRole.ADMIN),
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(api.updateMemberRole).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN minting a new OWNER', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await expect(
      service.updateMemberRole(
        WORKSPACE_ID,
        MEMBER_USER,
        { role: MemberRole.OWNER },
        actorOf(ADMIN_USER, MemberRole.ADMIN),
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(api.updateMemberRole).not.toHaveBeenCalled();
  });

  it('lets an OWNER promote someone to OWNER', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const promoted = await service.updateMemberRole(
      WORKSPACE_ID,
      ADMIN_USER,
      { role: MemberRole.OWNER },
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    expect(promoted.role).toBe(MemberRole.OWNER);
    expect(api.updateMemberRole).toHaveBeenCalledTimes(1);
  });

  it('refuses to demote the last OWNER', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const thrown = await service
      .updateMemberRole(
        WORKSPACE_ID,
        OWNER_USER,
        { role: MemberRole.ADMIN },
        actorOf(OWNER_USER, MemberRole.OWNER),
        request,
      )
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toContain('last OWNER');
    expect(api.updateMemberRole).not.toHaveBeenCalled();
  });

  it('lets an OWNER step down while a co-owner remains', async () => {
    const { service } = buildService(TWO_OWNERS);

    const stepped = await service.updateMemberRole(
      WORKSPACE_ID,
      OWNER_USER,
      { role: MemberRole.ADMIN },
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    expect(stepped.role).toBe(MemberRole.ADMIN);
  });

  it('404s for a user who is not a member of this workspace', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await expect(
      service.updateMemberRole(
        WORKSPACE_ID,
        '0198e2c0-9a1b-7f04-8c3d-0000000000ff',
        { role: MemberRole.GUEST },
        actorOf(OWNER_USER, MemberRole.OWNER),
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * Locks in the decision documented on `updateMemberRole`: socket rooms are gated on
   * membership, never on role, so a downgrade removes no room the user may still sit in and
   * eviction would buy nothing but a reconnect. If a room ever becomes role-gated this
   * expectation is the thing that has to change first.
   */
  it('does not evict sockets on a downgrade', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await service.updateMemberRole(
      WORKSPACE_ID,
      MEMBER_USER,
      { role: MemberRole.GUEST },
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    expect(evictMock).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMemberService.leave', () => {
  /**
   * `/organization/leave` does not run `afterRemoveMember`, so unlike `removeMember` this path
   * has to evict explicitly — otherwise a member who walked out keeps receiving the
   * workspace's board and notification events on an open socket.
   */
  it('leaves through Better Auth and evicts the caller from the workspace rooms', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await service.leave(WORKSPACE_ID, actorOf(MEMBER_USER, MemberRole.MEMBER), request);

    expect(api.leaveOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ body: { organizationId: WORKSPACE_ID } }),
    );
    expect(evictMock).toHaveBeenCalledWith(WORKSPACE_ID, MEMBER_USER);
  });

  it('refuses to let the only OWNER leave', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    const thrown = await service
      .leave(WORKSPACE_ID, actorOf(OWNER_USER, MemberRole.OWNER), request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toContain('last OWNER');
    expect(api.leaveOrganization).not.toHaveBeenCalled();
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('lets an OWNER leave once a co-owner exists', async () => {
    const { service } = buildService(TWO_OWNERS);

    await service.leave(WORKSPACE_ID, actorOf(OWNER_USER, MemberRole.OWNER), request);

    expect(api.leaveOrganization).toHaveBeenCalledTimes(1);
    expect(evictMock).toHaveBeenCalledWith(WORKSPACE_ID, OWNER_USER);
  });

  it('answers 409 when the plugin loses the last-owner race, and evicts nobody', async () => {
    const { service } = buildService(TWO_OWNERS);
    api.leaveOrganization.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'You cannot leave the organization as the only owner',
        code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
      }),
    );

    await expect(
      service.leave(WORKSPACE_ID, actorOf(OWNER_USER, MemberRole.OWNER), request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(evictMock).not.toHaveBeenCalled();
  });

  it('404s when the caller has no membership row', async () => {
    const { service } = buildService(OWNER_AND_ADMIN);

    await expect(
      service.leave(
        WORKSPACE_ID,
        actorOf('0198e2c0-9a1b-7f04-8c3d-0000000000ff', MemberRole.MEMBER),
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * The rows an incident responder reads after an account is compromised. Membership writes go
 * through Better Auth, so these assert what the service records *around* the plugin call —
 * including every case where it must record nothing, because an audit trail that logs refusals
 * as if they were changes is worse than one that misses them.
 */
describe('WorkspaceMemberService audit trail', () => {
  it('records a removal with the role the target was holding', async () => {
    const { service, activityService } = buildService(OWNER_AND_ADMIN);

    await service.removeMember(
      WORKSPACE_ID,
      ADMIN_USER,
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: OWNER_USER,
        type: ActivityType.MemberRemoved,
        payload: expect.objectContaining({
          targetUserId: ADMIN_USER,
          previousRole: MemberRole.ADMIN,
          actorRole: MemberRole.OWNER,
        }),
      }),
    );
  });

  it('records a role change with both roles named', async () => {
    const { service, activityService } = buildService(OWNER_AND_ADMIN);

    await service.updateMemberRole(
      WORKSPACE_ID,
      MEMBER_USER,
      { role: MemberRole.ADMIN },
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    // Privilege escalation is the event the trail exists for: without `previousRole` the row
    // cannot say whether anything was actually granted.
    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: ActivityType.MemberRoleChanged,
        payload: expect.objectContaining({
          targetUserId: MEMBER_USER,
          previousRole: MemberRole.MEMBER,
          newRole: MemberRole.ADMIN,
          actorRole: MemberRole.OWNER,
        }),
      }),
    );
  });

  it('records nothing when the requested role is the one already held', async () => {
    const { service, activityService } = buildService(OWNER_AND_ADMIN);

    await service.updateMemberRole(
      WORKSPACE_ID,
      ADMIN_USER,
      { role: MemberRole.ADMIN },
      actorOf(OWNER_USER, MemberRole.OWNER),
      request,
    );

    expect(api.updateMemberRole).not.toHaveBeenCalled();
    expect(activityService.record).not.toHaveBeenCalled();
  });

  it('records nothing when an ADMIN is refused an ownership change', async () => {
    const { service, activityService } = buildService(OWNER_AND_ADMIN);

    await expect(
      service.updateMemberRole(
        WORKSPACE_ID,
        MEMBER_USER,
        { role: MemberRole.OWNER },
        actorOf(ADMIN_USER, MemberRole.ADMIN),
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(activityService.record).not.toHaveBeenCalled();
  });

  it('separates walking out from being removed', async () => {
    const { service, activityService } = buildService(OWNER_AND_ADMIN);

    await service.leave(WORKSPACE_ID, actorOf(ADMIN_USER, MemberRole.ADMIN), request);

    expect(activityService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: ADMIN_USER,
        type: ActivityType.MemberLeft,
        payload: expect.objectContaining({
          targetUserId: ADMIN_USER,
          previousRole: MemberRole.ADMIN,
        }),
      }),
    );
  });

  it('records nothing when the plugin refuses the removal', async () => {
    const { service, activityService } = buildService(OWNER_AND_ADMIN);
    api.removeMember.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'You are not allowed to delete this member',
        code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
      }),
    );

    await expect(
      service.removeMember(
        WORKSPACE_ID,
        ADMIN_USER,
        actorOf(OWNER_USER, MemberRole.OWNER),
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(activityService.record).not.toHaveBeenCalled();
  });
});
