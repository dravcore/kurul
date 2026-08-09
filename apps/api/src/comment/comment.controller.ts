import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type { CommentDto } from '@kurultay/shared-types';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import type { AuthenticatedUser, WorkspaceMembership } from '../common/types/request-context';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentService } from './comment.service';

@Controller('workspaces/:workspaceId')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get('tasks/:taskId/comments')
  @UseGuards(WorkspaceGuard)
  list(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
  ): Promise<CommentDto[]> {
    return this.commentService.list(workspaceId, taskId);
  }

  @Post('tasks/:taskId/comments')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  create(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentDto> {
    return this.commentService.create(workspaceId, taskId, user.id, dto);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  async remove(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('commentId', ParseUuidV7Pipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() membership: WorkspaceMembership,
  ): Promise<void> {
    await this.commentService.remove(workspaceId, commentId, user.id, membership.role);
  }
}
