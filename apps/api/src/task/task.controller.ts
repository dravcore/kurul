import { Controller } from '@nestjs/common';
import { TaskService } from './task.service';

/** Nested under workspace for tenant scoping. Handlers land in Phase 4. */
@Controller('workspaces/:workspaceId/tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}
}
