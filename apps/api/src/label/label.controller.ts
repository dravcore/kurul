import { Controller } from '@nestjs/common';
import { LabelService } from './label.service';

/** Nested under workspace for tenant scoping. Handlers land in Phase 5. */
@Controller('workspaces/:workspaceId/labels')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}
}
