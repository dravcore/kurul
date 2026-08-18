import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { StorageBackend } from './storage-backend';
import {
  attachmentsEnabled,
  closeStorageBackend,
  getStorageBackend,
  getStorageConfig,
} from './storage';

/**
 * The DI-facing face of the storage module.
 *
 * Holds no state — the backend is a process-wide singleton — and exists so Nest consumers inject
 * something a test can swap, and so the backend has an owner that closes it at shutdown.
 *
 * Unlike `MailService`, a failure here **propagates**. `sendWith` swallows delivery failures on
 * purpose ("transactional mail is a side effect of a request, never its result"); storage
 * inverts that, because a swallowed write leaves the database holding an attachment row whose
 * bytes do not exist. The most characteristic decision in the module this one imitates is the
 * one decision not to imitate (ADR 0022).
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  get persistsFiles(): boolean {
    return attachmentsEnabled();
  }

  /** The API half of the two-layer size limit; the proxy carries the same number (ADR 0024). */
  get maxBytes(): number {
    return getStorageConfig().maxBytes;
  }

  /** Per-workspace ceiling on stored FILE bytes; `0` means unlimited (ADR 0027). */
  get workspaceQuotaBytes(): number {
    return getStorageConfig().workspaceQuotaBytes;
  }

  /** Instance-wide ceiling on stored FILE bytes; `0` means unlimited (ADR 0027). */
  get instanceQuotaBytes(): number {
    return getStorageConfig().instanceQuotaBytes;
  }

  /**
   * The configured backend, or the 503 that says this deployment stores nothing.
   *
   * **This throws synchronously, from methods whose signature says `Promise`.** The four
   * pass-throughs below are not `async`, so the guard runs before any promise is constructed:
   * `await storage.write(...)` behaves exactly as the signature suggests, but
   * `storage.write(...).catch(handle)` never reaches `handle` — the exception escapes at the
   * call site instead. Every caller in this API awaits, and `storage.service.spec.ts` pins the
   * behaviour with `toThrow` rather than `rejects` so the next reader sees it stated. There is
   * no hook that could catch a future caller getting this wrong, so this paragraph is the only
   * thing protecting it.
   */
  private require(): StorageBackend {
    const backend = getStorageBackend();
    if (backend === undefined) {
      // 503, not 500: nothing failed. The operator did not set STORAGE_PATH, the web already
      // knows through `GET /config`, and this is the API declining to pretend otherwise.
      throw new ServiceUnavailableException('Attachment storage is not configured');
    }
    return backend;
  }

  write(key: string, bytes: Buffer): Promise<void> {
    return this.require().write(key, bytes);
  }

  createReadStream(key: string): Promise<Readable> {
    return this.require().createReadStream(key);
  }

  remove(key: string): Promise<void> {
    return this.require().remove(key);
  }

  listKeys(): AsyncIterable<{ key: string; modifiedAt: Date }> {
    return this.require().listKeys();
  }

  async onModuleDestroy(): Promise<void> {
    await closeStorageBackend();
  }
}
