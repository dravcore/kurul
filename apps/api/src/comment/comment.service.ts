import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, MemberRole, SocketEvents } from '@kurultay/shared-types';
import type { CommentDto, CursorPage } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { parseMentions } from '../common/mentions/parse-mentions';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CreateCommentDto } from './dto/create-comment.dto';

export type CommentCursorQuery = {
  cursor?: string;
  limit?: number;
};

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationService: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

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

  /** Cursor-paginated, oldest first — id is UUIDv7 so `id asc` matches `createdAt asc`. */
  async list(
    workspaceId: string,
    taskId: string,
    query: CommentCursorQuery = {},
  ): Promise<CursorPage<CommentDto>> {
    await this.findTask(workspaceId, taskId);
    const limit = query.limit ?? 100;

    const rows = await this.prisma.comment.findMany({
      where: {
        taskId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return {
      items: page.map((comment) => this.toDto(comment)),
      nextCursor,
      hasMore,
    };
  }

  async create(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    const task = await this.findTask(workspaceId, taskId);
    const mentionIds = parseMentions(dto.body).filter((id) => id !== userId);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          taskId,
          userId,
          body: dto.body,
        },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      });

      let memberIds: string[] = [];
      if (mentionIds.length > 0) {
        const members = await tx.workspaceMember.findMany({
          where: { workspaceId, userId: { in: mentionIds } },
          select: { userId: true },
        });
        memberIds = members.map((m) => m.userId);
      }

      const activity = await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId,
        type: ActivityType.CommentCreated,
        payload: {
          commentId: created.id,
          title: task.title,
          mentionedUserIds: memberIds,
        },
      });

      if (memberIds.length > 0) {
        await this.notificationService.createMentionBatch(tx, {
          workspaceId,
          actorId: userId,
          taskId,
          activityId: activity.id,
          userIds: memberIds,
          payload: {
            commentId: created.id,
            taskId,
            title: task.title,
            actorId: userId,
          },
        });
      }

      return this.toDto(created);
    });

    this.realtime.emitToBoard(task.boardId, SocketEvents.COMMENT_ADDED, {
      workspaceId,
      boardId: task.boardId,
      actorId: userId,
      taskId,
      commentId: comment.id,
    });
    return comment;
  }

  async remove(
    workspaceId: string,
    commentId: string,
    actorId: string,
    actorRole: MemberRole,
  ): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, task: { board: { workspaceId } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const isAuthor = comment.userId === actorId;
    const isElevated = actorRole === MemberRole.OWNER || actorRole === MemberRole.ADMIN;
    if (!isAuthor && !isElevated) {
      throw new ForbiddenException('Only the author or an admin can delete this comment');
    }

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
