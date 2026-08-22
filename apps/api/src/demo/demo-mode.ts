import type { DemoConfigDto } from '@kurul/shared-types';
import { envBool, envInt } from '../common/env';

/**
 * The single switch that turns a deployment into a public demo.
 *
 * One variable, not a set of them, for the same reason `SMTP_HOST` is the whole mail switch:
 * an operator running the demo host should not be able to get half of it. `DEMO_MODE=true`
 * simultaneously silences outbound mail, refuses the two irreversible destructive actions,
 * publishes the banner and unlocks `dist/demo/reset.js`. Anything that wants a demo-only
 * behaviour reads this, and nothing reads a second flag that could disagree with it.
 */
export const DEMO_MODE_ENV = 'DEMO_MODE';

/** How often the reset sidecar wipes and re-seeds. Read by the API only to *describe* it. */
export const DEMO_RESET_INTERVAL_ENV = 'DEMO_RESET_INTERVAL_MINUTES';

/** An hour, matching the acceptance criterion for the live demo in `ROADMAP.md`. */
export const DEFAULT_DEMO_RESET_INTERVAL_MINUTES = 60;

/**
 * Whether this deployment is a demo instance.
 *
 * Read per call rather than cached at boot, matching `instanceAdminEmails()` and
 * `retentionSettings()`: a restart is the only way to change it either way, so a cache would
 * buy one `process.env` read on paths that are not hot, and reading live is what lets a unit
 * test flip the variable around a single call instead of rebuilding the Nest container.
 */
export function demoModeEnabled(): boolean {
  return envBool(DEMO_MODE_ENV, false);
}

/**
 * The reset interval in minutes, refusing anything that is not a positive integer.
 *
 * `envInt` already rejects non-integers; zero and negatives are rejected here because the
 * value is a divisor in `nextDemoResetAt` and a modulus in the sidecar's sleep loop. Both
 * would produce nonsense rather than an outage, which is the worst kind of misconfiguration:
 * the banner would promise a reset at some arbitrary instant and nobody would notice.
 */
export function demoResetIntervalMinutes(): number {
  const minutes = envInt(DEMO_RESET_INTERVAL_ENV, DEFAULT_DEMO_RESET_INTERVAL_MINUTES);
  if (minutes < 1) {
    throw new Error(
      `Invalid ${DEMO_RESET_INTERVAL_ENV}: expected a positive number of minutes, received "${minutes}"`,
    );
  }
  return minutes;
}

/**
 * The next wall-clock instant the demo data will be wiped.
 *
 * Computed, never communicated. The reset runs in a separate container (`demo-reset` in the
 * `demo` compose profile) that shares nothing with the API but the database, and the API has
 * no row to read the schedule out of — writing one would mean the reset script maintaining
 * state *about* the reset inside the data it is about to delete.
 *
 * So both sides derive the same instant from the same arithmetic instead: the boundaries of a
 * `resetIntervalMinutes` grid anchored at the Unix epoch. The sidecar sleeps
 * `interval - (now % interval)` seconds before each run, this returns the same boundary in
 * milliseconds, and the two agree without exchanging anything. It also means an operator
 * restarting the sidecar does not shift the schedule — a naive "sleep 3600 between runs" loop
 * would, and the banner would then be wrong until the next deploy.
 *
 * Exactly on a boundary returns the *next* one, a full interval away, because that is what the
 * sidecar's `interval - (now % interval)` evaluates to at the same instant.
 */
export function nextDemoResetAt(now: Date, intervalMinutes: number): Date {
  const intervalMs = intervalMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs + intervalMs);
}

/**
 * The demo section of the instance capability document.
 *
 * `resetIntervalMinutes` and `nextResetAt` are `null` rather than `0` and an epoch date when
 * demo mode is off. A self-hosted instance has no reset schedule at all, and publishing a
 * plausible-looking number for one invites a client to render it: nullable is the type that
 * makes "there is no such instant here" unrepresentable as a date.
 */
export function demoConfig(now: Date = new Date()): DemoConfigDto {
  if (!demoModeEnabled()) {
    return { enabled: false, resetIntervalMinutes: null, nextResetAt: null };
  }

  const resetIntervalMinutes = demoResetIntervalMinutes();
  return {
    enabled: true,
    resetIntervalMinutes,
    nextResetAt: nextDemoResetAt(now, resetIntervalMinutes).toISOString(),
  };
}
