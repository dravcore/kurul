import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ActivationFunnelDto } from '@kurultay/shared-types';
import { InstanceAdminGuard } from '../common/guards/instance-admin.guard';
import { ActivationService } from './activation.service';

/**
 * The instance's own activation funnel — the only route in the API that is not under
 * `/workspaces/:workspaceId` and still reads product data.
 *
 * That is the whole reason it needs its own guard. Everything else answers "what may this
 * member see inside this tenant"; this answers "how is this deployment doing", a question no
 * tenant owns and no workspace role should be able to ask. `InstanceAdminGuard` is the boundary
 * and its doc comment argues out the three alternatives that were rejected — including the one
 * that matters most here, publishing instance-wide numbers to every signed-in user, which is
 * the same mistake as the `invitation.*` payload PR #188 had to narrow.
 *
 * **Nothing this returns leaves the instance.** These are aggregates over local rows, handed to
 * one signed-in operator over the same API as everything else, and no part of this controller
 * is connected to `TelemetryService` — the single outbound path, which is off by default and
 * sends none of these numbers. `docs/decisions/0021-activation-funnel-and-opt-in-telemetry.md`.
 *
 * Rate limiting is the global default. There is no probe here whose verdict a `429` would
 * corrupt (unlike `/health`), and a screen an operator opens by hand cannot come close to it.
 */
@Controller('instance')
@UseGuards(InstanceAdminGuard)
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  /**
   * Computed per request, not cached.
   *
   * The queries are six aggregate scans and this is a page an operator opens occasionally,
   * so a cache would trade a real property — the numbers are true at `generatedAt` — for a
   * saving nobody can measure. If this ever becomes slow the fix is an index, not a stale copy.
   */
  @Get('activation')
  funnel(): Promise<ActivationFunnelDto> {
    return this.activation.funnel();
  }
}
