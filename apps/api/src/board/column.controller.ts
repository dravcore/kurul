import { Body, Controller, Delete, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import type { ColumnDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { ColumnService } from './column.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

@Controller('workspaces/:workspaceId')
export class ColumnController {
  constructor(private readonly columnService: ColumnService) {}

  @Get('boards/:boardId/columns')
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
  ): Promise<ColumnDto[]> {
    return this.columnService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/columns')
  @WorkspaceRoles(...ADMIN_ROLES)
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnDto> {
    return this.columnService.create(workspaceId, boardId, user.id, dto);
  }

  /**
   * Seeds an empty board with the starting columns in one transaction.
   *
   * Same guard as `POST boards/:boardId/columns` — this creates columns, so it is gated on
   * exactly the roles that may create one. `Accept-Language` is the fallback for a user who
   * has set no preference; the names are written into the database, not rendered.
   */
  @Post('boards/:boardId/columns/defaults')
  @WorkspaceRoles(...ADMIN_ROLES)
  createDefaults(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<ColumnDto[]> {
    return this.columnService.createDefaults(workspaceId, boardId, user.id, acceptLanguage);
  }

  @Patch('columns/:columnId')
  @WorkspaceRoles(...ADMIN_ROLES)
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('columnId') columnId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateColumnDto,
  ): Promise<ColumnDto> {
    return this.columnService.update(workspaceId, columnId, user.id, dto);
  }

  @Delete('columns/:columnId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('columnId') columnId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.columnService.remove(workspaceId, columnId, user.id);
  }

  @Patch('columns/:columnId/position')
  @WorkspaceRoles(...ADMIN_ROLES)
  move(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('columnId') columnId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveColumnDto,
  ): Promise<ColumnDto> {
    return this.columnService.move(workspaceId, columnId, user.id, dto);
  }
}
