import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@kurultay/shared-types';
import { Queue, Worker, type Job } from 'bullmq';
import { envString } from '../common/env';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

const QUEUE_NAME = 'due-soon';
const JOB_NAME = 'scan-due-soon';
const REPEAT_EVERY_MS = 15 * 60 * 1000;
const DUE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      const url = new URL(redisUrl);
      connection = {
        host: url.hostname,
        port: url.port ? Number(url.port) : 6379,
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      };
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

  /** Exposed for tests — scan once. */
  async runScan(): Promise<number> {
    const now = new Date();
    const until = new Date(now.getTime() + DUE_WINDOW_MS);

    const tasks = await this.prisma.task.findMany({
      where: {
        dueDate: { gt: now, lte: until },
        assignees: { some: {} },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        board: { select: { workspaceId: true } },
        assignees: { select: { userId: true } },
      },
    });

    let created = 0;
    for (const task of tasks) {
      if (!task.dueDate) continue;
      for (const assignee of task.assignees) {
        const row = await this.notifications.createDueSoon(this.prisma, {
          workspaceId: task.board.workspaceId,
          userId: assignee.userId,
          taskId: task.id,
          payload: {
            title: task.title,
            dueDate: task.dueDate.toISOString(),
            type: NotificationType.DueSoon,
          },
        });
        if (row) created += 1;
      }
    }
    return created;
  }

  private async process(_job: Job): Promise<void> {
    const created = await this.runScan();
    if (created > 0) {
      this.logger.log(`due-soon scan created ${created} notification(s)`);
    }
  }
}
