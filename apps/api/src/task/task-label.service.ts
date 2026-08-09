import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TaskDto } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AddTaskLabelDto } from './dto/add-task-label.dto';
import { emitTaskUpdated, findTask, isPrismaUniqueViolation } from './task.mapper';

@Injectable()
export class TaskLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async addLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddTaskLabelDto,
  ): Promise<TaskDto> {
    const task = await findTask(this.prisma, workspaceId, taskId);
    const label = await this.prisma.label.findFirst({
      where: { id: dto.labelId, boardId: task.boardId },
    });
    if (!label) {
      throw new UnprocessableEntityException('Label does not belong to this task board');
    }

    try {
      await this.prisma.taskLabel.create({
        data: { taskId: task.id, labelId: label.id },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictException('Label is already assigned to this task');
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

  async removeLabel(
    workspaceId: string,
    taskId: string,
    actorId: string,
    labelId: string,
  ): Promise<TaskDto> {
    await findTask(this.prisma, workspaceId, taskId);
    const result = await this.prisma.taskLabel.deleteMany({
      where: { taskId, labelId },
    });
    if (result.count === 0) throw new NotFoundException('Task label not found');
    return emitTaskUpdated(
      this.realtime,
      workspaceId,
      actorId,
      await findTask(this.prisma, workspaceId, taskId),
    );
  }
}
