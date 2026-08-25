/**
 * Environment-forwarding drift checks between `.env.example`, `apps/api/src` and
 * `docker-compose.yml`, exercised by `compose-env.test.mjs` (`pnpm test:scripts`).
 *
 * Why this exists: Compose reads `.env` for `${VAR}` interpolation only and never hands the
 * file to a container, and the api image ships no `.env` of its own (`.dockerignore`), so a
 * setting the API reads reaches a Compose install only when the `api` service's
 * `environment:` block names it. Every key that was added to `.env.example` and the env
 * helpers but not to that block (`PLAN_MAX_*`, `INSTANCE_ADMIN_EMAILS`, the retention windows,
 * telemetry, `API_DOCS_ENABLED`, the pool knobs) was silently inert on every curl/GHCR install
 * until 2026-08. These functions make that a failing test instead of a support question.
 *
 * Dependency-free on purpose, like the rest of `scripts/`: the YAML reading below is a small
 * indentation walk over the one shape this repository's compose files have (a `services:` map
 * of block mappings, `x-*` anchors merged with `<<: *name`), not a YAML parser.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keys `apps/api/src` reads that are deliberately absent from `.env.example`, with the reason.
 * A key listed here that the API stops reading fails the stale-exception test.
 */
export const UNDOCUMENTED_API_KEYS = Object.freeze({
  NODE_ENV: 'Set by the runtime, not the operator: apps/api/Dockerfile bakes `production`.',
  JEST_WORKER_ID: 'Set by Jest itself; `isTestEnv()` in common/env.ts is its one sanctioned use.',
});

/**
 * Keys `.env.example` documents and `apps/api/src` reads that the `api` service deliberately
 * does not forward, with the reason. A key listed here that the API stops reading, or that
 * `.env.example` stops documenting, or that the `api` block starts forwarding after all, fails
 * the stale-exception test so the list cannot rot.
 */
export const API_FORWARDING_EXCEPTIONS = Object.freeze({
  DEMO_PASSWORD:
    'Read only by apps/api/src/demo/reset.ts, the entrypoint of the `demo-reset` service; ' +
    'that block is checked separately. The api process never needs the published password.',
});

/** Files under `apps/api/src` that are not the API process: generated code and test files. */
const API_SOURCE_EXCLUDED = /(^|\/)generated\/|\.(spec|test)\.ts$|\.d\.ts$/;

/**
 * Keys `.env.example` documents: every `KEY=` at column zero. A key mentioned only inside a
 * comment (`# CLEANUP_ENABLED=false switches …`) is prose, not a documented setting.
 */
