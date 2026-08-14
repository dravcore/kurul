import { Injectable, NotFoundException } from '@nestjs/common';
import type { TaskDto } from '@kurultay/shared-types';
import { POSITION_GAP, midpoint } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateChecklistDto } from './dto/create-checklist.dto';
import type { MoveChecklistDto } from './dto/move-checklist.dto';
import type { UpdateChecklistDto } from './dto/update-checklist.dto';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

/**
 * Checklists of a task. A sibling of `TaskLabelService`, and deliberately shaped like it:
 * the task read resolves the tenant, the mutation rides the relation, and the response is
 * whatever `TaskEventsService` re-reads — so the HTTP reply and the board broadcast describe
 * the same state. No checklist-specific socket event exists; a checklist change *is* a task
 * change (see ADR 0023).
 */
@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskRead: TaskReadService,
    private readonly taskEvents: TaskEventsService,
  ) {}

  async create(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: CreateChecklistDto,
  ): Promise<TaskDto> {
    const task = await this.taskRead.findTaskBasic(workspaceId, taskId);

    await this.prisma.$transaction(async (tx) => {
      // Same race, one level up: the new checklist's position comes from the current last one,
      // so concurrent adds to the same task must not read that row at the same time. Ten
      // concurrent adds produced five distinct positions before this lock existed. The lock is
      // on the task, because the task owns the end of *its* list of checklists.
      await tx.$executeRaw`SELECT id FROM "Task" WHERE id = ${task.id} FOR UPDATE`;

      const siblings = await tx.checklist.findMany({
        where: { taskId: task.id },
        orderBy: { position: 'desc' },
        take: 1,
        select: { id: true, position: true },
      });
      const position = (siblings[0]?.position ?? 0) + POSITION_GAP;

      await tx.checklist.create({
        data: { taskId: task.id, title: dto.title, position },
      });
    });

    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async update(
    workspaceId: string,
    taskId: string,
    actorId: string,
    checklistId: string,
    dto: UpdateChecklistDto,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    const result = await this.prisma.checklist.updateMany({
      where: { id: checklistId, taskId, task: { board: { workspaceId } } },
      data: { title: dto.title },
    });
    if (result.count === 0) throw new NotFoundException('Checklist not found');
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async remove(
    workspaceId: string,
    taskId: string,
    actorId: string,
    checklistId: string,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    // Reachable only through its task, so the tenant scope rides the relation rather than
    // resting on the read above — the same shape `TaskLabelService.removeLabel` uses.
    const result = await this.prisma.checklist.deleteMany({
      where: { id: checklistId, taskId, task: { board: { workspaceId } } },
    });
    if (result.count === 0) throw new NotFoundException('Checklist not found');
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async move(
    workspaceId: string,
    taskId: string,
    actorId: string,
    checklistId: string,
    dto: MoveChecklistDto,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    const siblings = await this.prisma.checklist.findMany({
      where: { taskId },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    if (!siblings.some((row) => row.id === checklistId)) {
      throw new NotFoundException('Checklist not found');
    }

    const others = siblings.filter((row) => row.id !== checklistId);
    const afterIndex = dto.afterId ? others.findIndex((row) => row.id === dto.afterId) : -1;
    if (dto.afterId && afterIndex === -1) {
      throw new NotFoundException('Checklist not found');
    }
    const prev = afterIndex >= 0 ? (others[afterIndex]?.position ?? null) : null;
    const next = others[afterIndex + 1]?.position ?? null;

    await this.prisma.checklist.update({
      where: { id: checklistId },
      data: { position: midpoint(prev, next) },
    });
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }
}
