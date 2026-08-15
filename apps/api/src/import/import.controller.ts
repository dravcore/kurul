import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { TrelloImportReportDto } from '@kurultay/shared-types';
import type { UploadedFile as MulterFile } from '../attachment/multer-file';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { ADMIN_ROLES, WorkspaceRoles } from '../common/decorators/workspace-roles.decorator';
import { ThrottleImport } from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { TrelloImportService } from './trello-import.service';

@Controller('workspaces/:workspaceId/imports')
export class ImportController {
  constructor(private readonly imports: TrelloImportService) {}

  /**
   * Imports a Trello board export, answering with the report of what did and did not come across.
   *
   * ## Multipart, not JSON, and that is the decision rather than the convenience
   *
   * A real Trello export is several megabytes; the JSON body limit is `REQUEST_BODY_MAX_BYTES`
   * (1 MiB, `common/body-limits.ts`) and raising it would hand the same DoS surface to every
   * other endpoint this API has. So the body arrives as a single file part named `file`, under a
   * limit this module owns (`import-config.ts`).
   *
   * ## `ADMIN_ROLES`, by permission arithmetic
   *
   * An import creates a board *and its columns*. `POST .../boards` is `CONTENT_ROLES`, but
   * `POST .../boards/:boardId/columns` is admin-only (`board/column.controller.ts`). An endpoint
   * must not do in one request what its caller cannot do in several, so creating columns makes
   * this admin-only too. Membership is still answered with 404 rather than 403 — `WorkspaceGuard`
   * runs first and owns that rule; the 403 belongs only to a member whose role is too low.
   *
   * ## No DTO, and no body at all
   *
   * There is nothing to validate: the endpoint takes one file and reads the workspace from the
   * path. The export itself is not validated by a pipe either, deliberately — a pipe would put a
   * `JSON.parse` of up to 20 MiB *in front of* the guard chain, so an unauthenticated request
   * could spend that parse. `TrelloImportService` reads it after the guards have run.
   *
   * No options are passed to `FileInterceptor`. `memoryStorage()` and `limits` come from
   * `MulterModule.register` in `import.module.ts`; inline options would be evaluated when this
   * file is imported and would freeze `TRELLO_IMPORT_MAX_BYTES` for the process.
   */
  @Post('trello')
  @WorkspaceRoles(...ADMIN_ROLES)
  @ThrottleImport()
  @UseInterceptors(FileInterceptor('file'))
  trello(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: MulterFile,
  ): Promise<TrelloImportReportDto> {
    if (file === undefined) {
      throw new BadRequestException('A Trello import needs a file part named "file"');
    }
    return this.imports.importBoard(workspaceId, user.id, file.buffer);
  }
}
