import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { LabelDto } from '@kurultay/shared-types';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
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
    @Body() dto: CreateLabelDto,
  ): Promise<LabelDto> {
    return this.labelService.create(workspaceId, boardId, dto);
  }

  @Patch('labels/:labelId')
  @WorkspaceRoles(...ADMIN_ROLES)
  update(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('labelId') labelId: string,
    @Body() dto: UpdateLabelDto,
  ): Promise<LabelDto> {
    return this.labelService.update(workspaceId, labelId, dto);
  }

  @Delete('labels/:labelId')
  @HttpCode(204)
  @WorkspaceRoles(...ADMIN_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('labelId') labelId: string,
  ): Promise<void> {
    await this.labelService.remove(workspaceId, labelId);
  }
}
