/**
 * The checks behind `pnpm bootstrap --check`: has this checkout actually got what
 * `pnpm bootstrap` (`scripts/bootstrap.mjs`) sets up, or does it only look like it has.
 *
 * ## Why a doctor mode, and why these three things
 *
 * `pnpm bootstrap` is idempotent and safe to re-run, but re-running it is not free — it starts
 * containers and waits on health checks. Most of the time what a contributor actually wants to
 * know after `git pull` is narrower: "did something upstream move that I now need to rebuild
 * or regenerate", answerable from the filesystem in well under a second. This module answers
 * exactly the three ways this repository's dev loop goes stale silently instead of loudly (the
 * class of bug `bootstrap.mjs`'s own docstring names: `Cannot find module '@kurul/shared-types'`,
 * `TS2307`, a seed that dies reaching into a package's dist):
 *
 * 1. **`packages/shared-types` and `packages/auth-access` dist go stale.** Both are consumed
 *    from a git-ignored `dist/` by `pnpm dev` and `pnpm db:seed` (the test suites read `src`
 *    directly and are not covered by this check — see the `[0.3.0]` CHANGELOG entry on
 *    that fix). `apps/api/dist` and `apps/web/.next` are deliberately **not** checked here:
 *    neither `pnpm dev` nor `pnpm bootstrap` builds them (`bootstrap.mjs`'s own docstring: "The
 *    build is still needed for … `nest build`, `next build`"), so a doctor check on them would
 *    report a checkout unhealthy for a step the dev loop never asked it to take.
 * 2. **The generated Prisma client goes stale or missing.** `pnpm db:generate` writes to
 *    `apps/api/src/generated/prisma`, which is git-ignored and has no `postinstall` hook.
 * 3. **`.env` is missing a variable `pnpm bootstrap` would have failed loudly on anyway** —
 *    `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, and the `DATABASE_URL` placeholder. This
 *    intentionally checks the same two required keys `bootstrap.mjs`'s own preflight already
 *    hard-fails on (`readEnv` in that file) rather than a second, wider list: those two are the
 *    only variables with no default that compose or the app refuses to start without, and
 *    duplicating a broader "required" list here would drift from the one that actually gates
 *    boot.
 *
 * ## Freshness, not correctness
 *
 * "Freshness" here means an mtime comparison: the newest file under a source tree versus the
 * newest file under its build output (or, for Prisma, versus `schema.prisma` itself, which
 * already stands in for "the thing that was generated from"). This is deliberately cheaper than
 * a content hash — a stale build is *already* the failure mode this exists to catch (a build
 * that is merely unnecessary costs nothing to report as fine) — and it is what `pnpm bootstrap`
 * itself already trusts implicitly by always rebuilding rather than checking (see that file's
 * step 2 comment). A clock skew between a checked-out `mtime` and a freshly generated one is not
 * a case this codebase's dev tooling has needed to handle anywhere else.
 *
 * Every check function here takes explicit paths rather than reading `process.cwd()` or a
 * hardcoded root, so the test suite can point them at a throwaway temp directory instead of
 * this repository's own state.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The two `.env` keys `bootstrap.mjs`'s own preflight has no default for and refuses to boot
 * without — kept here as the single list so `--check` cannot drift from what actually gates
 * `pnpm bootstrap`. */
export const REQUIRED_ENV_KEYS = ['POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET'];

/**
 * Finds the newest modification time under `dir`, recursively.
 *
 * Returns `null` for a directory that does not exist or contains no files — both are "cannot
 * tell you when this was last touched", which a caller treats as "not built" rather than as an
 * error. `node_modules` is skipped: a package's own `node_modules` (present when a package is
 * installed standalone, never in this pnpm workspace) would otherwise dominate every comparison
 * with dependency mtimes that say nothing about the package's own source.
 */
export function newestMtimeMs(dir) {
  if (!existsSync(dir)) return null;

  let newest = null;
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const { mtimeMs } = statSync(full);
        if (newest === null || mtimeMs > newest) newest = mtimeMs;
      }
    }
  }

  return newest;
}

/**
 * Checks that `distDir` exists and is at least as new as `srcDir`.
 *
 * `label` names the check in the printed report; `fix` is the exact command that rebuilds it.
 */
export function checkBuildFreshness({ label, srcDir, distDir, fix }) {
  if (!existsSync(distDir)) {
    return { name: label, ok: false, message: 'not built (no dist/ directory)', fix };
  }

  const srcNewest = newestMtimeMs(srcDir);
  const distNewest = newestMtimeMs(distDir);

  if (distNewest === null) {
    return { name: label, ok: false, message: 'dist/ exists but is empty', fix };
  }
  if (srcNewest !== null && srcNewest > distNewest) {
    return { name: label, ok: false, message: 'stale — source is newer than the last build', fix };
  }

  return { name: label, ok: true, message: 'up to date' };
}

