import { Injectable } from '@nestjs/common';
import type { TaskDto } from '@kurultay/shared-types';
import { POSITION_GAP } from '../common/position/fractional-index';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateChecklistDto } from './dto/create-checklist.dto';
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

    const siblings = await this.prisma.checklist.findMany({
      where: { taskId: task.id },
      orderBy: { position: 'desc' },
      take: 1,
      select: { id: true, position: true },
    });
    const position = (siblings[0]?.position ?? 0) + POSITION_GAP;

    await this.prisma.checklist.create({
      data: { taskId: task.id, title: dto.title, position },
    });

    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }
}
