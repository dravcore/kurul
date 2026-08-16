import type {
  ActivationEvent,
  ActivationFunnelDto,
  ActivationNorthStarDto,
  ActivationStepDto,
  ActivationUnit,
  ActivationWindow,
  InstanceConfigDto,
} from '@kurul/shared-types';
import type { DependencyStatus, ReadinessReport } from '../../health/health.service';

/** What this deployment is configured to do. Capability, never tenant state. */
export class InstanceConfigSchema implements InstanceConfigDto {
  /** `false` when no SMTP host is configured: mail is written to the log and delivered nowhere. */
  mailEnabled!: boolean;

  /**
   * `false` when `STORAGE_PATH` is unset, so this deployment stores no files.
   *
   * Link attachments do not depend on it — a `LINK` needs no storage at all.
   */
  attachmentsEnabled!: boolean;
}

/** Liveness — the process is up. Touches no dependency. */
export class LivenessSchema {
  /** Always `ok`. A body at all only so the probe has something to read. */
  status!: string;
}

/** Aliased because `implements` takes an identifier rather than an indexed access. */
type ReadinessChecks = ReadinessReport['checks'];

/** Per-dependency verdict. `skipped` means the deployment does not configure it. */
export class ReadinessChecksSchema implements ReadinessChecks {
  database!: DependencyStatus;
  redis!: DependencyStatus;
}

/**
 * Readiness — whether this instance can serve traffic.
 *
 * The **only** response body in the API that is not the error envelope on failure: a `503`
 * carries this same document with `status: "error"`, because the caller is a healthcheck and
 * needs to know *which* dependency is down.
 */
export class ReadinessSchema implements ReadinessReport {
  status!: 'ok' | 'error';
  checks!: ReadinessChecksSchema;
}

/** One step of the activation funnel. */
export class ActivationStepSchema implements ActivationStepDto {
  event!: ActivationEvent;
  count!: number;
  /** What `count` counts. `instance` steps are `1`/`0` and must never be subtracted across. */
  unit!: ActivationUnit;
  window!: ActivationWindow;
}

/** Weekly Active Team Workspaces, with the two numbers that give it context. */
export class ActivationNorthStarSchema implements ActivationNorthStarDto {
  weeklyActiveTeamWorkspaces!: number;
  weeklyActiveWorkspaces!: number;
  teamWorkspaces!: number;
  windowDays!: number;
}

/** The activation funnel for this instance. Nothing here ever leaves the instance. */
export class ActivationFunnelSchema implements ActivationFunnelDto {
  /** ISO 8601 UTC. Nothing is cached, so this is the moment of the request. */
  generatedAt!: string;
  steps!: ActivationStepSchema[];
  northStar!: ActivationNorthStarSchema;
}
