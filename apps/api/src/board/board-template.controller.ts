import { Controller, Get, Headers } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { BoardTemplateDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import type { AuthenticatedUser } from '../common/types/request-context';
import { BoardTemplateSchema } from '../openapi/schemas/board.schema';
import { BoardService } from './board.service';

/**
 * Its own controller rather than another route on `BoardController`, because the prefix is
 * different: `board-templates` is a sibling of `boards`, not a sub-resource of one. A template
 * is not a board and is not owned by a board — there is no `:boardId` it could hang under.
 */
@ApiTags('Boards')
@Controller('workspaces/:workspaceId')
export class BoardTemplateController {
  constructor(private readonly boardService: BoardService) {}

  /**
   * `Accept-Language` is read here for the same reason `POST boards` reads it: what comes back
   * is a preview of rows that are about to be written into the database in the creator's
   * language, so the preview has to resolve the language the same way the write will.
   */
  @Get('board-templates')
  @ApiOperation({
    summary: 'List the board templates',
    description:
      'Not paginated, and not workspace data: the catalog is fixed at build time and identical ' +
      'in every workspace. It is nested under one anyway, because every resource-bearing route ' +
      'is. Names come back in the creator’s language — these are the exact rows a ' +
      'create would write, not interface text.',
  })
  @ApiOkResponse({ type: [BoardTemplateSchema] })
  @WorkspaceScoped()
  list(
    // Bound but unused: the guard reads the workspace off the request itself, and binding it
    // here is what puts the UUIDv7 pipe in front of it and the path parameter in the spec.
    @UuidParam('workspaceId') _workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<BoardTemplateDto[]> {
    return this.boardService.listTemplates(user.id, acceptLanguage);
  }
}
