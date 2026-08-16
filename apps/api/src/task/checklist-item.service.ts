import { Injectable, NotFoundException } from '@nestjs/common';
import type { TaskDto } from '@kurul/shared-types';
import { POSITION_GAP, midpoint } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import type { MoveChecklistItemDto } from './dto/move-checklist-item.dto';
import type { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';
import { toTaskDetailDto } from './task.mapper';

/**
 * Items inside a task's checklists.
 *
 * An item sits two relations away from the tenant (`item → checklist → task → board`), so
 * every write filters on the full path rather than on the id it was handed. An id alone is a
 * value the caller chose; the path is the only part the caller cannot forge.
 */
@Injectable()
export class ChecklistItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskRead: TaskReadService,
    private readonly taskEvents: TaskEventsService,
  ) {}

  async create(
    workspaceId: string,
    taskId: string,
    actorId: string,
    checklistId: string,
    dto: CreateChecklistItemDto,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    const checklist = await this.prisma.checklist.findFirst({
      where: { id: checklistId, taskId, task: { board: { workspaceId } } },
      select: { id: true },
    });
    if (!checklist) throw new NotFoundException('Checklist not found');

    await this.prisma.$transaction(async (tx) => {
      // Serialize appends per checklist: the position is derived from the current last row, so
      // two concurrent adds that both read the same last row would both write the same
      // position. Measured, not assumed — twenty concurrent adds produced nine distinct
      // positions before this lock existed (see `checklist.e2e-spec.ts`).
      //
      // The lock is on the parent checklist rather than on the items, because the thing being
      // protected is the *end of the list*, which no single item owns. Same shape as the
      // Column lock `TaskService.create` takes before reading its siblings.
      await tx.$executeRaw`SELECT id FROM "Checklist" WHERE id = ${checklistId} FOR UPDATE`;

      const last = await tx.checklistItem.findMany({
        where: { checklistId },
        orderBy: { position: 'desc' },
        take: 1,
        select: { id: true, position: true },
      });
      await tx.checklistItem.create({
        data: {
          checklistId,
          content: dto.content,
          position: (last[0]?.position ?? 0) + POSITION_GAP,
        },
      });
    });
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async update(
    workspaceId: string,
    taskId: string,
    actorId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    const where = { id: itemId, checklist: { taskId, task: { board: { workspaceId } } } };

    // The two fields named one at a time rather than handing the request object to Prisma.
    // Spreading the DTO is safe only for as long as the global pipe keeps `whitelist` +
    // `forbidNonWhitelisted` on — a setting in another file, which nothing here would notice
    // being relaxed. Naming them costs two lines and makes this line true on its own.
    const data: { content?: string; isDone?: boolean } = {};
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.isDone !== undefined) data.isDone = dto.isDone;

    // A PATCH with an empty body is not an edit. Writing nothing and then broadcasting anyway
    // fans a `task:updated` out to every member watching the board, each of whom re-reads the
    // task over REST to discover nothing changed — invisible in a test, noise under load. The
    // row is still looked up under the full tenant path, so an unknown or foreign item is
    // still a 404 rather than a silent 200.
    //
    // Narrower than `TaskService.update`'s suppression, deliberately: that one compares values
    // and skips a PATCH that re-sends what is already stored. This one only recognises an
    // absent payload. Whether re-sending `isDone: true` on an item that is already done should
    // also be silent is a separate question, and not one an empty body answers.
    if (Object.keys(data).length === 0) {
      const existing = await this.prisma.checklistItem.findFirst({ where, select: { id: true } });
      if (!existing) throw new NotFoundException('Checklist item not found');
      return toTaskDetailDto(await this.taskRead.findTask(workspaceId, taskId));
    }

    const result = await this.prisma.checklistItem.updateMany({ where, data });
    if (result.count === 0) throw new NotFoundException('Checklist item not found');
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async remove(
    workspaceId: string,
    taskId: string,
    actorId: string,
    itemId: string,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    const result = await this.prisma.checklistItem.deleteMany({
      where: { id: itemId, checklist: { taskId, task: { board: { workspaceId } } } },
    });
    if (result.count === 0) throw new NotFoundException('Checklist item not found');
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async move(
    workspaceId: string,
    taskId: string,
    actorId: string,
    itemId: string,
    dto: MoveChecklistItemDto,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    // Looks like a redundant read next to the scoped write below, and is not: the item's
    // siblings cannot be listed without knowing which checklist owns it, and that same read
    // is what proves the item is in this tenant.
    const owner = await this.prisma.checklistItem.findFirst({
      where: { id: itemId, checklist: { taskId, task: { board: { workspaceId } } } },
      select: { checklistId: true },
    });
    if (!owner) throw new NotFoundException('Checklist item not found');

    const siblings = await this.prisma.checklistItem.findMany({
      where: { checklistId: owner.checklistId },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    const others = siblings.filter((row) => row.id !== itemId);
    const afterIndex = dto.afterId ? others.findIndex((row) => row.id === dto.afterId) : -1;
    if (dto.afterId && afterIndex === -1) {
      throw new NotFoundException('Checklist item not found');
    }
    const prev = afterIndex >= 0 ? (others[afterIndex]?.position ?? null) : null;
    const next = others[afterIndex + 1]?.position ?? null;

    await this.prisma.checklistItem.update({
      where: { id: itemId },
      data: { position: midpoint(prev, next) },
    });
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }
}
