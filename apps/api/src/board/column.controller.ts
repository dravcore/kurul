import { Body, Controller, Delete, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { ColumnDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { ColumnSchema } from '../openapi/schemas/board.schema';
import { ColumnService } from './column.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

@ApiTags('Boards')
@Controller('workspaces/:workspaceId')
export class ColumnController {
  constructor(private readonly columnService: ColumnService) {}

  @Get('boards/:boardId/columns')
  @ApiOperation({
    summary: "List a board's columns",
    description:
      'Not paginated. A board holds a bounded number of columns by construction, which is the ' +
      'only condition under which this API returns a plain array.',
  })
  @ApiOkResponse({ type: [ColumnSchema] })
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
  ): Promise<ColumnDto[]> {
    return this.columnService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/columns')
  @ApiOperation({ summary: 'Create a column' })
  @ApiCreatedResponse({ type: ColumnSchema })
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
  @ApiOperation({
    summary: 'Seed an empty board with the starting columns',
    description:
      'One transaction. Same gate as creating a single column, because that is what it does. ' +
      'An action rather than a resource, hence `201` with the columns it wrote.',
  })
  @ApiCreatedResponse({ type: [ColumnSchema] })
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
  @ApiOperation({ summary: 'Update a column' })
  @ApiOkResponse({ type: ColumnSchema })
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
  @ApiOperation({ summary: 'Delete a column' })
  @ApiNoContentResponse({ description: 'Deleted. Empty body.' })
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
  @ApiOperation({
    summary: 'Reorder a column',
    description:
      'Position is a sub-resource with a verb-free name rather than an action segment. The new ' +
      '`position` is a fractional index computed from the neighbours named in the body \u2014 ' +
      'never an integer, never contiguous.',
  })
  @ApiOkResponse({ type: ColumnSchema })
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
