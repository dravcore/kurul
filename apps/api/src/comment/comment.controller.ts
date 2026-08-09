import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { CommentDto, CursorPage } from '@kurultay/shared-types';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser, WorkspaceMembership } from '../common/types/request-context';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentService } from './comment.service';

@Controller('workspaces/:workspaceId')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get('tasks/:taskId/comments')
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @Query() query: CommentQueryDto,
  ): Promise<CursorPage<CommentDto>> {
    return this.commentService.list(workspaceId, taskId, query);
  }

  @Post('tasks/:taskId/comments')
  @WorkspaceRoles(...CONTENT_ROLES)
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentDto> {
    return this.commentService.create(workspaceId, taskId, user.id, dto);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @WorkspaceRoles(...CONTENT_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() membership: WorkspaceMembership,
  ): Promise<void> {
    await this.commentService.remove(workspaceId, commentId, user.id, membership.role);
  }
}
