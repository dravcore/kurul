import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { TrelloImportReportDto } from '@kurultay/shared-types';
import { ErrorEnvelopeSchema } from '../openapi/schemas/error.schema';
import { TrelloImportReportSchema } from '../openapi/schemas/import.schema';
import type { UploadedFile as MulterFile } from '../attachment/multer-file';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { ADMIN_ROLES, WorkspaceRoles } from '../common/decorators/workspace-roles.decorator';
import { ThrottleImport } from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { TrelloImportService } from './trello-import.service';

@ApiTags('Import')
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
  @ApiOperation({
    summary: 'Import a Trello board export',
    description: [
      "Takes a Trello board's JSON export and creates a **new board** from it. The API's only",
      'bulk write, and its only endpoint whose collection segment names no readable resource:',
      'there is no `GET /imports` and no import id.',
      '',
      '**Multipart rather than JSON, deliberately.** A real export is several megabytes and',
      '`REQUEST_BODY_MAX_BYTES` is 1 MiB; raising that to fit this one endpoint would hand the',
      'same memory cost to every other endpoint. So the export arrives as a file part under a',
      'ceiling this module owns, and the two numbers measure different things —',
      '`TRELLO_IMPORT_MAX_BYTES` is a **heap** ceiling, `ATTACHMENT_MAX_BYTES` is a **disk** one.',
      '',
      '**`OWNER`/`ADMIN` by permission arithmetic.** Creating a board is a content role, but',
      'creating a *column* is admin-only, and an import creates both. An endpoint must not do in',
      'one request what its caller could not do in several.',
      '',
      '**Not idempotent.** Posting the same export twice creates two boards. There is no dedupe',
      'key, no update-in-place and no "already imported" answer.',
      '',
      'What it deliberately does not carry across: member assignments, comments, column',
      'categories (every imported column arrives `UNSTARTED`) and attachment *bytes* — a Trello',
      'export carries URLs, so every attachment becomes a `LINK`. All of it is counted in the',
      'report rather than dropped silently.',
    ].join('\n'),
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            "The board's JSON export. The only part this endpoint reads; there is no other " +
            'field and no JSON body shape.',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'The board was written, atomically. **This response is the whole report and it is stored ' +
      'nowhere** — a caller that discards it has lost the list of what did not come across.',
    type: TrelloImportReportSchema,
  })
  @ApiBadRequestResponse({
    description:
      'No part named `file`; the file is not valid JSON; or the JSON is not a Trello board ' +
      'export. **Nothing is written when this happens** — the export is read and mapped in ' +
      'full before the transaction opens.',
    type: ErrorEnvelopeSchema,
  })
  @ApiPayloadTooLargeResponse({
    description:
      'The file part is over `TRELLO_IMPORT_MAX_BYTES` (default `20971520` — 20 MiB). This is ' +
      "this module's own limit, not the attachment ceiling and not `REQUEST_BODY_MAX_BYTES`: " +
      'an import stores no bytes at all, so it must keep working on an instance with ' +
      'attachments switched off.',
    type: ErrorEnvelopeSchema,
  })
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
