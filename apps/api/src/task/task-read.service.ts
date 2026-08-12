import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { taskInclude, type TaskWithRelations } from './task.include';

/**
 * The task module's scoped reads.
 *
 * These used to be free functions taking a `PrismaService` argument, which made every caller
 * pass the client around by hand. As a provider they take it through DI, and the workspace
 * predicate lives in exactly one place: a task is only ever found through its board's
 * workspace, so a cross-tenant id is a 404 and never a 403 (docs/api-conventions.md).
 */
@Injectable()
export class TaskReadService {
  constructor(private readonly prisma: PrismaService) {}

  async findTask(workspaceId: string, taskId: string): Promise<TaskWithRelations> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /**
   * Lightweight existence/ownership check that skips the assignees/labels relations —
   * use this for pre-mutation reads where only id/title/boardId are needed, and reserve
   * `findTask` for the single read that builds the response DTO.
   */
  async findTaskBasic(
    workspaceId: string,
    taskId: string,
  ): Promise<{ id: string; title: string; boardId: string }> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
      select: { id: true, title: true, boardId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
