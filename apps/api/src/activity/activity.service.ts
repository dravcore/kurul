import { Injectable, NotFoundException } from '@nestjs/common';
import type { ActivityDto, CursorPage } from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { toCursorPage } from '../common/pagination/cursor-page';
import { PrismaService } from '../prisma/prisma.service';

export type ActivityDb = PrismaService | Prisma.TransactionClient;

export type RecordActivityInput = {
  workspaceId: string;
  taskId?: string | null;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
};

export type ActivityCursorQuery = {
  cursor?: string;
  limit?: number;
};

const authorSelect = {
  id: true,
  name: true,
  avatarUrl: true,
} as const;

type ActivityRow = {
  id: string;
  workspaceId: string;
  taskId: string | null;
  userId: string;
  type: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  user: { id: string; name: string; avatarUrl: string | null };
};

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: ActivityRow): ActivityDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      taskId: row.taskId,
      userId: row.userId,
      type: row.type,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      author: {
        id: row.user.id,
        name: row.user.name,
        avatarUrl: row.user.avatarUrl,
      },
    };
  }

  /** Append-only write; accepts a transaction client when co-writing with a mutation. */
  async record(db: ActivityDb, input: RecordActivityInput) {
    return db.activity.create({
      data: {
        workspaceId: input.workspaceId,
        taskId: input.taskId ?? null,
        userId: input.userId,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  async listWorkspace(
    workspaceId: string,
    query: ActivityCursorQuery,
  ): Promise<CursorPage<ActivityDto>> {
    return this.list({ workspaceId }, query);
  }

  async listForTask(
    workspaceId: string,
    taskId: string,
    query: ActivityCursorQuery,
  ): Promise<CursorPage<ActivityDto>> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return this.list({ workspaceId, taskId }, query);
  }

  private async list(
    where: { workspaceId: string; taskId?: string },
    query: ActivityCursorQuery,
  ): Promise<CursorPage<ActivityDto>> {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.activity.findMany({
      where: {
        workspaceId: where.workspaceId,
        ...(where.taskId ? { taskId: where.taskId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: { user: { select: authorSelect } },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    return toCursorPage(rows, limit, (row) => this.toDto(row));
  }
}