/**
 * Checks that the generated Prisma client exists and is at least as new as `schemaPath`.
 */
export function checkPrismaClient({ schemaPath, clientDir, fix }) {
  if (!existsSync(schemaPath)) {
    return {
      name: 'Prisma client',
      ok: false,
      message: `schema not found at ${schemaPath}`,
      fix: 'check apps/api/prisma/schema.prisma exists in this checkout',
    };
  }
  if (!existsSync(clientDir)) {
    return { name: 'Prisma client', ok: false, message: 'not generated', fix };
  }

  const schemaMtime = statSync(schemaPath).mtimeMs;
  const clientNewest = newestMtimeMs(clientDir);

  if (clientNewest === null) {
    return { name: 'Prisma client', ok: false, message: 'generated directory is empty', fix };
  }
  if (schemaMtime > clientNewest) {
    return {
      name: 'Prisma client',
      ok: false,
      message: 'stale — schema.prisma is newer than the generated client',
      fix,
    };
  }

  return { name: 'Prisma client', ok: true, message: 'up to date with schema.prisma' };
}

/**
 * Reads `.env` well enough to check presence — same one-question scope as `bootstrap.mjs`'s own
 * `readEnv`, duplicated rather than imported because that file is a standalone script with no
 * import from the workspace by design (see its own docstring) and this module keeps the same
 * constraint for the same reason: it has to run on a checkout where nothing is built yet.
 */
export function readEnvFile(envPath) {
  const env = new Map();
  if (!existsSync(envPath)) return env;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    env.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
  }
  return env;
}

/**
 * Checks that `.env` exists and carries every key in `required` (default:
 * {@link REQUIRED_ENV_KEYS}) with a non-empty value, and that `DATABASE_URL` no longer carries
 * the `<POSTGRES_PASSWORD>` placeholder `.env.example` ships — the same three conditions
 * `bootstrap.mjs`'s own preflight fails on before touching Docker.
 */
export function checkRequiredEnv({ envPath, required = REQUIRED_ENV_KEYS }) {
  if (!existsSync(envPath)) {
    return {
      name: 'required env keys',
      ok: false,
      message: 'no .env in the repository root',
      fix: 'cp .env.example .env, then fill in POSTGRES_PASSWORD and BETTER_AUTH_SECRET',
    };
  }

  const env = readEnvFile(envPath);
  const missing = required.filter((key) => !env.get(key)?.trim());

  if (missing.length > 0) {
    return {
      name: 'required env keys',
      ok: false,
      message: `${missing.join(', ')} empty or missing in .env`,
      fix: `set ${missing.join(', ')} in .env — see docs/development.md#environment-variables`,
    };
  }

  const databaseUrl = env.get('DATABASE_URL') ?? '';
  if (databaseUrl.includes('<POSTGRES_PASSWORD>')) {
    return {
      name: 'required env keys',
      ok: false,
      message: 'DATABASE_URL still carries the <POSTGRES_PASSWORD> placeholder',
      fix: 'replace <POSTGRES_PASSWORD> in DATABASE_URL with the value you set for POSTGRES_PASSWORD',
    };
  }

  return { name: 'required env keys', ok: true, message: 'present' };
}

/**
 * Runs every doctor check against a repository root and returns the results in the fixed order
 * they should be printed. Pure — no `console`, no `process.exit` — so the CLI wiring and the
 * test suite can both call it.
 */
export function runDoctorChecks(root) {
  const buildFix = 'pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build';

  return [
    checkBuildFreshness({
      label: '@kurul/shared-types dist',
      srcDir: join(root, 'packages', 'shared-types', 'src'),
      distDir: join(root, 'packages', 'shared-types', 'dist'),
      fix: buildFix,
    }),
    checkBuildFreshness({
      label: '@kurul/auth-access dist',
      srcDir: join(root, 'packages', 'auth-access', 'src'),
      distDir: join(root, 'packages', 'auth-access', 'dist'),
      fix: buildFix,
    }),
    checkPrismaClient({
      schemaPath: join(root, 'apps', 'api', 'prisma', 'schema.prisma'),
      clientDir: join(root, 'apps', 'api', 'src', 'generated', 'prisma'),
      fix: 'pnpm db:generate',
    }),
    checkRequiredEnv({ envPath: join(root, '.env') }),
  ];
}
