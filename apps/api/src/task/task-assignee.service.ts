import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivityType } from '@kurultay/shared-types';
import type { TaskDto } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AddAssigneeDto } from './dto/add-assignee.dto';
import { emitTaskUpdated, findTask, findTaskBasic, isPrismaUniqueViolation } from './task.mapper';

@Injectable()
export class TaskAssigneeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationService: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  async addAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddAssigneeDto,
  ): Promise<TaskDto> {
    const task = await findTaskBasic(this.prisma, workspaceId, taskId);
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: dto.userId },
    });
    if (!member) {
      throw new UnprocessableEntityException('User is not a member of this workspace');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskAssignee.create({
          data: { taskId: task.id, userId: dto.userId },
        });

        const activity = await this.activityService.record(tx, {
          workspaceId,
          taskId: task.id,
          userId: actorId,
          type: ActivityType.TaskAssigned,
          payload: {
            title: task.title,
            assigneeUserId: dto.userId,
          },
        });

        await this.notificationService.createAssignment(tx, {
          workspaceId,
          userId: dto.userId,
          actorId,
          taskId: task.id,
          activityId: activity.id,
          payload: {
            title: task.title,
            assigneeUserId: dto.userId,
            actorId,
          },
        });
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictException('User is already assigned to this task');
      }
      throw error;
    }

    return emitTaskUpdated(
      this.realtime,
      workspaceId,
      actorId,
      await findTask(this.prisma, workspaceId, taskId),
    );
  }

  async removeAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    assigneeUserId: string,
  ): Promise<TaskDto> {
    const task = await findTaskBasic(this.prisma, workspaceId, taskId);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.taskAssignee.deleteMany({
        where: { taskId, userId: assigneeUserId },
      });
      if (result.count === 0) throw new NotFoundException('Assignee not found');

      await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId: actorId,
        type: ActivityType.TaskUnassigned,
        payload: {
          title: task.title,
          assigneeUserId,
        },
      });
    });
    return emitTaskUpdated(
      this.realtime,
      workspaceId,
      actorId,
      await findTask(this.prisma, workspaceId, taskId),
    );
  }
}
