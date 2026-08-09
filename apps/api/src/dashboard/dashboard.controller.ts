import { Controller } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

/** Nested under workspace for tenant scoping. Handlers land in Phase 7. */
@Controller('workspaces/:workspaceId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}
}
