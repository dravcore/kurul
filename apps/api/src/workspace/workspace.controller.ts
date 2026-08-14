import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, Req } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type {
  CursorPage,
  InvitationDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import type { Request } from 'express';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import { ThrottleInvitations } from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser, WorkspaceMembership } from '../common/types/request-context';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceInvitationQueryDto } from './dto/workspace-invitation-query.dto';
import { WorkspaceMemberQueryDto } from './dto/workspace-member-query.dto';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceService } from './workspace.service';

@Controller('workspaces')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly invitationService: WorkspaceInvitationService,
    private readonly memberService: WorkspaceMemberService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<WorkspaceDto[]> {
    return this.workspaceService.listForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
    @Req() request: Request,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.create(user.id, dto, request);
  }

  @Get(':workspaceId')
  @WorkspaceScoped()
  get(@UuidParam('workspaceId') workspaceId: string): Promise<WorkspaceDto> {
    return this.workspaceService.getById(workspaceId);
  }

  @Patch(':workspaceId')
  @WorkspaceRoles(...ADMIN_ROLES)
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkspaceDto,
    @Req() request: Request,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.update(workspaceId, user.id, dto, request);
  }

  @Delete(':workspaceId')
  @HttpCode(204)
  @WorkspaceRoles(MemberRole.OWNER)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.workspaceService.remove(workspaceId, user.id, request);
  }

  /**
   * Declared before `:workspaceId/members` is irrelevant here — `/members/me` is a longer
   * path, not a parameter that could swallow it — but the two stay adjacent on purpose: a
   * caller that only needs its own role should never reach for the list.
   */
  @Get(':workspaceId/members/me')
  @WorkspaceScoped()
  getOwnMembership(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMemberDto> {
    return this.workspaceService.getMembership(workspaceId, user.id);
  }

  /**
   * Leaving is self-service, so it is `@WorkspaceScoped` and not role-gated: a GUEST who was
   * invited by mistake must be able to walk out without asking an admin to let them.
   *
   * Declared ahead of `members/:userId` because `me` is not a UUIDv7 and would otherwise be
   * rejected by `@UuidParam` before this handler was ever considered.
   *
   * 204: the caller's membership is gone, so there is nothing left to return about it.
   */
  @Post(':workspaceId/members/me/leave')
  @HttpCode(204)
  @WorkspaceScoped()
  async leaveWorkspace(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMembership,
    @Req() request: Request,
  ): Promise<void> {
    await this.memberService.leave(workspaceId, membership, request);
  }

  @Get(':workspaceId/members')
  @WorkspaceScoped()
  listMembers(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: WorkspaceMemberQueryDto,
  ): Promise<CursorPage<WorkspaceMemberDto>> {
    return this.workspaceService.listMembers(workspaceId, query);
  }

  /**
   * Revoke a member's access. Addressed by `userId`, not by membership id: the caller who
   * wants someone out knows *who*, and the membership row id is an implementation detail of
   * the roster response.
   */
  @Delete(':workspaceId/members/:userId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async removeMember(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('userId') userId: string,
    @CurrentMembership() membership: WorkspaceMembership,
    @Req() request: Request,
  ): Promise<void> {
    await this.memberService.removeMember(workspaceId, userId, membership, request);
  }

  /**
   * `PATCH .../role` rather than `PATCH .../members/:userId`: role is the only mutable field
   * of a membership, and a sub-resource says so in the URL instead of leaving callers to
   * discover that every other key is rejected.
   */
  @Patch(':workspaceId/members/:userId/role')
  @WorkspaceRoles(...ADMIN_ROLES)
  updateMemberRole(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentMembership() membership: WorkspaceMembership,
    @Req() request: Request,
  ): Promise<WorkspaceMemberDto> {
    return this.memberService.updateMemberRole(workspaceId, userId, dto, membership, request);
  }

  /**
   * The invitations still awaiting an answer. OWNER / ADMIN only, unlike the roster beside it.
   *
   * `@WorkspaceScoped` would have been the consistent-looking choice — both are lists of
   * people attached to the workspace — and it is the wrong one. A member has joined and is
   * visible to the workspace by their own decision; an invited address belongs to someone who
   * has agreed to nothing yet, and publishing the queue to every GUEST would hand out contact
   * details the product was never given permission to share. The gate also matches what the
   * list is *for*: revoking, which is admin-only anyway.
   */
  @Get(':workspaceId/invitations')
  @WorkspaceRoles(...ADMIN_ROLES)
  listInvitations(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: WorkspaceInvitationQueryDto,
  ): Promise<CursorPage<InvitationDto>> {
    return this.invitationService.listPendingInvitations(workspaceId, query);
  }

  /**
   * Rate limited below the API default: every call hands a message to the SMTP relay, aimed
   * at an address the caller chooses, so an admin account is enough to turn this endpoint
   * into a mail cannon pointed at someone else's inbox.
   */
  @Post(':workspaceId/invitations')
  @ThrottleInvitations()
  @WorkspaceRoles(...ADMIN_ROLES)
  createInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
    @Req() request: Request,
  ): Promise<InvitationDto> {
    return this.invitationService.createInvitation(workspaceId, user.id, dto, request);
  }

  @Delete(':workspaceId/invitations/:invitationId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async revokeInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.invitationService.revokeInvitation(workspaceId, user.id, invitationId, request);
  }

  /**
   * Accept is session-authenticated but not membership-gated — the invitee is not a
   * member until after accept. `:workspaceId` must match the invitation's workspace.
   *
   * 200, not 201: this is an action on an existing invitation (api-conventions), and the
   * membership it returns has no URL of its own for a `Location` header to point at.
   */
  @Post(':workspaceId/invitations/:invitationId/accept')
  @HttpCode(200)
  acceptInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<WorkspaceMemberDto> {
    return this.invitationService.acceptInvitation(workspaceId, invitationId, request);
  }
}
