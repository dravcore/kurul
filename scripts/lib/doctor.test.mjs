/**
 * Unit tests for the `pnpm bootstrap --check` doctor logic, on `node:test` for the same reason
 * as `trello-anonymiser.test.mjs`: `scripts/` has no dependencies and must keep having none.
 * Run with `pnpm test:scripts`.
 *
 * Every check function takes explicit paths, so each test builds its own throwaway temp
 * directory rather than touching this repository's real `packages/`, `apps/api/prisma` or
 * `.env` — a run of this suite never depends on, or mutates, the checkout's own build state.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  REQUIRED_ENV_KEYS,
  checkBuildFreshness,
  checkPrismaClient,
  checkRequiredEnv,
  newestMtimeMs,
  readEnvFile,
  runDoctorChecks,
} from './doctor.mjs';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurul-doctor-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `content` to `relPath` under `dir`, then sets its mtime — creating parent dirs. */
function writeFileAt(relPath, content, mtime) {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  if (mtime !== undefined) {
    utimesSync(full, mtime, mtime);
  }
  return full;
}

describe('newestMtimeMs', () => {
  it('returns null for a directory that does not exist', () => {
    assert.equal(newestMtimeMs(join(dir, 'nope')), null);
  });

  it('returns null for an empty directory', () => {
    mkdirSync(join(dir, 'empty'));
    assert.equal(newestMtimeMs(join(dir, 'empty')), null);
  });

  it('finds the newest file recursively', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-06-01T00:00:00Z');
    writeFileAt('src/a.ts', 'a', old);
    writeFileAt('src/nested/b.ts', 'b', recent);
    assert.equal(newestMtimeMs(join(dir, 'src')), recent.getTime());
  });

  it('ignores node_modules and .git', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2099-01-01T00:00:00Z');
    writeFileAt('src/a.ts', 'a', old);
    writeFileAt('src/node_modules/dep/index.js', 'dep', future);
    writeFileAt('src/.git/HEAD', 'ref', future);
    assert.equal(newestMtimeMs(join(dir, 'src')), old.getTime());
  });
});

