import { Controller } from '@nestjs/common';
import { CommentService } from './comment.service';

/** Nested under workspace for tenant scoping. Handlers land in Phase 5. */
@Controller('workspaces/:workspaceId/comments')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}
}
