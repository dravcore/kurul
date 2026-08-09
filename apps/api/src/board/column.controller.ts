import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type { ColumnDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import type { AuthenticatedUser } from '../common/types/request-context';
import { ColumnService } from './column.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

@Controller('workspaces/:workspaceId')
export class ColumnController {
  constructor(private readonly columnService: ColumnService) {}

  @Get('boards/:boardId/columns')
  @UseGuards(WorkspaceGuard)
  list(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
  ): Promise<ColumnDto[]> {
    return this.columnService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/columns')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  create(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnDto> {
    return this.columnService.create(workspaceId, boardId, user.id, dto);
  }

  @Patch('columns/:columnId')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  update(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('columnId', ParseUuidV7Pipe) columnId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateColumnDto,
  ): Promise<ColumnDto> {
    return this.columnService.update(workspaceId, columnId, user.id, dto);
  }

  @Delete('columns/:columnId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  async remove(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('columnId', ParseUuidV7Pipe) columnId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.columnService.remove(workspaceId, columnId, user.id);
  }

  @Patch('columns/:columnId/position')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  move(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('columnId', ParseUuidV7Pipe) columnId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveColumnDto,
  ): Promise<ColumnDto> {
    return this.columnService.move(workspaceId, columnId, user.id, dto);
  }
}
