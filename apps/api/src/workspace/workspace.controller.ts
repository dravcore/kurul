import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, Req } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type {
  CursorPage,
  InvitationDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceMemberQueryDto } from './dto/workspace-member-query.dto';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceService } from './workspace.service';

@Controller('workspaces')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly invitationService: WorkspaceInvitationService,
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
    @Body() dto: UpdateWorkspaceDto,
    @Req() request: Request,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.update(workspaceId, dto, request);
  }

  @Delete(':workspaceId')
  @HttpCode(204)
  @WorkspaceRoles(MemberRole.OWNER)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.workspaceService.remove(workspaceId, request);
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

  @Get(':workspaceId/members')
  @WorkspaceScoped()
  listMembers(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: WorkspaceMemberQueryDto,
  ): Promise<CursorPage<WorkspaceMemberDto>> {
    return this.workspaceService.listMembers(workspaceId, query);
  }

  @Post(':workspaceId/invitations')
  @WorkspaceRoles(...ADMIN_ROLES)
  createInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @Body() dto: CreateInvitationDto,
    @Req() request: Request,
  ): Promise<InvitationDto> {
    return this.invitationService.createInvitation(workspaceId, dto, request);
  }

  @Delete(':workspaceId/invitations/:invitationId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async revokeInvitation(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.invitationService.revokeInvitation(workspaceId, invitationId, request);
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
