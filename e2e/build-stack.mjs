/**
 * Builds everything the browser suite needs and migrates its database.
 *
 * This is a separate step, run before `playwright test`, rather than work done inside
 * `globalSetup`. Playwright starts the `webServer` processes and `globalSetup` in an order
 * that has changed between releases; anything that must be finished *before the API boots*
 * — a migrated database, a compiled `apps/api/dist` — cannot depend on that order. Making it
 * a plain script also means CI shows it as its own step with its own timing, which is what
 * makes "the suite took 5 minutes" attributable to the tests rather than to a cold build.
 *
 * Everything here is idempotent, so a local re-run costs only what actually changed.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
// Imported rather than taken off the global object: the repository's ESLint config declares
// no environment globals for `.mjs`, and a `/* global */` comment would silence the rule
// instead of satisfying it.
import process from 'node:process';
import { repoRoot } from './load-env.mjs';
import { API_URL, E2E_STORAGE_PATH, e2eDatabaseUrl } from './stack-shared.mjs';

function run(command, args, extraEnv = {}) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

// `shared-types` and `auth-access` are workspace sources, not published artifacts: the API
// build and the web build both resolve them through their `dist/`, so a stale one produces a
// type error or, worse, a silently outdated enum.
run('pnpm', ['--filter', '@kurul/shared-types', 'build']);
run('pnpm', ['--filter', '@kurul/auth-access', 'build']);

// Prisma's generated client is gitignored, so a fresh checkout has none and `nest build`
// would fail on the import rather than on anything meaningful.
run('pnpm', ['db:generate']);

run('pnpm', ['--filter', '@kurul/api', 'build']);

// The client bundle inlines NEXT_PUBLIC_API_URL, so the suite needs its own build — see the
// note in `e2e/stack-env.ts`. This overwrites `apps/web/.next`.
run('pnpm', ['--filter', '@kurul/web', 'exec', 'next', 'build'], {
  NEXT_PUBLIC_API_URL: API_URL,
});

// Assemble the standalone bundle the same way `apps/web/Dockerfile` does.
//
// `next build` emits `.next/standalone` with the server and its traced dependencies, but
// deliberately leaves `.next/static` and `public` out — a real deployment serves those from
// a CDN or copies them in. Copying them here is what makes the suite run *the artifact that
// ships* instead of `next start`, which Next now warns is unsupported under
// `output: 'standalone'` (it still serves, so the warning is easy to ignore until a Next
// upgrade turns it into a failure — and a browser suite that stops running because of a
// server it was never supposed to use is a bad way to spend a nightly).
const standaloneWebDir = join(repoRoot, 'apps/web/.next/standalone/apps/web');
if (!existsSync(join(standaloneWebDir, 'server.js'))) {
  throw new Error(
    `Expected a standalone server at ${standaloneWebDir}/server.js. ` +
      'Has `output: "standalone"` been removed from apps/web/next.config.ts?',
  );
}
// Removed first: `cpSync` merges into an existing tree, so a chunk that no longer exists in
// the new build would survive from the previous one and be served alongside it.
rmSync(join(standaloneWebDir, '.next/static'), { recursive: true, force: true });
cpSync(join(repoRoot, 'apps/web/.next/static'), join(standaloneWebDir, '.next/static'), {
  recursive: true,
});
cpSync(join(repoRoot, 'apps/web/public'), join(standaloneWebDir, 'public'), { recursive: true });
process.stdout.write('\n> copied .next/static and public into the standalone bundle\n');

// `migrate deploy` creates the database when it does not exist, so a first run on a new
// machine needs no `createdb`.
run('pnpm', ['db:migrate'], { DATABASE_URL: e2eDatabaseUrl() });

// Attachment bytes from previous runs. Emptied rather than kept: the rows that reference them
// are never read again (every scenario builds its own task), and the upload measurement under
// `e2e/measure` writes 10 MB a run — ballast that would otherwise accumulate in the developer's
// temp directory with nothing ever pruning it. The API recreates the tree on its first write.
rmSync(E2E_STORAGE_PATH, { recursive: true, force: true });
process.stdout.write(`\n> emptied ${E2E_STORAGE_PATH}\n`);
