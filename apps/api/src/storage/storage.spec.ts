import { createTempStorageDir, removeTempStorageDir } from '../../test/helpers/storage';
import {
  attachmentsEnabled,
  closeStorageBackend,
  createStorageBackend,
  getStorageBackend,
  getStorageConfig,
} from './storage';
import { DEFAULT_ATTACHMENT_MAX_BYTES, readStorageConfig } from './storage-config';

/**
 * Follows `mail-config.spec.ts`: every test clears the variables it set and resets the
 * process-wide singleton. The reset hook exists for exactly this — a spec that changes
 * `STORAGE_PATH` after something has already read it would otherwise be reading a backend
 * built from the previous value.
 */
const VARS = [
  'STORAGE_PATH',
  'ATTACHMENT_MAX_BYTES',
  'ATTACHMENT_WORKSPACE_QUOTA_BYTES',
  'ATTACHMENT_INSTANCE_QUOTA_BYTES',
];

describe('storage configuration', () => {
  const original = new Map(VARS.map((name) => [name, process.env[name]]));
  const dirs: string[] = [];

  beforeEach(async () => {
    for (const name of VARS) delete process.env[name];
    await closeStorageBackend();
  });

  afterEach(async () => {
    for (const name of VARS) delete process.env[name];
    await closeStorageBackend();
  });

  afterAll(async () => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const dir of dirs) await removeTempStorageDir(dir);
    await closeStorageBackend();
  });

  it('is off when STORAGE_PATH is unset', () => {
    expect(attachmentsEnabled()).toBe(false);
    expect(getStorageBackend()).toBeUndefined();
  });

  it('is off when STORAGE_PATH is blank rather than absent', () => {
    process.env.STORAGE_PATH = '   ';
    expect(readStorageConfig().disk).toBeUndefined();
    expect(attachmentsEnabled()).toBe(false);
  });

  it('is on when STORAGE_PATH is set', async () => {
    const dir = await createTempStorageDir();
    dirs.push(dir);
    process.env.STORAGE_PATH = dir;

    expect(attachmentsEnabled()).toBe(true);
    expect(getStorageBackend()?.backend).toBe('disk');
  });

  it('defaults the size limit to 25 MiB', () => {
    expect(getStorageConfig().maxBytes).toBe(26_214_400);
    expect(DEFAULT_ATTACHMENT_MAX_BYTES).toBe(26_214_400);
  });

  it('reads the size limit from the environment', () => {
    process.env.ATTACHMENT_MAX_BYTES = '1024';
    expect(getStorageConfig().maxBytes).toBe(1024);
  });

  it('refuses a non-positive size limit at boot rather than at upload time', () => {
    process.env.ATTACHMENT_MAX_BYTES = '0';
    expect(() => getStorageConfig()).toThrow(/ATTACHMENT_MAX_BYTES/);
  });

  /**
   * The error an operator actually sees, and it names the variable they set.
   *
   * `DiskStorageBackend`'s constructor refuses a relative root too, but its message is about a
   * "storage root" — a phrase that appears nowhere in `.env.example`. A relative `STORAGE_PATH`
   * would resolve against the API process's working directory, which is a different directory
   * under `pnpm dev`, under Docker and under a `cron`-invoked script, so "it worked on my
   * machine and the files vanished in production" is the failure being refused here.
   */
  it('refuses a relative STORAGE_PATH, naming the variable', () => {
    process.env.STORAGE_PATH = 'attachments';
    expect(() => getStorageConfig()).toThrow(/STORAGE_PATH/);
  });

  it('builds the same backend the singleton would, from a config alone', async () => {
    const dir = await createTempStorageDir();
    dirs.push(dir);

    const quotas = { workspaceQuotaBytes: 0, instanceQuotaBytes: 0 };
    expect(createStorageBackend({ disk: undefined, maxBytes: 1, ...quotas })).toBeUndefined();
    expect(
      createStorageBackend({ disk: { root: dir }, maxBytes: 1, ...quotas })?.persistsFiles,
    ).toBe(true);
  });

  it('defaults both storage quotas to 0 — unlimited, the pre-quota behaviour', () => {
    expect(getStorageConfig().workspaceQuotaBytes).toBe(0);
    expect(getStorageConfig().instanceQuotaBytes).toBe(0);
  });

  it('reads both quotas from the environment', () => {
    process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '1024';
    process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '4096';
    expect(getStorageConfig().workspaceQuotaBytes).toBe(1024);
    expect(getStorageConfig().instanceQuotaBytes).toBe(4096);
  });

  it('refuses a negative quota at boot, naming the variable', () => {
    // `0` means unlimited (the retention windows' spelling); a negative value would read as a
    // quota that is always exceeded, so it is a configuration error rather than a clamp.
    process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '-1';
    expect(() => getStorageConfig()).toThrow(/ATTACHMENT_WORKSPACE_QUOTA_BYTES/);

    delete process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES;
    process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '-1';
    expect(() => readStorageConfig()).toThrow(/ATTACHMENT_INSTANCE_QUOTA_BYTES/);
  });

  it('rebuilds after a reset, so a changed STORAGE_PATH is actually read again', async () => {
    expect(getStorageBackend()).toBeUndefined();

    const dir = await createTempStorageDir();
    dirs.push(dir);
    process.env.STORAGE_PATH = dir;
    // Still undefined: the singleton has already answered once and is not re-reading the env.
    expect(getStorageBackend()).toBeUndefined();

    await closeStorageBackend();
    expect(getStorageBackend()?.persistsFiles).toBe(true);
  });
});
