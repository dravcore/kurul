import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, SocketEvents } from '@kurul/shared-types';
import type { CursorPage, NotificationDto, NotificationUnreadCountDto } from '@kurul/shared-types';
import type { Prisma } from '../generated/prisma';
import { toCursorPage } from '../common/pagination/cursor-page';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export type NotificationDb = PrismaService | Prisma.TransactionClient;

export type CreateNotificationInput = {
  workspaceId: string;
  /** Recipient */
  userId: string;
  /** Acting user — never notify when equal to recipient */
  actorId: string;
  /**
   * Narrowed to the shared-types union so a typo cannot reach the database from application
   * code (#37's TypeScript half). `Notification.type` stays a `String` column, not a Prisma
   * enum, for the same reason `Activity.type` does.
   */
  type: NotificationType;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Tell each recipient that their unread count in this workspace changed.
   *
   * **Call this after the write has committed.** `create`, `createAssignment` and
   * `createMentionBatch` all run inside the caller's transaction, so they deliberately do not
   * publish: a signal sent before `COMMIT` invites the client to read a count that does not
   * include the new row yet, and with polling gone that lost increment would sit on the badge
   * until the next notification arrives. The read paths below own their transaction, so they
   * publish here themselves.
   *
   * One signal per recipient, never one per row — a mention batch or a due-soon scan that
   * inserts hundreds of rows still sends each user exactly one event, which is what keeps a
   * bulk insert from turning into an emit storm. That is only affordable because the payload
   * says "your count changed" rather than carrying the notifications themselves.
   */
  emitUnreadChanged(workspaceId: string, userIds: readonly string[]): void {
    for (const userId of new Set(userIds)) {
      this.realtime.emitToUser(
        workspaceId,
        userId,
        SocketEvents.NOTIFICATION_UNREAD_CHANGED,
        // The room is already scoped to this pair; the payload repeats it so a client holding
        // several workspaces open can tell which badge to refresh.
        { workspaceId, userId },
      );
    }
  }

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

  /**
   * Insert a notification unless the actor is the recipient.
   *
   * Publishes nothing: `db` is usually the caller's transaction client. The caller signals the
   * recipient with `emitUnreadChanged` once that transaction has committed.
   */
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
   *
   * Publishes nothing, for the same reason as `create`; the caller emits one signal per
   * recipient after its transaction commits.
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
    const { row, changed } = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: read and write split apart leave a window in which the row
      // can be deleted (user removal cascades) between the idempotency check and the update.
      const existing = await tx.notification.findFirst({
        where: { id: notificationId, workspaceId, userId },
      });
      if (!existing) throw new NotFoundException('Notification not found');

      if (existing.readAt) return { row: existing, changed: false };

      // The write predicate repeats both scopes. workspaceId is the tenant boundary, but userId
      // is the tighter one that actually matters here: a notification is private to its
      // recipient, so a workspace-only predicate would let any member of the same workspace
      // mark someone else's row read. `markAllRead` already filters on the same pair.
      const updated = await tx.notification.update({
        where: { id: notificationId, workspaceId, userId },
        data: { readAt: new Date() },
      });
      return { row: updated, changed: true };
    });

    // Only when the count actually moved. The signal goes to the recipient's room, which every
    // tab of theirs holds open — including the one that did not issue this request, and the bell
    // sitting next to the list page that did.
    if (changed) this.emitUnreadChanged(workspaceId, [userId]);
    return this.toDto(row);
  }

  async markAllRead(workspaceId: string, userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { workspaceId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) this.emitUnreadChanged(workspaceId, [userId]);
    return { updated: result.count };
  }
}
