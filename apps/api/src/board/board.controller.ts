import { Controller } from '@nestjs/common';
import { BoardService } from './board.service';

/**
 * Nested under workspace for tenant scoping. WorkspaceGuard reads `params.workspaceId`.
 * Handlers land in Phase 3.
 */
@Controller('workspaces/:workspaceId/boards')
export class BoardController {
  constructor(private readonly boardService: BoardService) {}
}
