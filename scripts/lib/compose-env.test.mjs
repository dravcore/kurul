/**
 * Drift test between `.env.example`, `apps/api/src` and `docker-compose.yml`: every setting the
 * API reads and `.env.example` documents has to be forwarded by the `api` service, or be listed
 * in `API_FORWARDING_EXCEPTIONS` with a reason. See `compose-env.mjs` for why the forwarding
 * list is explicit and why silence here used to mean an inert `PLAN_MAX_USERS`.
 *
 * On `node:test` with no dependencies, like the other suites in this directory. Run with
 * `pnpm test:scripts`. The parser tests build throwaway files; the drift tests read the
 * repository's real files, which is the point of them.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  API_FORWARDING_EXCEPTIONS,
  UNDOCUMENTED_API_KEYS,
  missingApiForwarding,
  readApiEnvKeys,
  readDocumentedKeys,
  readResetEnvKeys,
  readServiceEnvironmentKeys,
} from './compose-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_EXAMPLE = join(ROOT, '.env.example');
const COMPOSE = join(ROOT, 'docker-compose.yml');
const API_SRC = join(ROOT, 'apps', 'api', 'src');
const RESET_ENTRYPOINT = join(API_SRC, 'demo', 'reset.ts');

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurul-compose-env-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFileAt(relPath, content) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

describe('readDocumentedKeys', () => {
  it('reads KEY= lines and ignores keys that only appear in comments', () => {
    const path = writeFileAt(
      '.env.example',
      ['# CLEANUP_ENABLED=false switches the sweep off', 'CLEANUP_ENABLED=true', '', 'A_KEY='].join(
        '\n',
      ),
    );
    assert.deepEqual([...readDocumentedKeys(path)].sort(), ['A_KEY', 'CLEANUP_ENABLED']);
  });
});

describe('readApiEnvKeys', () => {
  it('finds helper calls, process.env reads, env constants and documented literals', () => {
    writeFileAt(
      'src/a.ts',
      [
        "const port = envPort('API_PORT', 4000);",
        "const on = envBool('CLEANUP_ENABLED', true);",
        'const url = process.env.DATABASE_URL;',
        "const pw = process.env['DEMO_PASSWORD'];",
        "export const TELEMETRY_ENABLED_ENV = 'TELEMETRY_ENABLED';",
        'const dsn = env.SENTRY_DSN?.trim();',
        "retentionDays('ACTIVITY_RETENTION_DAYS', 365);",
        "const code = 'PLAN_LIMIT_SEATS';",
      ].join('\n'),
    );
    writeFileAt('src/a.spec.ts', "envBool('ONLY_IN_A_TEST', true);");
    writeFileAt('src/generated/client.ts', 'process.env.ONLY_IN_GENERATED;');

    const documented = new Set(['ACTIVITY_RETENTION_DAYS', 'PLAN_LIMIT_SEATS_IS_NOT_DOCUMENTED']);
    const keys = readApiEnvKeys(join(dir, 'src'), documented);
    assert.deepEqual([...keys].sort(), [
      'ACTIVITY_RETENTION_DAYS',
      'API_PORT',
      'CLEANUP_ENABLED',
      'DATABASE_URL',
      'DEMO_PASSWORD',
      'SENTRY_DSN',
      'TELEMETRY_ENABLED',
    ]);
  });
});

describe('readServiceEnvironmentKeys', () => {
  it('reads the environment map of one service and resolves anchor merges', () => {
    const path = writeFileAt(
      'docker-compose.yml',
      [
        'x-logging: &logging',
        '  driver: json-file',
        'x-common-env: &common-env',
        '  SHARED_KEY: ${SHARED_KEY:-}',
        '  # a comment between keys',
        '  OTHER_SHARED: value',
        'services:',
        '  api:',
        '    image: x',
        '    logging: *logging',
        '    environment:',
        '      <<: *common-env',
        '      # PLAN ceilings',
        '      PLAN_MAX_USERS: ${PLAN_MAX_USERS:-}',
        '      DATABASE_URL: postgresql://${POSTGRES_USER:-kurul}:${POSTGRES_PASSWORD:?x}@postgres:5432/db',
        '    depends_on:',
        '      postgres:',
        '        condition: service_healthy',
        '  web:',
        '    environment:',
        '      - LIST_FORM=1',
        '  migrate:',
        '    image: y',
      ].join('\n'),
    );
    assert.deepEqual([...readServiceEnvironmentKeys(path, 'api')].sort(), [
      'DATABASE_URL',
      'OTHER_SHARED',
      'PLAN_MAX_USERS',
      'SHARED_KEY',
    ]);
    assert.deepEqual([...readServiceEnvironmentKeys(path, 'web')], ['LIST_FORM']);
    assert.deepEqual([...readServiceEnvironmentKeys(path, 'migrate')], []);
    assert.throws(() => readServiceEnvironmentKeys(path, 'nope'), /no service named nope/);
  });
});

describe('missingApiForwarding', () => {
  it('lists documented API-read keys the api block lacks, minus the exceptions', () => {
    const missing = missingApiForwarding({
      documented: new Set(['A', 'B', 'C']),
      apiRead: new Set(['A', 'B', 'C', 'NODE_ENV']),
      forwarded: new Set(['A']),
      exceptions: { C: 'reason' },
    });
    assert.deepEqual(missing, ['B']);
  });
});

describe('docker-compose.yml forwards what the API reads', () => {
  const documented = readDocumentedKeys(ENV_EXAMPLE);
  const apiRead = readApiEnvKeys(API_SRC, documented);
  const forwarded = readServiceEnvironmentKeys(COMPOSE, 'api');

  it('sees the keys this test was written for, so an empty grep cannot pass it', () => {
    for (const key of ['PLAN_MAX_USERS', 'INSTANCE_ADMIN_EMAILS', 'API_DOCS_ENABLED']) {
      assert.ok(documented.has(key), `${key} documented in .env.example`);
      assert.ok(apiRead.has(key), `${key} read by apps/api/src`);
    }
    assert.ok(forwarded.has('DATABASE_URL'), 'api service has an environment block');
  });

  it('every documented key the API reads is on the api service (or an exception)', () => {
    const missing = missingApiForwarding({
      documented,
      apiRead,
      forwarded,
      exceptions: API_FORWARDING_EXCEPTIONS,
    });
    assert.deepEqual(
      missing,
      [],
      'Add each key to the api service environment block in docker-compose.yml as ' +
        '`KEY: ${KEY:-}` (blank means unset to the env helpers), or list it in ' +
        'API_FORWARDING_EXCEPTIONS with the reason it must not be forwarded. See ' +
        'docs/development.md#environment-variables.',
    );
  });

  it('every key the API reads is documented in .env.example (or an exception)', () => {
    const undocumented = [...apiRead]
      .filter((key) => !documented.has(key) && !(key in UNDOCUMENTED_API_KEYS))
      .sort();
    assert.deepEqual(
      undocumented,
      [],
      'Add each key to .env.example with a safe placeholder and to the table in ' +
        'docs/development.md#environment-variables, or list it in UNDOCUMENTED_API_KEYS.',
    );
  });

  it('the exception lists are not stale', () => {
    for (const [key, reason] of Object.entries(API_FORWARDING_EXCEPTIONS)) {
      assert.ok(reason.length > 20, `${key}: give a real reason`);
      assert.ok(documented.has(key), `${key}: no longer in .env.example, drop the exception`);
      assert.ok(apiRead.has(key), `${key}: no longer read by apps/api/src, drop the exception`);
      assert.ok(
        !forwarded.has(key),
        `${key}: now forwarded by the api service, drop the exception`,
      );
    }
    for (const [key, reason] of Object.entries(UNDOCUMENTED_API_KEYS)) {
      assert.ok(reason.length > 20, `${key}: give a real reason`);
      assert.ok(apiRead.has(key), `${key}: no longer read by apps/api/src, drop the exception`);
      assert.ok(!documented.has(key), `${key}: now in .env.example, drop the exception`);
    }
  });

  it('the demo-reset service forwards what apps/api/src/demo/reset.ts reads', () => {
    const resetReads = readResetEnvKeys(RESET_ENTRYPOINT);
    const resetForwarded = readServiceEnvironmentKeys(COMPOSE, 'demo-reset');
    assert.ok(resetReads.has('DEMO_PASSWORD'), 'reset.ts still reads DEMO_PASSWORD');
    const missing = [...resetReads].filter((key) => !resetForwarded.has(key)).sort();
    assert.deepEqual(missing, [], 'Add each key to the demo-reset environment block');
  });
});
