import { createReadStream as openReadStream } from 'node:fs';
import { mkdir, opendir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageBackend } from './storage-backend';

/**
 * Attachments on the local filesystem.
 *
 * The only backend that ships. `S3StorageBackend` is designed to be an added file rather than a
 * refactor; its trigger and its cost are written in ADR 0022.
 */
export class DiskStorageBackend implements StorageBackend {
  readonly backend = 'disk' as const;
  readonly persistsFiles = true;

  constructor(private readonly root: string) {}

  /**
   * Absolute path for `key`, refusing anything that lands outside the root.
   *
   * No caller can reach this check today: `storageKey` is derived from the row's own UUIDv7 and
   * never from user input (ADR 0024), so traversal is unexpressible rather than filtered. The
   * check exists for the change that makes it expressible again — a sweep that reads keys back
   * off disk, an importer that carries them — and it throws rather than clamping, because a
   * silently corrected path is a bug that reports itself as success.
   */
  resolve(key: string): string {
    const absolute = resolve(this.root, key);
    const rel = relative(this.root, absolute);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      // Deliberately none of multer's message constants — see storage-backend.ts.
      throw new Error('Storage key resolves outside the storage root');
    }
    return absolute;
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const absolute = this.resolve(key);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  createReadStream(key: string): Promise<Readable> {
    const absolute = this.resolve(key);
    // `stat` first, so a missing key rejects *before* a stream exists. The download path has to
    // finish every check before the first byte is written (ADR 0022), and an `error` event on a
    // stream that is already piped arrives after the response has started — which is exactly
    // the state `AllExceptionsFilter` cannot answer from.
    return stat(absolute).then(() => openReadStream(absolute));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async *listKeys(): AsyncIterable<{ key: string; modifiedAt: Date }> {
    const dir = await opendir(this.root, { recursive: true }).catch(() => null);
    // A root that does not exist yet is "no files", not an error: the sweep runs on a schedule
    // and must not fail the whole job on an instance where nothing has been uploaded.
    if (dir === null) return;
    for await (const entry of dir) {
      if (!entry.isFile()) continue;
      // `parentPath`, not `path`. Node renamed it, and on this runtime (measured on v24.18.0)
      // `Dirent.path` is `undefined` rather than an alias — so an example copied from an older
      // article produces `join(undefined, name)` and a TypeError at the first swept file, not a
      // type error at build time.
      const absolute = join(entry.parentPath, entry.name);
      const info = await stat(absolute);
      yield { key: relative(this.root, absolute).split(sep).join('/'), modifiedAt: info.mtime };
    }
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
