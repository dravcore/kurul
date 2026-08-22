/**
 * Refuses to run the demo reset anywhere it was not meant to run.
 *
 * `reset.ts` starts by deleting every row in every tenant table, exactly as `prisma/seed.ts`
 * does — but unlike the seed it is **compiled into the shipped image** and is meant to be
 * invoked, on a loop, by a container the operator starts on purpose. `seed-guard.ts` can lean
 * on `NODE_ENV !== 'production'` precisely because the seed can never legitimately run in a
 * production image; that reasoning inverts here. The demo host *is* a production deployment of
 * this image (`apps/api/Dockerfile` bakes `ENV NODE_ENV=production` into the runner), so a
 * `NODE_ENV` check would either refuse the one case this script exists for, or be satisfied by
 * a sidecar that simply leaves the variable unset — which would make "don't set NODE_ENV" the
 * safety mechanism. It is not one.
 *
 * So the guard asks two independent questions and requires both, deliberately from two
 * different sources an accident is unlikely to line up at once:
 *
 * 1. **`DEMO_MODE=true`** — the operator's stated intent, the same single switch that turns on
 *    the banner and turns off the destructive routes (`demo-mode.ts`). A container that can
 *    wipe the database is therefore only ever pointed at a deployment that already announces
 *    itself as a demo.
 * 2. **The database name matches `demo` or `test`** — the target's own identity, read from
 *    `DATABASE_URL`. This is the belt to the first check's braces: `DEMO_MODE` is one typo in
 *    one `.env` away from being true, and the whole point is that no single mistake is enough.
 *
 * ## Why `test` and not `demo` alone
 *
 * The e2e suite runs against `kurul_test` and has to be able to exercise the real reset — a
 * guard that can only be satisfied by a database nobody in CI has is a guard that gets tested
 * by mocking it out, which tests nothing. The two rejected alternatives were worse:
 *
 * - **An override variable only the test sets** (`DEMO_RESET_FORCE`, `JEST_WORKER_ID`, …). That
 *   is a documented way to bypass the guard, shipped inside the image, and `seed-guard.ts`
 *   states the house rule it would break: a destructive operation should never be one
 *   environment variable away from an accident. `isTestEnv()` exists for exactly one sanctioned
 *   use (not opening sockets) and `env.ts` says production code should not branch on it.
 * - **Injecting the allowed pattern.** Then the caller decides what is safe, and the caller in
 *   production is a shell loop in `docker-compose.yml`.
 *
 * Widening to `test` costs almost nothing that check 1 does not already cover: for a real
 * database to be at risk it must both be named something containing `demo` or `test` *and*
 * belong to a deployment whose operator has written `DEMO_MODE=true`. `kurul`, `kurul_prod` and
 * `postgres` — every default this project ships and documents — refuse. It is also the same
 * rule `test/setup-e2e.ts` already applies to itself, for the same reason: that file refuses a
 * `DATABASE_URL` that does not name a test database, because the suite truncates between specs.
 */

/** Database names containing one of these may be wiped. Matched case-insensitively. */
const ALLOWED_DATABASE_NAME_PATTERN = /demo|test/i;

/** Spellings of `true` accepted for `DEMO_MODE`, matching `envBool` in `common/env.ts`. */
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

/**
 * The database name in a Postgres connection string, or `undefined` if there isn't one.
 *
 * A URL parse rather than a regex, so `?schema=public`, a password containing a slash, or an
 * IPv6 host cannot turn part of the authority into the "database name". Anything `URL` cannot
 * parse returns `undefined`, which the caller treats as a refusal — an unreadable target is
 * not a target this script gets to guess about.
 */
export function databaseNameOf(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return undefined;
  }

  const name = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  return name === '' ? undefined : name;
}

/**
 * Throws unless both conditions above hold. Returns the database name it approved, so the
 * caller can log *which* database it is about to empty rather than asserting that it checked.
 */
export function assertDemoResetAllowed(env: {
  demoMode: string | undefined;
  databaseUrl: string | undefined;
}): string {
  if (!TRUE_VALUES.has(env.demoMode?.trim().toLowerCase() ?? '')) {
    throw new Error(
      'Refusing to reset: DEMO_MODE is not "true". This script deletes ALL data before ' +
        'inserting the demo dataset, and it runs only on a deployment that declares itself a demo.',
    );
  }

  const databaseName = databaseNameOf(env.databaseUrl);
  if (databaseName === undefined) {
    throw new Error(
      'Refusing to reset: DATABASE_URL is unset or names no database, so there is no target to check.',
    );
  }

  if (!ALLOWED_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to reset: database "${databaseName}" is not a demo database. This script ` +
        'deletes ALL data, so it runs only against a database whose name contains "demo" ' +
        '(or "test", for the integration suite).',
    );
  }

  return databaseName;
}
