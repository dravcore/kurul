import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { DashboardSummaryDto } from '@kurultay/shared-types';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { ParseUuidV7Pipe } from '../common/pipes/parse-uuid-v7.pipe';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardService } from './dashboard.service';

/** Nested under workspace for tenant scoping. */
@Controller('workspaces/:workspaceId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @UseGuards(WorkspaceGuard)
  summary(
    @Param('workspaceId', ParseUuidV7Pipe) workspaceId: string,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardSummaryDto> {
    return this.dashboardService.summary(workspaceId, query);
  }
}
