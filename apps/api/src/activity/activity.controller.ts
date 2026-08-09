import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { ActivityDto, CursorPage } from '@kurultay/shared-types';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { ActivityService } from './activity.service';

/** Nested under workspace for tenant scoping. */
@Controller('workspaces/:workspaceId')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('activities')
  @UseGuards(WorkspaceGuard)
  listWorkspace(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<ActivityDto>> {
    return this.activityService.listWorkspace(workspaceId, query);
  }

  @Get('tasks/:taskId/activities')
  @UseGuards(WorkspaceGuard)
  listForTask(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Param('taskId', ParseUuidV7Pipe) taskId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<ActivityDto>> {
    return this.activityService.listForTask(workspaceId, taskId, query);
  }
}
