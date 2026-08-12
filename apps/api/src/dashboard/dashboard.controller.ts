import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardSummaryDto } from '@kurultay/shared-types';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardService } from './dashboard.service';

/** Nested under workspace for tenant scoping. */
@Controller('workspaces/:workspaceId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @WorkspaceScoped()
  summary(
    @UuidParam('workspaceId') workspaceId: string,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardSummaryDto> {
    return this.dashboardService.summary(workspaceId, query);
  }
}
