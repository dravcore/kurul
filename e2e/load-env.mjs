/**
 * Loads the repository's `.env` into `process.env`, for the two entry points that need it:
 * `build-stack.mjs` and `playwright.config.ts`.
 *
 * Both need the machine's Postgres credentials, which live in the repository root's `.env`,
 * next to `pnpm-workspace.yaml` — not next to them. The API and web processes they start find
 * it on their own (`apps/api/src/common/env.ts`); these two are plain Node and do not.
 *
 * The root is found by walking up from the working directory looking for
 * `pnpm-workspace.yaml`, the same marker `loadRootEnv()` uses in the API, rather than from
 * this file's own location: Playwright transpiles the config's imports to CommonJS before
 * running them, which leaves `import.meta.url` undefined, while `build-stack.mjs` runs as
 * real ESM where `__dirname` does not exist. A cwd walk is the one form that works under
 * both.
 *
 * `dotenv` never overwrites a variable that is already set, which makes this a no-op in CI:
 * the workflow exports `DATABASE_URL` itself and ships no `.env` file.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// See the note in `build-stack.mjs`: `.mjs` is linted without environment globals.
import process from 'node:process';

function findRepoRoot() {
  let current = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `No pnpm-workspace.yaml above ${process.cwd()} — run the e2e suite from inside the repository.`,
      );
    }
    current = parent;
  }
}

export const repoRoot = findRepoRoot();

config({ path: join(repoRoot, '.env'), quiet: true });
