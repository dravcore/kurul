import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/** File that only ever exists at the monorepo root — the anchor for locating `.env`. */
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Walks up from `startDir` looking for the monorepo root.
 *
 * Resolution starts at this module's own directory rather than `process.cwd()`, so it
 * behaves identically whether the API is run from `apps/api` (`pnpm dev`), from the repo
 * root, or from `dist` in a container.
 */
function findWorkspaceRoot(startDir: string): string | undefined {
  let dir = startDir;

  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Loads the monorepo-root `.env`.
 *
 * Real environment variables always win: `dotenv` does not override anything already set
 * in `process.env`. A missing root (a production image that ships only `dist`) or a
 * missing `.env` is not an error — the environment is expected to be supplied by the
 * container runtime there.
 */
export function loadRootEnv(): void {
  const root = findWorkspaceRoot(__dirname);
  if (root === undefined) {
    return;
  }

  loadDotenv({ path: join(root, '.env'), quiet: true });
}

/**
 * Reads an integer environment variable.
 *
 * Unset or blank falls back to `fallback`; anything that is not a plain integer is a
 * configuration error and throws, rather than silently degrading (`Number('')` is `0`,
 * `Number('abc')` is `NaN` — both of which make `app.listen` bind an arbitrary port).
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name}: expected an integer, received "${raw}"`);
  }

  return parsed;
}

/**
 * Reads a port environment variable, rejecting integers outside the TCP port range.
 */
export function envPort(name: string, fallback: number): number {
  const port = envInt(name, fallback);
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}: expected a port between 1 and 65535, received "${port}"`);
  }

  return port;
}

/**
 * Reads a string environment variable. Unset or blank falls back to `fallback`, so an
 * empty `WEB_URL=` in `.env` cannot turn into a CORS origin of `''`.
 */
export function envString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * True while the process is a Jest run.
 *
 * Production code should not branch on this — the one sanctioned use is refusing to open
 * outbound connections (Redis) that a unit test never tears down. Keeping the check here
 * means there is exactly one place to audit, instead of `JEST_WORKER_ID` sprinkled around.
 */
export function isTestEnv(): boolean {
  return process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test';
}

/** True only under `NODE_ENV=production`; gates leaking internals into error responses. */
export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}
