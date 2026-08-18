import { isAbsolute } from 'node:path';
import { envInt, envString } from '../common/env';

/** 25 MiB. One number, quoted in `docker/Caddyfile` and `docs/self-hosting.md` (ADR 0024). */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 26_214_400;

export interface DiskStorageConfig {
  /** Absolute path of the directory attachments are written under. */
  root: string;
}

export interface StorageConfig {
  /** `undefined` when `STORAGE_PATH` is unset — attachments are off, as a type-level state. */
  disk: DiskStorageConfig | undefined;
  /** The API half of the two-layer size limit; the proxy half carries the same number. */
  maxBytes: number;
  /** Ceiling on the summed size of a workspace's FILE attachments. `0` means unlimited. */
  workspaceQuotaBytes: number;
  /** Ceiling on the summed size of every FILE attachment on the instance. `0` means unlimited. */
  instanceQuotaBytes: number;
}

/**
 * Reads the storage configuration from the environment.
 *
 * `STORAGE_PATH` is the single switch, exactly as `SMTP_HOST` is for mail: set it and
 * attachments work, leave it unset and the app still boots with the feature off. There is no
 * `ATTACHMENTS_ENABLED` — this codebase reserves `_ENABLED` for default-on kill switches
 * (`CLEANUP_ENABLED`, `RATE_LIMIT_ENABLED`) and for consent (`TELEMETRY_ENABLED`), and a
 * default-off feature that needs a path in order to work is enabled by that path being set
 * (ADR 0022).
 */
export function readStorageConfig(): StorageConfig {
  const root = envString('STORAGE_PATH', '');
  // Refused here as well as in `DiskStorageBackend`'s constructor, and the duplication is the
  // point: the constructor protects the port from any caller, this protects the operator from a
  // message that never names the variable they set. A relative path would resolve against the
  // API process's working directory, which differs between `pnpm dev`, the container and any
  // script that starts the process from somewhere else.
  if (root !== '' && !isAbsolute(root)) {
    throw new Error(`Invalid STORAGE_PATH: expected an absolute path, received "${root}"`);
  }
  const maxBytes = envInt('ATTACHMENT_MAX_BYTES', DEFAULT_ATTACHMENT_MAX_BYTES);
  if (maxBytes <= 0) {
    throw new Error(
      `Invalid ATTACHMENT_MAX_BYTES: expected a positive byte count, received "${maxBytes}"`,
    );
  }

  return {
    disk: root === '' ? undefined : { root },
    maxBytes,
    workspaceQuotaBytes: quotaBytes('ATTACHMENT_WORKSPACE_QUOTA_BYTES'),
    instanceQuotaBytes: quotaBytes('ATTACHMENT_INSTANCE_QUOTA_BYTES'),
  };
}

/**
 * Reads a storage quota in bytes (ADR 0027).
 *
 * `0` is a supported value meaning "unlimited" — the same spelling the retention windows give
 * it (`retentionDays`), and the value an upgrade lands on: an instance that never configures a
 * quota behaves exactly as it did before quotas existed. A negative value is refused rather
 * than clamped, for `retentionDays`'s reason — it would otherwise read as a quota that is
 * always exceeded, which is a configuration error better raised at boot than answered with a
 * 413 on every upload.
 */
function quotaBytes(name: string): number {
  const bytes = envInt(name, 0);
  if (bytes < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative byte count, received "${bytes}"`);
  }
  return bytes;
}
