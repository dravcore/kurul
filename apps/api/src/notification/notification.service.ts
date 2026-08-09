import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import type {
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationDb = PrismaService | Prisma.TransactionClient;

export type CreateNotificationInput = {
  workspaceId: string;
  /** Recipient */
  userId: string;
  /** Acting user — never notify when equal to recipient */
  actorId: string;
  type: string;
  taskId?: string | null;
  activityId?: string | null;
  payload: Record<string, unknown>;
};

export type NotificationCursorQuery = {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
};

const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

type NotificationRow = {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  taskId: string | null;
  activityId: string | null;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: NotificationRow): NotificationDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      type: row.type,
      taskId: row.taskId,
      activityId: row.activityId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Insert a notification unless the actor is the recipient. */
  async create(db: NotificationDb, input: CreateNotificationInput) {
    if (input.userId === input.actorId) return null;
    return db.notification.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        taskId: input.taskId ?? null,
        activityId: input.activityId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  async createAssignment(
    db: NotificationDb,
    input: Omit<CreateNotificationInput, 'type'> & { type?: string },
  ) {
    return this.create(db, { ...input, type: NotificationType.Assignment });
  }

  async createMention(
    db: NotificationDb,
    input: Omit<CreateNotificationInput, 'type'> & { type?: string },
  ) {
    return this.create(db, { ...input, type: NotificationType.Mention });
  }

  /**
   * App-level due_soon idempotency: skip when an unread due_soon already exists
   * for the same user+task, or one was created in the last 24h.
   */
  async shouldSkipDueSoon(db: NotificationDb, userId: string, taskId: string): Promise<boolean> {
    const since = new Date(Date.now() - DUE_SOON_WINDOW_MS);
    const existing = await db.notification.findFirst({
      where: {
        userId,
        taskId,
        type: NotificationType.DueSoon,
        OR: [{ readAt: null }, { createdAt: { gte: since } }],
      },
      select: { id: true },
    });
    return existing !== null;
  }

  async createDueSoon(
    db: NotificationDb,
    input: Omit<CreateNotificationInput, 'type' | 'actorId'> & {
      actorId?: string;
    },
  ) {
    if (!input.taskId) return null;
    if (await this.shouldSkipDueSoon(db, input.userId, input.taskId)) return null;
    // due_soon has no human actor; use a sentinel that never equals recipient
    const actorId = input.actorId ?? '';
    if (actorId && actorId === input.userId) return null;
    return db.notification.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: NotificationType.DueSoon,
        taskId: input.taskId,
        activityId: input.activityId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  async list(
    workspaceId: string,
    userId: string,
    query: NotificationCursorQuery,
  ): Promise<CursorPage<NotificationDto>> {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.notification.findMany({
      where: {
        workspaceId,
        userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return {
      items: page.map((row) => this.toDto(row)),
      nextCursor,
      hasMore,
    };
  }

  async unreadCount(workspaceId: string, userId: string): Promise<NotificationUnreadCountDto> {
    const count = await this.prisma.notification.count({
      where: { workspaceId, userId, readAt: null },
    });
    return { count };
  }

  async markRead(
    workspaceId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, workspaceId, userId },
    });
    if (!existing) throw new NotFoundException('Notification not found');

    if (existing.readAt) return this.toDto(existing);

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    return this.toDto(updated);
  }

  async markAllRead(workspaceId: string, userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { workspaceId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
