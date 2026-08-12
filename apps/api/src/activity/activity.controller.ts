import { Controller, Get, Query } from '@nestjs/common';
import type { ActivityDto, CursorPage } from '@kurultay/shared-types';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { ActivityService } from './activity.service';

/** Nested under workspace for tenant scoping. */
@Controller('workspaces/:workspaceId')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('activities')
  @WorkspaceScoped()
  listWorkspace(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<ActivityDto>> {
    return this.activityService.listWorkspace(workspaceId, query);
  }

  @Get('tasks/:taskId/activities')
  @WorkspaceScoped()
  listForTask(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<ActivityDto>> {
    return this.activityService.listForTask(workspaceId, taskId, query);
  }
}
