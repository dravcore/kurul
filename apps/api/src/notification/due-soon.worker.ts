import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import { Queue, Worker, type Job } from 'bullmq';
import { envString } from '../common/env';
import { parseRedisUrl } from '../common/redis-url';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

const QUEUE_NAME = 'due-soon';
const JOB_NAME = 'scan-due-soon';
const JOB_ID = 'due-soon-scan';
const REPEAT_EVERY_MS = 15 * 60 * 1000;
export const DUE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Page size for the due-task scan — bounds memory/row-count per query instead of loading the whole window at once. */
export const SCAN_BATCH_SIZE = 500;

type ScanTaskRow = {
  id: string;
  title: string;
  dueDate: Date | null;
  board: { workspaceId: string };
  assignees: { userId: string }[];
};

@Injectable()
export class DueSoonWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DueSoonWorker.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = envString('REDIS_URL', '');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL unset — due-soon worker not started');
      return;
    }

    let connection: { host: string; port: number; password?: string };
    try {
      connection = parseRedisUrl(redisUrl);
    } catch {
      this.logger.error(`Invalid REDIS_URL — due-soon worker not started`);
      return;
    }

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), { connection });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `due-soon job ${job?.id ?? '?'} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    await this.queue.add(
      JOB_NAME,
      {},
      {
        jobId: JOB_ID,
        repeat: { every: REPEAT_EVERY_MS },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`due-soon worker registered (every ${REPEAT_EVERY_MS / 60000}m)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Exposed for tests — scan once.
   *
   * Walks the due window in keyset-paginated batches (ordered by dueDate, id) rather than
   * loading every due task into memory in one query, so the scan stays bounded as the
   * table grows.
   */
  async runScan(): Promise<number> {
    const now = new Date();
    const until = new Date(now.getTime() + DUE_WINDOW_MS);
    const since = new Date(now.getTime() - DUE_WINDOW_MS);

    let cursor: { dueDate: Date; id: string } | null = null;
    let totalCreated = 0;
    // Recipients are collected across every page and signalled once at the end. A scan can
    // insert thousands of rows over many batches; a per-row — or even per-batch — emit would
    // hand the same user a burst of identical "your count changed" signals, and each one costs
    // that browser an unread-count request.
    const recipientsByWorkspace = new Map<string, Set<string>>();

    for (;;) {
      const tasks: ScanTaskRow[] = await this.prisma.task.findMany({
        where: {
          dueDate: { gt: now, lte: until },
          assignees: { some: {} },
          ...(cursor
            ? {
                OR: [
                  { dueDate: { gt: cursor.dueDate } },
                  { dueDate: cursor.dueDate, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          board: { select: { workspaceId: true } },
          assignees: { select: { userId: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: SCAN_BATCH_SIZE,
      });

      if (tasks.length === 0) break;

      const { created, recipients } = await this.notifyBatch(tasks, since);
      totalCreated += created;
      for (const recipient of recipients) {
        const users = recipientsByWorkspace.get(recipient.workspaceId) ?? new Set<string>();
        users.add(recipient.userId);
        recipientsByWorkspace.set(recipient.workspaceId, users);
      }

      if (tasks.length < SCAN_BATCH_SIZE) break;
      const last = tasks[tasks.length - 1]!;
      if (!last.dueDate) break;
      cursor = { dueDate: last.dueDate, id: last.id };
    }

    // After the inserts, never inside the loop — and one signal per (workspace, user) pair,
    // not one per notification.
    for (const [workspaceId, users] of recipientsByWorkspace) {
      this.notifications.emitUnreadChanged(workspaceId, [...users]);
    }

    return totalCreated;
  }

  private async notifyBatch(
    tasks: ScanTaskRow[],
    since: Date,
  ): Promise<{ created: number; recipients: Array<{ workspaceId: string; userId: string }> }> {
    const taskIds = tasks.map((task) => task.id);
    const userIds = [...new Set(tasks.flatMap((task) => task.assignees.map((row) => row.userId)))];

    const existing = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.DueSoon,
        taskId: { in: taskIds },
        userId: { in: userIds },
        OR: [{ readAt: null }, { createdAt: { gte: since } }],
      },
      select: { userId: true, taskId: true },
    });
    const skip = new Set(
      existing
        .filter((row): row is { userId: string; taskId: string } => row.taskId !== null)
        .map((row) => `${row.userId}:${row.taskId}`),
    );

    const rows: Array<{
      workspaceId: string;
      userId: string;
      type: string;
      taskId: string;
      payload: { title: string; dueDate: string; type: string };
    }> = [];

    for (const task of tasks) {
      if (!task.dueDate) continue;
      for (const assignee of task.assignees) {
        const key = `${assignee.userId}:${task.id}`;
        if (skip.has(key)) continue;
        rows.push({
          workspaceId: task.board.workspaceId,
          userId: assignee.userId,
          type: NotificationType.DueSoon,
          taskId: task.id,
          payload: {
            title: task.title,
            dueDate: task.dueDate.toISOString(),
            type: NotificationType.DueSoon,
          },
        });
      }
    }

    if (rows.length === 0) return { created: 0, recipients: [] };

    const result = await this.prisma.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });
    // `skipDuplicates` can drop rows a concurrent scanner already inserted, so a recipient here
    // may end up with nothing new. The cost of that is one extra unread-count request in a
    // browser whose badge is already correct — cheaper than reading back the inserted rows.
    if (result.count === 0) return { created: 0, recipients: [] };
    return {
      created: result.count,
      recipients: rows.map((row) => ({ workspaceId: row.workspaceId, userId: row.userId })),
    };
  }

  private async process(_job: Job): Promise<void> {
    const created = await this.runScan();
    if (created > 0) {
      this.logger.log(`due-soon scan created ${created} notification(s)`);
    }
  }
}
