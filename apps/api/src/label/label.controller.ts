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
import type { LabelDto } from '@kurultay/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { LabelService } from './label.service';

@Controller('workspaces/:workspaceId')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @Get('boards/:boardId/labels')
  @UseGuards(WorkspaceGuard)
  list(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
  ): Promise<LabelDto[]> {
    return this.labelService.list(workspaceId, boardId);
  }

  @Post('boards/:boardId/labels')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  create(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('boardId', ParseUuidV7Pipe) boardId: string,
    @Body() dto: CreateLabelDto,
  ): Promise<LabelDto> {
    return this.labelService.create(workspaceId, boardId, dto);
  }

  @Patch('labels/:labelId')
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  update(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('labelId', ParseUuidV7Pipe) labelId: string,
    @Body() dto: UpdateLabelDto,
  ): Promise<LabelDto> {
    return this.labelService.update(workspaceId, labelId, dto);
  }

  @Delete('labels/:labelId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  async remove(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('labelId', ParseUuidV7Pipe) labelId: string,
  ): Promise<void> {
    await this.labelService.remove(workspaceId, labelId);
  }
}
