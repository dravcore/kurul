import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ActivityType } from '@kurul/shared-types';
import type { TaskDto } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AddTaskLabelDto } from './dto/add-task-label.dto';
import { conflictOnUniqueViolation } from './prisma-unique-violation';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

@Injectable()
export class TaskLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
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

    await conflictOnUniqueViolation(async () => {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });

        await this.activityService.record(tx, {
          workspaceId,
          taskId: task.id,
          userId: actorId,
          type: ActivityType.TaskLabelAdded,
          payload: { labelId: label.id, name: label.name, color: label.color },
        });
      });
    }, 'Label is already assigned to this task');

    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async removeLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    labelId: string,
  ): Promise<TaskDto> {
    const task = await this.taskRead.findTaskBasic(workspaceId, taskId);
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, boardId: task.boardId },
    });
    if (!label) throw new NotFoundException('Task label not found');

    await this.prisma.$transaction(async (tx) => {
      // The join row is reachable only through its task, so the tenant scope rides along the
      // relation instead of resting on the check above.
      const result = await tx.taskLabel.deleteMany({
        where: { taskId, labelId, task: { board: { workspaceId } } },
      });
      if (result.count === 0) throw new NotFoundException('Task label not found');

      await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId: actorId,
        type: ActivityType.TaskLabelRemoved,
        payload: { labelId: label.id, name: label.name, color: label.color },
      });
    });

    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }
}
