import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { ActivityType, AttachmentKind, SocketEvents } from '@kurultay/shared-types';
import type { AttachmentDto } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { assertAllowedMimeType } from './attachment-mime';
import { storageKeyFor } from './attachment-storage-key';
import { toAttachmentDto, type AttachmentRow } from './attachment.mapper';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';
import type { UploadedFile } from './multer-file';

/** The only two schemes a stored URL may carry. See K7 / ADR 0024. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Attachments on a task.
 *
 * Its own module rather than a sub-resource of `task/` (ADR 0024): three of the five endpoints
 * are addressed by attachment id and not through a task, and the module carries a storage port,
 * a multer interceptor and the API's only byte-streaming handler — none of which belong in the
 * file issue #40 already asks to shrink.
 *
 * The tenant scope rides the relation the way `ChecklistService` rides it, and the task is
 * resolved here rather than through `TaskReadService`, which `task.module.ts` deliberately does
 * not export — the same choice `CommentService.findTask` made.
 *
 * The realtime announcement is made here too, through `RealtimeService` directly, rather than
 * through `TaskEventsService.emitUpdated`. `emitUpdated` re-reads the task so that the HTTP
 * response and the broadcast describe one state; these endpoints answer with `AttachmentDto` and
 * never with `TaskDto`, so there is no such response to keep in step, and exporting another
 * module's internals to get it would be paying for a guarantee nothing here needs (ADR 0024).
 * The event and the payload are still exactly what a task mutation emits — that is K5, and it is
 * unchanged.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
  ) {}

  /** One place builds the broadcast, so the four fields cannot drift between call sites. */
  private announce(workspaceId: string, boardId: string, taskId: string, actorId: string): void {
    this.realtime.emitToBoard(boardId, SocketEvents.TASK_UPDATED, {
      workspaceId,
      boardId,
      actorId,
      taskId,
    });
  }

  async list(workspaceId: string, taskId: string): Promise<AttachmentDto[]> {
    await this.findTask(workspaceId, taskId);
    const rows = await this.prisma.attachment.findMany({
      where: { taskId, task: { board: { workspaceId } } },
      // Newest first, and no cursor page: a task's attachments are naturally few and, unlike
      // comments, do not grow without bound. `id` is UUIDv7, so this is `createdAt desc` served
      // from `@@index([taskId, id])` (plan decision D1/D11).
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => toAttachmentDto(row as AttachmentRow));
  }

  async findOne(workspaceId: string, attachmentId: string): Promise<AttachmentDto> {
    return toAttachmentDto(await this.requireAttachment(workspaceId, attachmentId));
  }

  async createLink(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: CreateAttachmentDto,
  ): Promise<AttachmentDto> {
    const task = await this.findTask(workspaceId, taskId);
    const url = this.requireStorableUrl(dto.url);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attachment.create({
        data: {
          taskId: task.id,
          uploadedById: actorId,
          kind: AttachmentKind.Link,
          filename: dto.filename?.trim() || url,
          storageKey: null,
          mimeType: null,
          size: null,
          url,
        },
      });
      await this.activity.record(tx, {
        workspaceId,
        taskId: task.id,
        userId: actorId,
        type: ActivityType.AttachmentCreated,
        payload: { attachmentId: row.id, kind: AttachmentKind.Link, filename: row.filename },
      });
      return row as AttachmentRow;
    });

    this.announce(workspaceId, task.boardId, task.id, actorId);
    return toAttachmentDto(created);
  }

  async createFile(
    workspaceId: string,
    taskId: string,
    actorId: string,
    file: UploadedFile,
  ): Promise<AttachmentDto> {
    const task = await this.findTask(workspaceId, taskId);

    // Sniff before anything is written anywhere. The declared `mimetype` and the extension both
    // come from the caller and neither is evidence (K3); this throws a 415 that
    // `transformException` passes through untouched.
    const mimeType = await assertAllowedMimeType(file.buffer, file.mimetype);

    // The id is generated here rather than left to `@default(uuid(7))` because the storage key
    // is derived from it and the bytes are written first (plan decision D6). `uuidv7` is already
    // a dependency (`auth/auth.ts`, `common/logging/request-id.ts`).
    const id = uuidv7();
    const storageKey = storageKeyFor(id);

    // Bytes first, row second. The worst outcome of this order is a file with no row, which the
    // nightly sweep removes after the grace period. The worst outcome of the other order is a
    // row with no bytes — a broken download that no sweep can repair. The cheap direction of
    // being wrong is the one that gets chosen (D6).
    await this.storage.write(storageKey, file.buffer);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.attachment.create({
          data: {
            id,
            taskId: task.id,
            uploadedById: actorId,
            kind: AttachmentKind.File,
            filename: displayFilename(file.originalname),
            storageKey,
            mimeType,
            // `buffer.length`, not `file.size`. They agree under `memoryStorage()`, but only one
            // of them is the number of bytes that reached the disk, and this value becomes
            // `Content-Length` on the download — where disagreeing with the stream is a hung or
            // truncated transfer rather than an error anyone sees.
            size: file.buffer.length,
            url: null,
          },
        });
        await this.activity.record(tx, {
          workspaceId,
          taskId: task.id,
          userId: actorId,
          type: ActivityType.AttachmentCreated,
          payload: { attachmentId: row.id, kind: AttachmentKind.File, filename: row.filename },
        });
        return row as AttachmentRow;
      });

      this.announce(workspaceId, task.boardId, task.id, actorId);
      return toAttachmentDto(created);
    } catch (error) {
      // Best effort. If this also fails the file is an orphan, which is a state the sweep
      // already exists to handle — so the rethrow below is never delayed by a cleanup that
      // cannot succeed.
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(workspaceId: string, attachmentId: string, actorId: string): Promise<void> {
    const attachment = await this.requireAttachment(workspaceId, attachmentId);

    await this.prisma.$transaction(async (tx) => {
      // deleteMany, not delete: only deleteMany accepts a relation predicate, so the tenant
      // scope travels with the write rather than resting on the read above.
      const { count } = await tx.attachment.deleteMany({
        where: { id: attachmentId, task: { board: { workspaceId } } },
      });
      if (count === 0) throw new NotFoundException('Attachment not found');

      // One row per singular detach, and only here. A workspace/board/task delete cascades
      // inside Postgres with no application code running, so this write can never describe a
      // bulk removal — which is the boundary `activity.ts`'s comment on `attachment.deleted`
      // claims, and the reason this call sits on this path and nowhere else.
      await this.activity.record(tx, {
        workspaceId,
        taskId: attachment.taskId,
        userId: actorId,
        type: ActivityType.AttachmentDeleted,
        payload: {
          attachmentId,
          kind: attachment.kind,
          filename: attachment.filename,
        },
      });
    });

    // The bytes are NOT unlinked here, and that is the design rather than an omission:
    // `Workspace → Board → Task` cascades entirely inside Postgres, so an inline unlink would
    // miss every bulk delete and leave the codebase with two deletion paths, one of which is
    // wrong most of the time. The nightly sweep owns it (ADR 0022, Görev 9).
    this.announce(workspaceId, attachment.task.boardId, attachment.taskId, actorId);
  }

  /**
   * `http:`/`https:` and nothing else.
   *
   * `javascript:` rendered into an `href` is stored XSS with one click, and `data:`/`file:` are
   * the same trick with different spelling. The server also never *requests* whatever this
   * returns — see K7 for why a link preview is a capability and not a feature.
   */
  private requireStorableUrl(value: string | undefined): string {
    let parsed: URL;
    try {
      parsed = new URL((value ?? '').trim());
    } catch {
      throw new BadRequestException('A link attachment needs an http or https URL');
    }
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      throw new BadRequestException('A link attachment needs an http or https URL');
    }
    return parsed.toString();
  }

  private async requireAttachment(
    workspaceId: string,
    attachmentId: string,
  ): Promise<AttachmentRow & { task: { boardId: string } }> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, task: { board: { workspaceId } } },
      // The board id comes back on the same read the tenant check already needs, so the
      // broadcast costs no extra query — the relation the scope travels on carries it.
      include: { task: { select: { boardId: true } } },
    });
    // 404, never 403 — a 403 would confirm the row exists (docs/api-conventions.md).
    if (!row) throw new NotFoundException('Attachment not found');
    return row as AttachmentRow & { task: { boardId: string } };
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
      select: { id: true, title: true, boardId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}

/**
 * The name shown next to the attachment.
 *
 * Path separators are stripped and the basename kept — not because the value could reach a path
 * (it cannot: the key comes from the id, K9) but because `../../../../etc/passwd` rendered as a
 * filename in the UI is a phishing surface, and a name is a name. CR and LF go too: this string
 * is later written into a `Content-Disposition` header (D8).
 */
function displayFilename(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[\r\n"\\]/g, '').trim();
  return cleaned === '' ? 'attachment' : cleaned.slice(0, 255);
}
