import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { CommentPageSchema, CommentSchema } from '../openapi/schemas/feed.schema';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentService } from './comment.service';

@ApiTags('Comments')
@Controller('workspaces/:workspaceId')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get('tasks/:taskId/comments')
  @ApiOperation({
    summary: "Page a task's comments",
    description: 'Cursor-paginated, keyed on `id`. `limit` defaults to the 100 ceiling.',
  })
  @ApiOkResponse({ type: CommentPageSchema })
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @Query() query: CommentQueryDto,
  ): Promise<CursorPage<CommentDto>> {
    return this.commentService.list(workspaceId, taskId, query);
  }

  @Post('tasks/:taskId/comments')
  @ApiOperation({ summary: 'Comment on a task' })
  @ApiCreatedResponse({ type: CommentSchema })
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
  @ApiOperation({
    summary: 'Delete a comment',
    description:
      'The author, or an `OWNER`/`ADMIN`. A comment is a person\u2019s statement, which is why ' +
      'this draws an author line that attachment deletion deliberately does not.',
  })
  @ApiNoContentResponse({ description: 'Deleted. Empty body.' })
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
