import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ActivityDto, CursorPage } from '@kurultay/shared-types';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import { ActivityPageSchema } from '../openapi/schemas/feed.schema';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { ActivityService } from './activity.service';

/** Nested under workspace for tenant scoping. */
@ApiTags('Activity')
@Controller('workspaces/:workspaceId')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('activities')
  @ApiOperation({
    summary: "Page the workspace's activity feed",
    description:
      'Every write in the workspace, newest first. `payload` varies by `type`; the client ' +
      'renders one translated sentence per type rather than reading free text out of it.',
  })
  @ApiOkResponse({ type: ActivityPageSchema })
  @WorkspaceScoped()
  listWorkspace(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<ActivityDto>> {
    return this.activityService.listWorkspace(workspaceId, query);
  }

  @Get('tasks/:taskId/activities')
  @ApiOperation({ summary: "Page one task's activity feed" })
  @ApiOkResponse({ type: ActivityPageSchema })
  @WorkspaceScoped()
  listForTask(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<ActivityDto>> {
    return this.activityService.listForTask(workspaceId, taskId, query);
  }
}
