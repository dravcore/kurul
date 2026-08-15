import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentKind } from '@kurultay/shared-types';
import type { AttachmentDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import { ThrottleAttachmentUpload } from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AttachmentService } from './attachment.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import type { UploadedFile as MulterFile } from './multer-file';

/**
 * Mounted at the workspace root like `CommentController`, because three of its five routes are
 * addressed by attachment id rather than through a task (`api-conventions.md` — once a resource
 * has an id, address it shallowly).
 *
 * ## Deletion is open to every content role
 *
 * `CommentService.remove` draws an author/admin line (ADR 0012); this does not. The reasoning is
 * permission arithmetic rather than analogy: a user with the same role can already
 * `DELETE .../tasks/:taskId`, and `Attachment.taskId` is `onDelete: Cascade`, so that delete
 * takes the attachment with it. Restricting the single detach would close the less destructive
 * path while leaving the more destructive one open — a UI trap, not an authorization check.
 * ADR 0012's line protects a person's *statement*; a file is card content, the same class as a
 * checklist item, which carries the same decision.
 */
@Controller('workspaces/:workspaceId')
export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  @Get('tasks/:taskId/attachments')
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
  ): Promise<AttachmentDto[]> {
    return this.attachments.list(workspaceId, taskId);
  }

  /**
   * One endpoint, two body shapes (plan decision D7).
   *
   * `FileInterceptor` is a no-op on a request that is not `multipart/form-data`:
   * `multer/lib/make-middleware.js:18` is `if (!is(req, ['multipart'])) return next()`. So a
   * JSON body carrying `kind: "LINK"` arrives here with `file` undefined and `dto` populated.
   * `kind` is read from the body rather than inferred from the file's presence, so a request
   * that carries neither gets a validation error naming what is missing.
   *
   * No options are passed here. `memoryStorage()` and `limits` come from
   * `MulterModule.registerAsync` in `attachment.module.ts`, which resolves them through DI at
   * module setup — inline options would be evaluated when this file is imported and would freeze
   * `ATTACHMENT_MAX_BYTES` for the process (plan decision D5).
   */
  @Post('tasks/:taskId/attachments')
  @WorkspaceRoles(...CONTENT_ROLES)
  @ThrottleAttachmentUpload()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
    @UploadedFile() file?: MulterFile,
  ): Promise<AttachmentDto> {
    if (dto.kind === AttachmentKind.Link) {
      return this.attachments.createLink(workspaceId, taskId, user.id, dto);
    }
    if (file === undefined) {
      throw new BadRequestException('A file attachment needs a file part named "file"');
    }
    return this.attachments.createFile(workspaceId, taskId, user.id, file);
  }

  @Get('attachments/:attachmentId')
  @WorkspaceScoped()
  findOne(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('attachmentId') attachmentId: string,
  ): Promise<AttachmentDto> {
    return this.attachments.findOne(workspaceId, attachmentId);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(204)
  @WorkspaceRoles(...CONTENT_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.attachments.remove(workspaceId, attachmentId, user.id);
  }
}
