import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type {
  InvitationDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import type { AuthenticatedUser } from '../common/types/request-context';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
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
  @UseGuards(WorkspaceGuard)
  get(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.getById(workspaceId);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  update(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
    @Req() request: Request,
  ): Promise<WorkspaceDto> {
    return this.workspaceService.update(workspaceId, dto, request);
  }

  @Delete(':workspaceId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER)
  async remove(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.workspaceService.remove(workspaceId, request);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceGuard)
  listMembers(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
  ): Promise<WorkspaceMemberDto[]> {
    return this.workspaceService.listMembers(workspaceId);
  }

  @Post(':workspaceId/invitations')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  createInvitation(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Body() dto: CreateInvitationDto,
    @Req() request: Request,
  ): Promise<InvitationDto> {
    return this.invitationService.createInvitation(workspaceId, dto, request);
  }

  @Delete(':workspaceId/invitations/:invitationId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  async revokeInvitation(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('invitationId', ParseUuidV7Pipe) invitationId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.invitationService.revokeInvitation(workspaceId, invitationId, request);
  }

  /**
   * Accept is session-authenticated but not membership-gated — the invitee is not a
   * member until after accept. `:workspaceId` must match the invitation's workspace.
   */
  @Post(':workspaceId/invitations/:invitationId/accept')
  acceptInvitation(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('invitationId', ParseUuidV7Pipe) invitationId: string,
    @Req() request: Request,
  ): Promise<WorkspaceMemberDto> {
    return this.invitationService.acceptInvitation(workspaceId, invitationId, request);
  }
}
