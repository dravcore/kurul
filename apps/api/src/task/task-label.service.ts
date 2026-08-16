import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { TaskDto } from '@kurul/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { AddTaskLabelDto } from './dto/add-task-label.dto';
import { conflictOnUniqueViolation } from './prisma-unique-violation';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

@Injectable()
export class TaskLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskRead: TaskReadService,
    private readonly taskEvents: TaskEventsService,
  ) {}

  async addLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddTaskLabelDto,
  ): Promise<TaskDto> {
    const task = await this.taskRead.findTaskBasic(workspaceId, taskId);
    const label = await this.prisma.label.findFirst({
      where: { id: dto.labelId, boardId: task.boardId },
    });
    if (!label) {
      throw new UnprocessableEntityException('Label does not belong to this task board');
    }

    await conflictOnUniqueViolation(
      () => this.prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } }),
      'Label is already assigned to this task',
    );

    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async removeLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    labelId: string,
  ): Promise<TaskDto> {
    await this.taskRead.findTaskBasic(workspaceId, taskId);
    // The join row is reachable only through its task, so the tenant scope rides along the
    // relation instead of resting on the check above.
    const result = await this.prisma.taskLabel.deleteMany({
      where: { taskId, labelId, task: { board: { workspaceId } } },
    });
    if (result.count === 0) throw new NotFoundException('Task label not found');
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }
}
