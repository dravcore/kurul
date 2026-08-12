import { Body, Controller, Delete, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import type { BoardDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import {
  ADMIN_ROLES,
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import { BoardService } from './board.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

/**
 * Nested under workspace for tenant scoping. WorkspaceGuard reads `params.workspaceId`.
 */
@Controller('workspaces/:workspaceId/boards')
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Get()
  @WorkspaceScoped()
  list(@UuidParam('workspaceId') workspaceId: string): Promise<BoardDto[]> {
    return this.boardService.list(workspaceId);
  }

  /**
   * `Accept-Language` is read here and nowhere else in the board routes: the default columns
   * are written into the database in the creator's language, and the header is the fallback
   * for a user who has not set a preference (ADR 0018 §2).
   */
  @Post()
  @WorkspaceRoles(...CONTENT_ROLES)
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBoardDto,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<BoardDto> {
    return this.boardService.create(workspaceId, user.id, dto, acceptLanguage);
  }

  @Get(':boardId')
  @WorkspaceScoped()
  get(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
  ): Promise<BoardDto> {
    return this.boardService.get(workspaceId, boardId);
  }

  @Patch(':boardId')
  @WorkspaceRoles(...CONTENT_ROLES)
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @Body() dto: UpdateBoardDto,
  ): Promise<BoardDto> {
    return this.boardService.update(workspaceId, boardId, dto);
  }

  @Delete(':boardId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
  ): Promise<void> {
    await this.boardService.remove(workspaceId, boardId);
  }
}
