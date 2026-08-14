import { MemberRole } from '@kurultay/shared-types';
import type { Request } from 'express';
import type { AuthenticatedUser, WorkspaceMembership } from '../common/types/request-context';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceService } from './workspace.service';

/**
 * Every handler here is a thin delegation to one of the three workspace services, gated by
 * `@WorkspaceScoped`/`@WorkspaceRoles` (covered separately in
 * `common/decorators/workspace-roles.decorator.spec.ts`). Fourteen handlers, three services and
 * near-identical `(workspaceId, userId, ...)` signatures is exactly the shape where a copy-paste
 * mistake compiles cleanly — `remove` calling `memberService.removeMember` instead of
 * `workspaceService.remove`, or `updateMemberRole` forwarding `user.id` instead of the
 * `membership` it was actually given — and only an integration test that happens to use a
 * distinguishable id in every position would ever catch it. Each id below is unique across the
 * whole file for exactly that reason.
 */
describe('WorkspaceController', () => {
  function buildController() {
    const workspaceService = {
      listForUser: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'created-workspace' }),
      getById: jest.fn().mockResolvedValue({ id: 'workspace' }),
      update: jest.fn().mockResolvedValue({ id: 'workspace' }),
      remove: jest.fn().mockResolvedValue(undefined),
      listMembers: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      getMembership: jest.fn().mockResolvedValue({ id: 'membership' }),
    };
    const invitationService = {
      listPendingInvitations: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      createInvitation: jest.fn().mockResolvedValue({ id: 'invitation' }),
      revokeInvitation: jest.fn().mockResolvedValue(undefined),
      acceptInvitation: jest.fn().mockResolvedValue({ id: 'member' }),
    };
    const memberService = {
      leave: jest.fn().mockResolvedValue(undefined),
      removeMember: jest.fn().mockResolvedValue(undefined),
      updateMemberRole: jest.fn().mockResolvedValue({ id: 'member' }),
    };

    return {
      controller: new WorkspaceController(
        workspaceService as unknown as WorkspaceService,
        invitationService as unknown as WorkspaceInvitationService,
        memberService as unknown as WorkspaceMemberService,
      ),
      workspaceService,
      invitationService,
      memberService,
    };
  }

  const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
  const TARGET_USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02';
  const INVITATION_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d03';
  const user: AuthenticatedUser = {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d04',
    email: 'owner@example.com',
    name: 'Owner',
    avatarUrl: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01'),
  };
  const membership: WorkspaceMembership = {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d05',
    workspaceId: WORKSPACE_ID,
    userId: user.id,
    role: MemberRole.ADMIN,
  };
  const request = { headers: {} } as unknown as Request;

  it('lists workspaces for the calling user', async () => {
    const { controller, workspaceService } = buildController();

    await controller.list(user);

    expect(workspaceService.listForUser).toHaveBeenCalledWith(user.id);
  });

  it('creates a workspace for the calling user', async () => {
    const { controller, workspaceService } = buildController();
    const dto = { name: 'Acme', slug: 'acme' } as never;

    await controller.create(user, dto, request);

    expect(workspaceService.create).toHaveBeenCalledWith(user.id, dto, request);
  });

  it('reads a workspace by id', async () => {
    const { controller, workspaceService } = buildController();

    await controller.get(WORKSPACE_ID);

    expect(workspaceService.getById).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it('updates a workspace, attributing the change to the calling user', async () => {
    const { controller, workspaceService } = buildController();
    const dto = { name: 'Renamed' } as never;

    await controller.update(WORKSPACE_ID, user, dto, request);

    expect(workspaceService.update).toHaveBeenCalledWith(WORKSPACE_ID, user.id, dto, request);
  });

  it('deletes a workspace, attributing it to the calling user', async () => {
    const { controller, workspaceService } = buildController();

    await controller.remove(WORKSPACE_ID, user, request);

    expect(workspaceService.remove).toHaveBeenCalledWith(WORKSPACE_ID, user.id, request);
  });

  it("reads the caller's own membership", async () => {
    const { controller, workspaceService } = buildController();

    await controller.getOwnMembership(WORKSPACE_ID, user);

    expect(workspaceService.getMembership).toHaveBeenCalledWith(WORKSPACE_ID, user.id);
  });

  it('leaves through the member service, not the workspace service', async () => {
    const { controller, memberService, workspaceService } = buildController();

    await controller.leaveWorkspace(WORKSPACE_ID, membership, request);

    expect(memberService.leave).toHaveBeenCalledWith(WORKSPACE_ID, membership, request);
    expect(workspaceService.remove).not.toHaveBeenCalled();
  });

  it('lists members of a workspace', async () => {
    const { controller, workspaceService } = buildController();
    const query = { limit: 20 } as never;

    await controller.listMembers(WORKSPACE_ID, query);

    expect(workspaceService.listMembers).toHaveBeenCalledWith(WORKSPACE_ID, query);
  });

  it('removes a member, forwarding the target user id and the acting membership separately', async () => {
    const { controller, memberService } = buildController();

    await controller.removeMember(WORKSPACE_ID, TARGET_USER_ID, membership, request);

    expect(memberService.removeMember).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TARGET_USER_ID,
      membership,
      request,
    );
  });

  it('changes a member role, forwarding the dto and the acting membership separately', async () => {
    const { controller, memberService } = buildController();
    const dto = { role: MemberRole.ADMIN } as never;

    await controller.updateMemberRole(WORKSPACE_ID, TARGET_USER_ID, dto, membership, request);

    expect(memberService.updateMemberRole).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TARGET_USER_ID,
      dto,
      membership,
      request,
    );
  });

  it('lists pending invitations', async () => {
    const { controller, invitationService } = buildController();
    const query = { limit: 20 } as never;

    await controller.listInvitations(WORKSPACE_ID, query);

    expect(invitationService.listPendingInvitations).toHaveBeenCalledWith(WORKSPACE_ID, query);
  });

  it('creates an invitation, attributing it to the calling user', async () => {
    const { controller, invitationService } = buildController();
    const dto = { email: 'invitee@example.com', role: MemberRole.MEMBER } as never;

    await controller.createInvitation(WORKSPACE_ID, user, dto, request);

    expect(invitationService.createInvitation).toHaveBeenCalledWith(
      WORKSPACE_ID,
      user.id,
      dto,
      request,
    );
  });

  it('revokes an invitation, attributing it to the calling user', async () => {
    const { controller, invitationService } = buildController();

    await controller.revokeInvitation(WORKSPACE_ID, INVITATION_ID, user, request);

    expect(invitationService.revokeInvitation).toHaveBeenCalledWith(
      WORKSPACE_ID,
      user.id,
      INVITATION_ID,
      request,
    );
  });

  it('accepts an invitation without requiring a workspace membership', async () => {
    const { controller, invitationService } = buildController();

    await controller.acceptInvitation(WORKSPACE_ID, INVITATION_ID, request);

    expect(invitationService.acceptInvitation).toHaveBeenCalledWith(
      WORKSPACE_ID,
      INVITATION_ID,
      request,
    );
  });
});
