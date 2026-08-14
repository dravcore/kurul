import { Injectable, NotFoundException } from '@nestjs/common';
import type { TaskDto } from '@kurultay/shared-types';
import { POSITION_GAP, midpoint } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import type { MoveChecklistItemDto } from './dto/move-checklist-item.dto';
import type { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

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
    const result = await this.prisma.checklistItem.updateMany({
      where: { id: itemId, checklist: { taskId, task: { board: { workspaceId } } } },
      data: dto,
    });
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
