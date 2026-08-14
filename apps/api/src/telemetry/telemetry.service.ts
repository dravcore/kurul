import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { TelemetryPingPayload } from '@kurultay/shared-types';
import { readAppVersion } from '../common/app-version';
import { envBool, envInt, envString, isTestEnv } from '../common/env';

export const TELEMETRY_ENABLED_ENV = 'TELEMETRY_ENABLED';
export const TELEMETRY_ENDPOINT_ENV = 'TELEMETRY_ENDPOINT';
export const TELEMETRY_TIMEOUT_ENV = 'TELEMETRY_TIMEOUT_MS';

/**
 * How long the single outbound request may take before it is abandoned.
 *
 * Five seconds, and the number matters less than the fact that there is one: `fetch` without a
 * signal waits on the operating system's TCP timeout, so an endpoint that accepts the
 * connection and then says nothing would leave a pending request attached to the process for
 * minutes. This runs during boot.
 */
export const DEFAULT_TELEMETRY_TIMEOUT_MS = 5000;

export interface TelemetrySettings {
  enabled: boolean;
  /** Empty string when unset. There is no default collector — see {@link TelemetryService}. */
  endpoint: string;
  timeoutMs: number;
}

/**
 * Read per call rather than cached at import time, so a spec can flip the environment around a
 * single `sendPing()` without rebuilding the module — the same reasoning as
 * `retentionSettings()`.
 *
 * `envBool`'s fallback is `false` and that is the entire promise of this feature: an instance
 * that says nothing about telemetry sends nothing. A change that made this `true` should fail
 * `telemetry.service.spec.ts`.
 */
export function telemetrySettings(): TelemetrySettings {
  return {
    enabled: envBool(TELEMETRY_ENABLED_ENV, false),
    endpoint: envString(TELEMETRY_ENDPOINT_ENV, ''),
    timeoutMs: envInt(TELEMETRY_TIMEOUT_ENV, DEFAULT_TELEMETRY_TIMEOUT_MS),
  };
}

/**
 * The only code path in Kurultay that sends anything to a third party, and it is off.
 *
 * ## What it sends
 *
 * `TelemetryPingPayload`: `{ event: 'instance_started', version }`. That is the complete list,
 * the interface is the specification, and `docs/development.md` repeats it field by field so an
 * operator can check the promise without reading TypeScript. No instance identifier, no
 * hostname, no address, no counts, no workspace or user data of any kind — none of the
 * activation funnel's numbers are in scope here and `ActivationService` is not injected.
 *
 * ## Why there is no instance id
 *
 * An id would make the data far more useful: without one a collector counts *restarts*, so a
 * container that crash-loops looks like a hundred installs and a stable server that never
 * reboots looks like none. It was still rejected. A stable random id is a pseudonymous
 * identifier for a deployment, and the promise this feature has to keep — the reason a
 * self-hoster might switch it on at all — is that it is anonymous with nothing to take on
 * trust. The less useful side won; ADR 0021 records the trade so a future maintainer who wants
 * install counts reopens it as a decision rather than as a patch.
 *
 * ## Why it needs two variables
 *
 * `TELEMETRY_ENABLED=true` alone does nothing: there is no default endpoint. Shipping one would
 * mean a hard-coded third-party address in an AGPL codebase that self-hosters are asked to
 * audit, and Dravcore publishes no collector today — a default pointing at a domain that does
 * not answer is a promise the code cannot keep. So the operator names the destination, which
 * also makes "point it at my own collector" a first-class use rather than a workaround.
 *
 * ## Why it cannot break anything
 *
 * `onModuleInit` never awaits the request and never rethrows. A refused connection, a DNS
 * failure, a 500 from the collector and a five-second silence all end the same way: one `warn`
 * line and an API that is already serving traffic. There is no retry, no queue and no schedule
 * — one ping per process start, or none.
 */
@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);

  onModuleInit(): void {
    const settings = telemetrySettings();
    if (!settings.enabled) {
      // Silent. Off is the default and the correct state for almost every install; a line on
      // every boot saying nothing happened is noise that trains an operator to skim the log.
      return;
    }

    if (isTestEnv()) {
      // The integration suite builds the whole `AppModule`. Nothing in a test run may open an
      // outbound connection to whatever `TELEMETRY_ENDPOINT` happens to hold on a developer's
      // machine — same rule the Redis clients follow, and the same single place to audit it.
      return;
    }

    if (settings.endpoint === '') {
      this.logger.error(
        `${TELEMETRY_ENABLED_ENV} is true but ${TELEMETRY_ENDPOINT_ENV} is unset — no ping sent`,
      );
      return;
    }

    const payload = buildPingPayload();
    // Logged in full, before it is sent, at `log` level. An operator who switched this on is
    // entitled to see the exact bytes leaving their server without running tcpdump, and the
    // payload is two fields — there is nothing here that is unsafe to write to a log.
    this.logger.log(
      `${TELEMETRY_ENABLED_ENV} is on — sending ${JSON.stringify(payload)} to ${settings.endpoint}`,
    );

    void this.sendPing(settings, payload);
  }

  /** Exposed for tests: one request, bounded, and every failure swallowed into a warning. */
  async sendPing(settings: TelemetrySettings, payload: TelemetryPingPayload): Promise<void> {
    try {
      const response = await fetch(settings.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(settings.timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(`telemetry ping rejected with HTTP ${response.status}`);
      }
    } catch (error: unknown) {
      this.logger.warn(
        `telemetry ping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** The payload, assembled in one place so a test can assert on its exact key set. */
export function buildPingPayload(): TelemetryPingPayload {
  return { event: 'instance_started', version: readAppVersion() };
}
