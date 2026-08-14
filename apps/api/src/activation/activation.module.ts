import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ActivationController } from './activation.controller';
import { ActivationService } from './activation.service';
import { UsagePingService } from './usage-ping.service';

/**
 * Instance-local product measurement: the activation funnel and the two view pings it needs.
 *
 * Deliberately *not* the same module as `telemetry/`, and the separation is the point rather
 * than tidiness. Everything in here is computed from local rows and served to a local operator;
 * `TelemetryModule` holds the single code path that can send anything outward, it is off by
 * default, and keeping the two apart means "does this leave the instance?" is answered by which
 * directory a file is in. A reviewer auditing the promise in ADR 0021 has one small module to
 * read, not a grep across a shared one.
 *
 * `MailModule` is imported for one boolean: `smtp_configured` is a funnel step because an
 * instance with no transport makes `invite_accepted` unreachable, so the drop between the two
 * has a cause the operator can act on.
 *
 * `UsagePingService` is exported because the pings are recorded where the viewing actually
 * happens — `BoardController.get` and `DashboardController.summary` — rather than through a
 * dedicated endpoint the browser would have to be trusted to call.
 */
@Module({
  imports: [MailModule],
  controllers: [ActivationController],
  providers: [ActivationService, UsagePingService],
  exports: [UsagePingService],
})
export class ActivationModule {}
