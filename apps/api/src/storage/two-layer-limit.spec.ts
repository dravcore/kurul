import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ATTACHMENT_MAX_BYTES } from './storage-config';

/**
 * The upload size limit exists in two layers and they are not independently tunable.
 *
 * The API enforces it with multer's `limits.fileSize`; the reverse proxy enforces it with
 * `request_body max_size`. Raising one alone produces the failure ADR 0022 added the proxy row
 * to prevent: a 413 logged as a successful proxied request in one direction and logged nowhere
 * at all in the other. Nothing in the type system connects a Caddyfile to a TypeScript
 * constant, so this spec is the connection — it fails the build the moment the two disagree.
 *
 * It reads the shipped files rather than a copy of them. A test that asserted against its own
 * duplicate of the number would pass on the day somebody edits the Caddyfile, which is the only
 * day it needed to fail.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** `25MiB` / `26214400` / `1m` → bytes. Caddy's own size grammar, the subset this repo uses. */
function parseSize(literal: string): number {
  const match = /^(\d+)\s*(B|KB|MB|GB|KiB|MiB|GiB|k|m|g)?$/i.exec(literal.trim());
  if (match === null) throw new Error(`Unparseable size literal: "${literal}"`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 'B').toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 * 1000,
    gb: 1000 * 1000 * 1000,
    kib: 1024,
    mib: 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    // nginx's suffixes, which are binary despite the spelling.
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024,
  };
  return value * multipliers[unit]!;
}

describe('the two-layer upload limit', () => {
  it('is 25 MiB in the API', () => {
    expect(DEFAULT_ATTACHMENT_MAX_BYTES).toBe(26_214_400);
  });

  it('is the same number in docker/Caddyfile', () => {
    const caddyfile = read('docker/Caddyfile');
    const match = /max_size\s+(\S+)/.exec(caddyfile);

    expect(match).not.toBeNull();
    expect(parseSize(match![1]!)).toBe(DEFAULT_ATTACHMENT_MAX_BYTES);
  });

  it('is the same number in docs/self-hosting.md, where an operator replacing Caddy reads it', () => {
    // nginx defaults `client_max_body_size` to 1 MB, so an operator who followed the published
    // contract and omitted this row is the one who gets the broken install (ADR 0022).
    const doc = read('docs/self-hosting.md');
    const match = /client_max_body_size\s+([^;]+);/.exec(doc);

    expect(match).not.toBeNull();
    expect(parseSize(match![1]!)).toBe(DEFAULT_ATTACHMENT_MAX_BYTES);
  });

  it('is the same number in the Turkish mirror', () => {
    const doc = read('docs/tr/self-hosting.md');
    const match = /client_max_body_size\s+([^;]+);/.exec(doc);

    expect(match).not.toBeNull();
    expect(parseSize(match![1]!)).toBe(DEFAULT_ATTACHMENT_MAX_BYTES);
  });

  it('is the same number in .env.example and in the compose default', () => {
    expect(/^ATTACHMENT_MAX_BYTES=(\d+)$/m.exec(read('.env.example'))?.[1]).toBe(
      String(DEFAULT_ATTACHMENT_MAX_BYTES),
    );
    expect(
      /ATTACHMENT_MAX_BYTES:\s*\$\{ATTACHMENT_MAX_BYTES:-(\d+)\}/.exec(
        read('docker-compose.yml'),
      )?.[1],
    ).toBe(String(DEFAULT_ATTACHMENT_MAX_BYTES));
  });

  /**
   * The other pair that has to agree: the orphan sweep's grace period is
   * `BACKUP_KEEP × BACKUP_INTERVAL`, which only means anything if the API is actually given
   * those two values. They were compose-only until this PR.
   */
  it('passes the backup rotation to the api service, which the orphan sweep reads', () => {
    const compose = read('docker-compose.yml');
    const apiService = compose.slice(
      compose.indexOf('\n  api:'),
      compose.indexOf('\n  web:', compose.indexOf('\n  api:')),
    );

    expect(apiService).toContain('BACKUP_INTERVAL: ${BACKUP_INTERVAL:-86400}');
    expect(apiService).toContain('BACKUP_KEEP: ${BACKUP_KEEP:-7}');
    expect(apiService).toContain('STORAGE_PATH: /data/attachments');
    expect(apiService).toContain('attachment_data:/data/attachments');
  });
});
