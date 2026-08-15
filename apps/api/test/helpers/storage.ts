import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A real directory on a real filesystem, for the duration of one spec.
 *
 * ADR 0022 rejected a memory backend: it would be a class that exists only for tests, and this
 * codebase has no precedent for one — `LogMailSender` is also a production fallback. Nothing in
 * `apps/api` wrote to disk before this, so this helper *is* the convention rather than a copy of
 * one, and it sits beside `test/helpers/db.ts` because it answers the same question: what does
 * this spec own and clean up itself (`docs/testing.md:259-261`).
 */
export async function createTempStorageDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'kurultay-storage-'));
}

/** Idempotent: safe in an `afterEach` that runs after a failed `beforeEach`. */
export async function removeTempStorageDir(dir: string | undefined): Promise<void> {
  if (dir === undefined) return;
  await rm(dir, { recursive: true, force: true });
}
