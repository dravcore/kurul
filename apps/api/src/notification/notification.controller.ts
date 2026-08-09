import { Controller } from '@nestjs/common';
import { NotificationService } from './notification.service';

/** Nested under workspace for tenant scoping. Handlers land in Phase 8. */
@Controller('workspaces/:workspaceId/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}
}
