import { DiskStorageBackend } from './disk-storage-backend';
import { readStorageConfig, type StorageConfig } from './storage-config';
import type { StorageBackend } from './storage-backend';

/** Picks the backend for a configuration. Pure — the singleton below is the only state. */
export function createStorageBackend(config: StorageConfig): StorageBackend | undefined {
  return config.disk === undefined ? undefined : new DiskStorageBackend(config.disk.root);
}

let currentBackend: StorageBackend | undefined;
let currentConfig: StorageConfig | undefined;

/**
 * The process-wide backend, or `undefined` when this deployment stores nothing.
 *
 * A module-level singleton for the same reason `getMailSender` is one: one handle per process,
 * not one per injector. `StorageService` wraps it so there is still exactly one lifecycle.
 */
export function getStorageBackend(): StorageBackend | undefined {
  if (currentConfig === undefined) {
    currentConfig = readStorageConfig();
    currentBackend = createStorageBackend(currentConfig);
  }
  return currentBackend;
}

export function getStorageConfig(): StorageConfig {
  getStorageBackend();
  return currentConfig as StorageConfig;
}

/**
 * Whether this deployment can store attachments at all.
 *
 * Reads the capability off the backend the factory already chose rather than asking the
 * environment a second time — `STORAGE_PATH` is interpreted in exactly one place
 * (`storage-config.ts`) and turned into a backend in exactly one other. Code branches on this,
 * never on `backend === 'disk'`.
 */
export function attachmentsEnabled(): boolean {
  return getStorageBackend()?.persistsFiles ?? false;
}

/** Releases the backend and drops it, so the next call builds a fresh one. */
export async function closeStorageBackend(): Promise<void> {
  const current = currentBackend;
  currentBackend = undefined;
  currentConfig = undefined;
  await current?.close();
}
