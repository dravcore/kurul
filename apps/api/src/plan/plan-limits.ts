import type { InstancePlanLimitsDto, WorkspacePlanLimitsDto } from '@kurul/shared-types';
import { envString, envInt } from '../common/env';

/**
 * The four `PLAN_MAX_*` variables, in one place so the boot log, the tests and
 * `.env.example` cannot drift from what the resolver reads (ADR 0032).
 *
 * The names deliberately do not follow `ATTACHMENT_*`'s shape: those name the thing being
 * measured (attachments), these name the layer that measures (the plan). Byte quotas keep
 * their own names: the plan layer reads them, it does not rename them.
 */
export const PLAN_LIMIT_ENV = {
  seatsPerWorkspace: 'PLAN_MAX_SEATS_PER_WORKSPACE',
  boardsPerWorkspace: 'PLAN_MAX_BOARDS_PER_WORKSPACE',
  workspaces: 'PLAN_MAX_WORKSPACES',
  users: 'PLAN_MAX_USERS',
} as const;

/** The instance-wide ceilings, `null` for each one nobody configured. */
export interface InstancePlanLimits {
  seatsPerWorkspace: number | null;
  boardsPerWorkspace: number | null;
  workspaces: number | null;
  users: number | null;
}

/**
 * A per-workspace override, as stored in `Workspace.planLimits`.
 *
 * `undefined` (absent) and `null` (present, unlimited) are different answers: absent defers to
 * the instance, `null` overrides the instance's number with "no ceiling". That distinction is
 * the whole reason the column is a partial object rather than a full copy of the ceilings.
 */
export interface WorkspacePlanOverride {
  seats?: number | null;
  boards?: number | null;
  storageBytes?: number | null;
}

/** Keys the override understands. Anything else in the column is ignored, forwards-compatibly. */
const OVERRIDE_KEYS = ['seats', 'boards', 'storageBytes'] as const;

/**
 * Reads one `PLAN_MAX_*` variable.
 *
 * Unset or blank is unlimited. This layer has no default number, and that is the difference
 * from the byte quotas of [ADR 0027](../../../docs/decisions/0027-attachment-quotas.md), which
 * grew defaults because an unbounded disk takes the database down with it. A seat nobody
 * capped costs nothing that a running instance has to survive, and an upgrade that suddenly
 * refuses the eleventh member of an existing team is a regression nobody configured.
 *
 * `0` is the same explicit "unlimited" spelling the quotas and the retention windows already
 * use, so an operator who has learned one ceiling has learned all of them. It is deliberately
 * not "zero allowed": an instance that refuses every board is not a configuration anyone
 * wants, and the failure of writing `0` meaning to disable something would be silent.
 *
 * A negative number is refused at boot rather than clamped, exactly as
 * `ATTACHMENT_WORKSPACE_QUOTA_BYTES` is: it would otherwise read as a ceiling that every write
 * exceeds, which is a configuration error better raised once at start-up than answered with a
 * 403 on every attempt.
 */
