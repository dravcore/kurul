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
import type { AuthenticatedUser } from '../common/types/request-context';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceService } from './workspace.service';

@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

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
  get(@Param('workspaceId') workspaceId: string): Promise<WorkspaceDto> {
    return this.workspaceService.getById(workspaceId);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  update(
    @Param('workspaceId') workspaceId: string,
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
    @Param('workspaceId') workspaceId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.workspaceService.remove(workspaceId, request);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceGuard)
  listMembers(@Param('workspaceId') workspaceId: string): Promise<WorkspaceMemberDto[]> {
    return this.workspaceService.listMembers(workspaceId);
  }

  @Post(':workspaceId/invitations')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  createInvitation(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateInvitationDto,
    @Req() request: Request,
  ): Promise<InvitationDto> {
    return this.workspaceService.createInvitation(workspaceId, dto, request);
  }

  @Delete(':workspaceId/invitations/:invitationId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  async revokeInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.workspaceService.revokeInvitation(workspaceId, invitationId, request);
  }

  /**
   * Accept is session-authenticated but not membership-gated — the invitee is not a
   * member until after accept. `:workspaceId` must match the invitation's workspace.
   */
  @Post(':workspaceId/invitations/:invitationId/accept')
  acceptInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<WorkspaceMemberDto> {
    return this.workspaceService.acceptInvitation(workspaceId, invitationId, request);
  }
}
