import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { LabelDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { LabelService } from './label.service';

@Controller('workspaces/:workspaceId')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @Get('boards/:boardId/labels')
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
  ): Promise<LabelDto[]> {
    return this.labelService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/labels')
  @WorkspaceRoles(...ADMIN_ROLES)
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLabelDto,
  ): Promise<LabelDto> {
    return this.labelService.create(workspaceId, boardId, user.id, dto);
  }

  @Patch('labels/:labelId')
  @WorkspaceRoles(...ADMIN_ROLES)
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLabelDto,
  ): Promise<LabelDto> {
    return this.labelService.update(workspaceId, labelId, user.id, dto);
  }

  @Delete('labels/:labelId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.labelService.remove(workspaceId, labelId, user.id);
  }
}
