import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { LabelDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  ADMIN_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { LabelSchema } from '../openapi/schemas/board.schema';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { LabelService } from './label.service';

@ApiTags('Labels')
@Controller('workspaces/:workspaceId')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @Get('boards/:boardId/labels')
  @ApiOperation({ summary: "List a board's labels" })
  @ApiOkResponse({ type: [LabelSchema] })
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('boardId') boardId: string,
  ): Promise<LabelDto[]> {
    return this.labelService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/labels')
  @ApiOperation({
    summary: 'Create a label',
    description:
      '`color` is a design-token slot name (`slot-1`\u2026`slot-8`) resolved by the theme, never a ' +
      'raw hex value \u2014 a stored hex cannot be legible in both light and dark.',
  })
  @ApiCreatedResponse({ type: LabelSchema })
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
  @ApiOperation({ summary: 'Rename or recolour a label' })
  @ApiOkResponse({ type: LabelSchema })
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
  @ApiOperation({
    summary: 'Delete a label',
    description: 'Detaches it from every task that carries it.',
  })
  @ApiNoContentResponse({ description: 'Deleted. Empty body.' })
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
