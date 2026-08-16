import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsagePingKind } from '@kurul/shared-types';
import type { DashboardSummaryDto } from '@kurul/shared-types';
import { UsagePingService } from '../activation/usage-ping.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { DashboardSummarySchema } from '../openapi/schemas/dashboard.schema';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardService } from './dashboard.service';

/** Nested under workspace for tenant scoping. */
@ApiTags('Dashboard')
@Controller('workspaces/:workspaceId/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly usagePing: UsagePingService,
  ) {}

  /**
   * The `dashboard_viewed` funnel step is recorded here rather than by the browser.
   *
   * This request *is* the view — reaching it means the guard passed, the workspace resolved and
   * a summary is about to be computed, none of which a client-side beacon can vouch for. The
   * ping is not awaited and cannot fail the request (`recordQuietly`), and it collapses to one
   * row per user per workspace per UTC day, so the tenth refresh of an afternoon writes
   * nothing.
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Read the workspace dashboard aggregates',
    description: [
      'Computed per request. `byColumn` is present only when `?boardId=` is set.',
      '',
      '**`byAssignee[].count` is assignments, not tasks.** A task with three assignees',
      'contributes one to each, so the sum deliberately exceeds `totalTasks` on a board that',
      'uses multiple assignees; `Unassigned` is the exception and is a task count.',
      '',
      'Also records the `dashboard_viewed` activation step \u2014 here rather than from the',
      'browser, because reaching this handler *is* the view.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: DashboardSummarySchema })
  @WorkspaceScoped()
  summary(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardSummaryDto> {
    this.usagePing.recordQuietly(user.id, workspaceId, UsagePingKind.DashboardView);
    return this.dashboardService.summary(workspaceId, query);
  }
}
