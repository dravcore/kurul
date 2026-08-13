import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipRateLimit } from '../common/rate-limit/rate-limit';
import { HealthService, type ReadinessReport } from './health.service';

@Controller('health')
// Applied to the controller, not to each handler: everything under `/health` is a probe, and
// a probe that gets throttled reports the API as unhealthy for a reason unrelated to health.
@SkipRateLimit()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness: is the process up and answering HTTP?
   *
   * Static and dependency-free on purpose. A liveness probe that touched Postgres or Redis
   * would tell an orchestrator to restart a perfectly healthy API because a dependency
   * blipped — a restart cannot heal the dependency, it only removes capacity while the
   * dependency is already struggling. Dependency state belongs to `/health/ready`.
   */
  @Public()
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this instance actually serve requests — is Postgres reachable, and Redis
   * answering when it is configured?
   *
   * Both outcomes return the same document, and the failure is deliberately not wrapped in the
   * `docs/api-conventions.md` error envelope: the caller is a probe reading `checks` to learn
   * *which* dependency is down, and the envelope would flatten that to a message string. That
   * is what `passthrough` buys — the handler keeps returning its document while choosing the
   * status code itself.
   */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.health.checkReadiness();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return report;
  }
}
