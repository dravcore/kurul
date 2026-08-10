import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import type {
  CursorPage,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@kurultay/shared-types';
import type { Prisma } from '../generated/prisma';
import { toCursorPage } from '../common/pagination/cursor-page';
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
  type?: string;
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
   * Bulk-inserts mention notifications for a comment in a single `createMany` instead of
   * one `create` per mentioned user — mirrors the due-soon worker's batch insert.
   */
  async createMentionBatch(
    db: NotificationDb,
    input: {
      workspaceId: string;
      actorId: string;
      taskId: string;
      activityId?: string | null;
      userIds: string[];
      payload: Record<string, unknown>;
    },
  ): Promise<number> {
    const recipients = [...new Set(input.userIds)].filter((userId) => userId !== input.actorId);
    if (recipients.length === 0) return 0;

    const result = await db.notification.createMany({
      data: recipients.map((userId) => ({
        workspaceId: input.workspaceId,
        userId,
        type: NotificationType.Mention,
        taskId: input.taskId,
        activityId: input.activityId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      })),
    });
    return result.count;
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
        ...(query.type ? { type: query.type } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    return toCursorPage(rows, limit, (row) => this.toDto(row));
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
    const row = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: read and write split apart leave a window in which the row
      // can be deleted (user removal cascades) between the idempotency check and the update.
      const existing = await tx.notification.findFirst({
        where: { id: notificationId, workspaceId, userId },
      });
      if (!existing) throw new NotFoundException('Notification not found');

      if (existing.readAt) return existing;

      // The write predicate repeats both scopes. workspaceId is the tenant boundary, but userId
      // is the tighter one that actually matters here: a notification is private to its
      // recipient, so a workspace-only predicate would let any member of the same workspace
      // mark someone else's row read. `markAllRead` already filters on the same pair.
      return tx.notification.update({
        where: { id: notificationId, workspaceId, userId },
        data: { readAt: new Date() },
      });
    });
    return this.toDto(row);
  }

  async markAllRead(workspaceId: string, userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { workspaceId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