describe('checkBuildFreshness', () => {
  const fix = 'pnpm build:example';

  it('fails when dist/ does not exist', () => {
    writeFileAt('src/index.ts', 'export {}');
    const result = checkBuildFreshness({
      label: 'example',
      srcDir: join(dir, 'src'),
      distDir: join(dir, 'dist'),
      fix,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /not built/);
    assert.equal(result.fix, fix);
  });

  it('fails when dist/ is older than src/', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-06-01T00:00:00Z');
    writeFileAt('dist/index.js', 'built', old);
    writeFileAt('src/index.ts', 'export {}', recent);
    const result = checkBuildFreshness({
      label: 'example',
      srcDir: join(dir, 'src'),
      distDir: join(dir, 'dist'),
      fix,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /stale/);
  });

  it('fails when dist/ exists but is empty', () => {
    writeFileAt('src/index.ts', 'export {}');
    mkdirSync(join(dir, 'dist'));
    const result = checkBuildFreshness({
      label: 'example',
      srcDir: join(dir, 'src'),
      distDir: join(dir, 'dist'),
      fix,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /empty/);
  });

  it('passes when dist/ is newer than src/', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-06-01T00:00:00Z');
    writeFileAt('src/index.ts', 'export {}', old);
    writeFileAt('dist/index.js', 'built', recent);
    const result = checkBuildFreshness({
      label: 'example',
      srcDir: join(dir, 'src'),
      distDir: join(dir, 'dist'),
      fix,
    });
    assert.equal(result.ok, true);
  });

  it('passes when dist/ and src/ share the same mtime (a file that fills it exactly is fine)', () => {
    const same = new Date('2026-03-01T00:00:00Z');
    writeFileAt('src/index.ts', 'export {}', same);
    writeFileAt('dist/index.js', 'built', same);
    const result = checkBuildFreshness({
      label: 'example',
      srcDir: join(dir, 'src'),
      distDir: join(dir, 'dist'),
      fix,
    });
    assert.equal(result.ok, true);
  });
});

describe('checkPrismaClient', () => {
  const fix = 'pnpm db:generate';

  it('fails when the client has not been generated', () => {
    writeFileAt('prisma/schema.prisma', 'datasource db {}');
    const result = checkPrismaClient({
      schemaPath: join(dir, 'prisma/schema.prisma'),
      clientDir: join(dir, 'generated/prisma'),
      fix,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /not generated/);
  });

  it('fails when the client is older than schema.prisma', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-06-01T00:00:00Z');
    writeFileAt('generated/prisma/index.js', 'client', old);
    writeFileAt('prisma/schema.prisma', 'datasource db {}', recent);
    const result = checkPrismaClient({
      schemaPath: join(dir, 'prisma/schema.prisma'),
      clientDir: join(dir, 'generated/prisma'),
      fix,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /stale/);
  });

  it('passes when the client is newer than schema.prisma', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-06-01T00:00:00Z');
    writeFileAt('prisma/schema.prisma', 'datasource db {}', old);
    writeFileAt('generated/prisma/index.js', 'client', recent);
    const result = checkPrismaClient({
      schemaPath: join(dir, 'prisma/schema.prisma'),
      clientDir: join(dir, 'generated/prisma'),
      fix,
    });
    assert.equal(result.ok, true);
  });

  it('reports a distinct message when schema.prisma itself is missing', () => {
    const result = checkPrismaClient({
      schemaPath: join(dir, 'prisma/schema.prisma'),
      clientDir: join(dir, 'generated/prisma'),
      fix,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /schema not found/);
  });
});

describe('readEnvFile', () => {
  it('returns an empty map when .env does not exist', () => {
    const env = readEnvFile(join(dir, '.env'));
    assert.equal(env.size, 0);
  });

  it('parses KEY=value lines, trimming quotes and whitespace', () => {
    writeFileAt(
      '.env',
      ['POSTGRES_PASSWORD=hunter2', 'QUOTED="value with spaces"', '# a comment', '', 'BLANK='].join(
        '\n',
      ),
    );
    const env = readEnvFile(join(dir, '.env'));
    assert.equal(env.get('POSTGRES_PASSWORD'), 'hunter2');
    assert.equal(env.get('QUOTED'), 'value with spaces');
    assert.equal(env.get('BLANK'), '');
    assert.equal(env.has('# a comment'), false);
  });
});

describe('checkRequiredEnv', () => {
  it('fails when .env does not exist', () => {
    const result = checkRequiredEnv({ envPath: join(dir, '.env') });
    assert.equal(result.ok, false);
    assert.match(result.message, /no \.env/);
    assert.match(result.fix, /cp \.env\.example \.env/);
  });

  it('fails and names every missing key', () => {
    writeFileAt('.env', 'POSTGRES_PASSWORD=set\n');
    const result = checkRequiredEnv({
      envPath: join(dir, '.env'),
      required: REQUIRED_ENV_KEYS,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /BETTER_AUTH_SECRET/);
    assert.doesNotMatch(result.message, /POSTGRES_PASSWORD/);
  });

  it('treats a blank value the same as a missing key', () => {
    writeFileAt('.env', 'POSTGRES_PASSWORD=\nBETTER_AUTH_SECRET=set\n');
    const result = checkRequiredEnv({ envPath: join(dir, '.env') });
    assert.equal(result.ok, false);
    assert.match(result.message, /POSTGRES_PASSWORD/);
  });

  it('fails when DATABASE_URL still carries the placeholder', () => {
    writeFileAt(
      '.env',
      [
        'POSTGRES_PASSWORD=set',
        'BETTER_AUTH_SECRET=set',
        'DATABASE_URL=postgresql://kurul:<POSTGRES_PASSWORD>@localhost:5432/kurul',
      ].join('\n'),
    );
    const result = checkRequiredEnv({ envPath: join(dir, '.env') });
    assert.equal(result.ok, false);
    assert.match(result.message, /placeholder/);
  });

  it('passes when every required key is set and DATABASE_URL has no placeholder', () => {
    writeFileAt(
      '.env',
      [
        'POSTGRES_PASSWORD=set',
        'BETTER_AUTH_SECRET=set',
        'DATABASE_URL=postgresql://kurul:set@localhost:5432/kurul',
      ].join('\n'),
    );
    const result = checkRequiredEnv({ envPath: join(dir, '.env') });
    assert.equal(result.ok, true);
  });
});

describe('runDoctorChecks', () => {
  it('returns one failing result per unmet check on an empty checkout', () => {
    mkdirSync(join(dir, 'packages/shared-types/src'), { recursive: true });
    mkdirSync(join(dir, 'packages/auth-access/src'), { recursive: true });
    mkdirSync(join(dir, 'apps/api/prisma'), { recursive: true });
    writeFileAt('apps/api/prisma/schema.prisma', 'datasource db {}');

    const results = runDoctorChecks(dir);
    assert.equal(results.length, 4);
    assert.ok(results.every((result) => result.ok === false));
  });

  it('returns every check passing on a fully bootstrapped checkout', () => {
    const early = new Date('2026-01-01T00:00:00Z');
    const late = new Date('2026-06-01T00:00:00Z');

    writeFileAt('packages/shared-types/src/index.ts', 'export {}', early);
    writeFileAt('packages/shared-types/dist/index.js', 'built', late);
    writeFileAt('packages/auth-access/src/index.ts', 'export {}', early);
    writeFileAt('packages/auth-access/dist/index.js', 'built', late);
    writeFileAt('apps/api/prisma/schema.prisma', 'datasource db {}', early);
    writeFileAt('apps/api/src/generated/prisma/index.js', 'client', late);
    writeFileAt(
      '.env',
      [
        'POSTGRES_PASSWORD=set',
        'BETTER_AUTH_SECRET=set',
        'DATABASE_URL=postgresql://kurul:set@localhost:5432/kurul',
      ].join('\n'),
    );

    const results = runDoctorChecks(dir);
    assert.equal(results.length, 4);
    assert.ok(
      results.every((result) => result.ok === true),
      `expected every check to pass, got: ${JSON.stringify(results, null, 2)}`,
    );
  });
});