function readCeiling(name: string): number | null {
  const raw = envString(name, '');
  if (raw === '') {
    return null;
  }

  // `envInt` supplies the "not an integer" refusal; the fallback is unreachable because the
  // blank case returned above.
  const value = envInt(name, 0);
  if (value < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative count, received "${value}"`);
  }

  return value === 0 ? null : value;
}

/**
 * Reads the instance ceilings from the environment.
 *
 * Not memoized, unlike `getStorageConfig()`: this is four `process.env` reads next to a
 * database `count()` in every caller, so a cache would buy nothing measurable and would add a
 * second copy of the truth that a test has to remember to invalidate.
 */
export function readInstancePlanLimits(): InstancePlanLimits {
  return {
    seatsPerWorkspace: readCeiling(PLAN_LIMIT_ENV.seatsPerWorkspace),
    boardsPerWorkspace: readCeiling(PLAN_LIMIT_ENV.boardsPerWorkspace),
    workspaces: readCeiling(PLAN_LIMIT_ENV.workspaces),
    users: readCeiling(PLAN_LIMIT_ENV.users),
  };
}

/**
 * Narrows one value out of the `Workspace.planLimits` column.
 *
 * The column is data, not configuration, so a malformed value is not a boot failure: it is a
 * row somebody (or, later, the billing integration of ADR 0028) wrote wrongly, and the safe
 * reading of a ceiling nobody can parse is "this key was never set", which falls through to
 * the instance's own number. Refusing every write in the workspace instead would turn one bad
 * JSON value into an outage for one tenant.
 */
function parseOverrideValue(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value === 0 ? null : value;
}

/** Reads a `Workspace.planLimits` column into an override. Unknown and unusable keys are dropped. */
export function parseWorkspacePlanOverride(stored: unknown): WorkspacePlanOverride {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {};
  }

  const source = stored as Record<string, unknown>;
  const override: WorkspacePlanOverride = {};
  for (const key of OVERRIDE_KEYS) {
    if (!(key in source)) {
      continue;
    }
    const parsed = parseOverrideValue(source[key]);
    if (parsed !== undefined) {
      override[key] = parsed;
    }
  }

  return override;
}

/**
 * The ADR 0027 spelling of a byte quota (`0` is unlimited) in this layer's spelling (`null`).
 *
 * Kept as one named function rather than inlined three times: the two spellings agree on
 * everything except which value means "no ceiling", and that is exactly the kind of difference
 * that gets miscopied.
 */
export function quotaBytesToCeiling(bytes: number): number | null {
  return bytes === 0 ? null : bytes;
}

/**
 * Resolves one workspace's ceilings: its own override where it has one, the instance's
 * configuration otherwise, unlimited where neither says anything.
 *
 * `storageQuotaBytes` is `ATTACHMENT_WORKSPACE_QUOTA_BYTES` as the storage config resolved it,
 * in that config's spelling: the plan layer wraps the quota, it does not re-read it.
 */
export function resolveWorkspacePlanLimits(
  instance: InstancePlanLimits,
  storageQuotaBytes: number,
  override: WorkspacePlanOverride,
): WorkspacePlanLimitsDto {
  return {
    seats: 'seats' in override ? (override.seats ?? null) : instance.seatsPerWorkspace,
    boards: 'boards' in override ? (override.boards ?? null) : instance.boardsPerWorkspace,
    storageBytes:
      'storageBytes' in override
        ? (override.storageBytes ?? null)
        : quotaBytesToCeiling(storageQuotaBytes),
  };
}

/** The instance document `GET /config` publishes, quotas included. */
export function describeInstancePlanLimits(
  instance: InstancePlanLimits,
  storage: { workspaceQuotaBytes: number; instanceQuotaBytes: number },
): InstancePlanLimitsDto {
  return {
    ...instance,
    storageBytesPerWorkspace: quotaBytesToCeiling(storage.workspaceQuotaBytes),
    storageBytesPerInstance: quotaBytesToCeiling(storage.instanceQuotaBytes),
  };
}

/**
 * The one line the boot log carries about the plan ceilings, in the shape
 * `describeStorageCeilings` already established for the byte quotas.
 *
 * An instance that configures nothing logs four `unlimited`s, which is the point: the line
 * exists so an operator can see, without reading `.env`, that the layer is inert.
 */
export function describePlanCeilings(limits: InstancePlanLimits): string {
  const show = (value: number | null): string => (value === null ? 'unlimited' : String(value));
  return (
    'Plan ceilings: ' +
    `seatsPerWorkspace=${show(limits.seatsPerWorkspace)} ` +
    `boardsPerWorkspace=${show(limits.boardsPerWorkspace)} ` +
    `workspaces=${show(limits.workspaces)} ` +
    `users=${show(limits.users)}`
  );
}
