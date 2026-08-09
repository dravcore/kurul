import { Controller } from '@nestjs/common';
import { ActivityService } from './activity.service';

/** Nested under workspace for tenant scoping. Handlers land in Phase 8. */
@Controller('workspaces/:workspaceId/activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}
}