export function readDocumentedKeys(envExamplePath) {
  const keys = new Set();
  for (const line of readFileSync(envExamplePath, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function walkFiles(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkFiles(full, out);
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Environment keys `apps/api/src` reads, found by the shapes the code actually uses:
 *
 * - `envString('KEY', …)`, `envInt`, `envBool`, `envPort` (common/env.ts helpers);
 * - `process.env.KEY` and `process.env['KEY']`;
 * - `env.KEY` on an injected `NodeJS.ProcessEnv` (observability/sentry.ts);
 * - `SOMETHING_ENV = 'KEY'` constants passed to the helpers by name;
 * - any `'KEY'` / `"KEY"` string literal that is also a documented key, which is how the
 *   call sites that take the name as a parameter (`retentionDays('ACTIVITY_RETENTION_DAYS')`,
 *   `readCeiling(PLAN_LIMIT_ENV.users)`, `readBytes('ATTACHMENT_…')`) are caught.
 *
 * `documentedKeys` is only used for the last shape, so a literal that merely looks like a
 * key (`'PLAN_LIMIT_SEATS'`, a response code) is not mistaken for an env read.
 */
export function readApiEnvKeys(apiSrcDir, documentedKeys) {
  const keys = new Set();
  const patterns = [
    /\benv(?:String|Int|Bool|Port)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
    /\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /\benv\.([A-Z][A-Z0-9_]*)\b/g,
    /\b[A-Z][A-Z0-9_]*_ENV\s*=\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  ];

  for (const file of walkFiles(apiSrcDir, [])) {
    if (API_SOURCE_EXCLUDED.test(file)) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        keys.add(match[1]);
      }
    }
    for (const match of source.matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)) {
      if (documentedKeys.has(match[1])) {
        keys.add(match[1]);
      }
    }
  }
  return keys;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/**
 * Direct child keys of the block mapping that starts after `lines[start]`, resolving `<<: *name`
 * merges against `anchors` (line index of each `&name`). Returns `[]` for a scalar/flow value.
 */
function mappingKeys(lines, start, anchors, seen = new Set()) {
  const keys = [];
  let childIndent = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (isBlankOrComment(line)) {
      continue;
    }
    const indent = indentOf(line);
    if (childIndent === null) {
      if (indent <= indentOf(lines[start])) {
        return keys;
      }
      childIndent = indent;
    }
    if (indent < childIndent) {
      return keys;
    }
    if (indent > childIndent) {
      continue;
    }
    const merge = /^\s*<<:\s*\*([\w-]+)/.exec(line);
    if (merge) {
      const anchorLine = anchors.get(merge[1]);
      if (anchorLine !== undefined && !seen.has(merge[1])) {
        seen.add(merge[1]);
        keys.push(...mappingKeys(lines, anchorLine, anchors, seen));
      }
      continue;
    }
    const listEntry = /^\s*-\s*([A-Z][A-Z0-9_]*)/.exec(line);
    if (listEntry) {
      keys.push(`- ${listEntry[1]}`);
      continue;
    }
    const key = /^\s*([^\s#][^:]*):/.exec(line);
    if (key) {
      keys.push(key[1].trim());
    }
  }
  return keys;
}

/**
 * Keys of `services.<service>.environment` in a compose file (map form, `KEY: value`).
 * Anchors (`&name` / `<<: *name`) are resolved; list-form `- KEY=value` entries are read too.
 */
export function readServiceEnvironmentKeys(composePath, service) {
  const lines = readFileSync(composePath, 'utf8').split('\n');
  const anchors = new Map();
  lines.forEach((line, index) => {
    const match = /&([\w-]+)\s*$/.exec(line.replace(/#.*$/, ''));
    if (match && !isBlankOrComment(line)) {
      anchors.set(match[1], index);
    }
  });

  const servicesLine = lines.findIndex((line) => /^services:\s*$/.test(line));
  if (servicesLine === -1) {
    throw new Error(`${composePath}: no top-level services: mapping`);
  }
  const serviceLine = lines.findIndex(
    (line, index) => index > servicesLine && new RegExp(`^\\s+${service}:\\s*$`).test(line),
  );
  if (serviceLine === -1) {
    throw new Error(`${composePath}: no service named ${service}`);
  }

  const serviceIndent = indentOf(lines[serviceLine]);
  let environmentLine = -1;
  for (let i = serviceLine + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (isBlankOrComment(line)) {
      continue;
    }
    if (indentOf(line) <= serviceIndent) {
      break;
    }
    if (/^\s+environment:\s*$/.test(line) && indentOf(line) === serviceIndent + 2) {
      environmentLine = i;
      break;
    }
  }
  if (environmentLine === -1) {
    return new Set();
  }

  const keys = new Set();
  for (const key of mappingKeys(lines, environmentLine, anchors)) {
    const listEntry = /^-\s*([A-Z][A-Z0-9_]*)/.exec(key);
    keys.add(listEntry ? listEntry[1] : key);
  }
  return keys;
}

/**
 * Keys the demo reset entrypoint reads straight from `process.env`. Kept separate from
 * `readApiEnvKeys` because the same file is compiled into the api image but only ever runs
 * as the `demo-reset` service's process.
 */
export function readResetEnvKeys(resetPath) {
  const keys = new Set();
  const source = readFileSync(resetPath, 'utf8');
  for (const match of source.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g)) {
    keys.add(match[1]);
  }
  return keys;
}

/**
 * Documented, API-read keys the `api` service must forward but does not. The caller decides
 * what to do with the list; the test fails on a non-empty one.
 */
export function missingApiForwarding({ documented, apiRead, forwarded, exceptions }) {
  return [...apiRead]
    .filter((key) => documented.has(key) && !forwarded.has(key) && !(key in exceptions))
    .sort();
}
