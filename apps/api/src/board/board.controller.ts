import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type { BoardDto } from '@kurultay/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
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
  @UseGuards(WorkspaceGuard)
  list(@Param('workspaceId', ParseUuidV7Pipe) workspaceId: string): Promise<BoardDto[]> {
    return this.boardService.list(workspaceId);
  }

  @Post()
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  create(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Body() dto: CreateBoardDto,
  ): Promise<BoardDto> {
    return this.boardService.create(workspaceId, dto);
  }

  @Get(':boardId')
  @UseGuards(WorkspaceGuard)
  get(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
  ): Promise<BoardDto> {
    return this.boardService.get(workspaceId, boardId);
  }

  @Patch(':boardId')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER)
  update(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
    @Body() dto: UpdateBoardDto,
  ): Promise<BoardDto> {
    return this.boardService.update(workspaceId, boardId, dto);
  }

  @Delete(':boardId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  async remove(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
  ): Promise<void> {
    await this.boardService.remove(workspaceId, boardId);
  }
}
