import { Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';

/**
 * Outbound telemetry: one optional ping at boot, off unless the operator turned it on.
 *
 * A module with no controller, no export and one provider — the smallest thing Nest will let
 * this be, on purpose. Its whole job is to make the answer to "what can this program send
 * anywhere?" a directory listing: this file, `telemetry.service.ts`, and nothing else in the
 * codebase opens an outbound connection to a third party (`common/observability/sentry.ts` is
 * the other opt-in, and is likewise off with no DSN).
 *
 * Kept out of `activation/` deliberately. That module computes instance-local numbers for a
 * local operator; if the two lived together, "does this leave the instance?" would become a
 * question about which function you are looking at instead of which directory.
 *
 * See docs/decisions/0021-activation-funnel-and-opt-in-telemetry.md.
 */
@Module({
  providers: [TelemetryService],
})
export class TelemetryModule {}
