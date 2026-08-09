import { Injectable, NotFoundException } from '@nestjs/common';
import type { CommentDto } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCommentDto } from './dto/create-comment.dto';

type CommentRow = {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: Date;
  user: { id: string; name: string; avatarUrl: string | null };
};

@Injectable()
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: CommentRow): CommentDto {
    return {
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: {
        id: row.user.id,
        name: row.user.name,
        avatarUrl: row.user.avatarUrl,
      },
    };
  }

  async list(workspaceId: string, taskId: string): Promise<CommentDto[]> {
    await this.findTask(workspaceId, taskId);
    const comments = await this.prisma.comment.findMany({
      where: { taskId },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return comments.map((comment) => this.toDto(comment));
  }

  async create(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    await this.findTask(workspaceId, taskId);
    const created = await this.prisma.comment.create({
      data: {
        taskId,
        userId,
        body: dto.body,
      },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return this.toDto(created);
  }

  async remove(workspaceId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, task: { board: { workspaceId } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    await this.prisma.comment.delete({ where: { id: commentId } });
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
