/**
 * What the build step and the tests must agree on, byte for byte.
 *
 * Plain ESM rather than TypeScript because `e2e/build-stack.mjs` runs under bare Node with no
 * transpiler in front of it, while `e2e/stack-env.ts` is loaded by Playwright. Restating any
 * of this in both places would make "the suite builds the bundle for port 4110 but the tests
 * drive port 4000", or "the build migrates one database and the API opens another", possible
 * states — and both of those failures read as a broken application rather than a broken
 * harness.
 *
 * Everything else about the stack lives in `e2e/stack-env.ts`, which imports this file.
 */
// The repository's ESLint config declares no environment globals for `.mjs`, so these are
// imported rather than taken off the global object.
import process from 'node:process';
import { URL } from 'node:url';

/** Both servers sit in the 31xx/41xx band so a run cannot collide with `pnpm dev`. */
export const WEB_PORT = 3110;
export const API_PORT = 4110;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/**
 * Not the `kurultay_test` the Jest integration suite truncates between tests — a shared
 * database is how two parallel runs delete each other's rows mid-assertion.
 */
export const E2E_DATABASE_NAME = 'kurultay_test_playwright';

/**
 * The suite's own Postgres URL: the developer's (or CI's) connection with the database name
 * replaced.
 *
 * Derived rather than declared so that a laptop with a non-default Postgres port or password
 * needs no extra configuration, and so that the suite cannot be aimed at an arbitrary database
 * by setting one more environment variable. `build-stack.mjs` migrates this URL and
 * `stack-env.ts` hands it to the API, which is why it is defined once here.
 */
export function e2eDatabaseUrl() {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in — the e2e suite ' +
        'derives its own database URL from it (see e2e/stack-shared.mjs).',
    );
  }
  const parsed = new URL(base);
  parsed.pathname = `/${E2E_DATABASE_NAME}`;
  return parsed.toString();
}
