import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { withTimeout } from './probe-timeout';
import { RedisHealthClient } from './redis-health.client';

/**
 * Verdict for one dependency.
 *
 * `skipped` is not a soft `down`: it means this deployment is not configured to use the
 * dependency at all, so there is nothing whose absence could make the instance unready.
 */
export type DependencyStatus = 'up' | 'down' | 'skipped';

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthClient,
  ) {}

  /**
   * Probes every dependency in parallel and grades the instance.
   *
   * Parallel, not sequential: a down Postgres must not delay the answer about Redis by a full
   * timeout budget, and the report is meant to name *all* the broken dependencies at once so
   * an operator reading a failed healthcheck does not have to fix them one probe at a time.
   */
  async checkReadiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([this.probeDatabase(), this.probeRedis()]);
    const status = database === 'down' || redis === 'down' ? 'error' : 'ok';

    return { status, checks: { database, redis } };
  }

  /**
   * Cheapest statement that still proves the whole path works: a connection can be borrowed
   * from the shared pool and a round trip completes.
   *
   * It touches no table on purpose. Whether migrations have been applied is gated before the
   * API ever starts — compose holds `api` behind `migrate: service_completed_successfully` —
   * so folding a schema check in here would only turn a deploy-ordering guarantee into a
   * per-request query.
   */
  private async probeDatabase(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 'database');
      return 'up';
    } catch (error) {
      this.logger.warn(`Database readiness probe failed: ${describeError(error)}`);
      return 'down';
    }
  }

  private async probeRedis(): Promise<DependencyStatus> {
    if (!this.redis.isConfigured()) {
      // `REDIS_URL` is optional by design — the Socket.io adapter and the due-soon worker both
      // warn and carry on without it, so a single-instance deployment runs fine. Reporting
      // that as `down` would make readiness refuse traffic on a supported configuration, so it
      // is reported as skipped and does not affect the verdict.
      return 'skipped';
    }

    try {
      await withTimeout(this.redis.ping(), 'redis');
      return 'up';
    } catch (error) {
      this.logger.warn(`Redis readiness probe failed: ${describeError(error)}`);
      return 'down';
    }
  }
}
