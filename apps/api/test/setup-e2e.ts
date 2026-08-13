import { loadRootEnv } from '../src/common/env';

loadRootEnv();

const FALLBACK_DATABASE_URL = 'postgresql://kurultay:kurultay@localhost:5432/kurultay_test';

/**
 * Integration tests always target the dedicated test database — they truncate between specs,
 * so pointing them at a development database would empty it.
 *
 * A `DATABASE_URL` that does not name a test database is therefore refused rather than
 * corrected. Silently rewriting it looks like the safe option and is not: the rewrite sends
 * the run to whatever happens to be listening on the hard-coded port, which on a machine with
 * more than one checkout is a different database than either the caller or the fallback
 * intended. The failure that produces is a confusing one — passing tests against unexpected
 * data — where refusing outright is a single readable line.
 */
function resolveTestDatabaseUrl(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) return FALLBACK_DATABASE_URL;
  if (configured.includes('kurultay_test')) return configured;

  throw new Error(
    `DATABASE_URL does not name a test database, and integration tests truncate between specs.\n` +
      `  got:      ${configured}\n` +
      `  expected: a URL whose database name contains "kurultay_test"\n` +
      `Unset DATABASE_URL to use ${FALLBACK_DATABASE_URL}, or point it at a test database.`,
  );
}

process.env.DATABASE_URL = resolveTestDatabaseUrl();

/**
 * Integration specs drive hundreds of requests per route from a single loopback address in
 * seconds — the exact traffic shape the rate limits exist to reject. The limits themselves are
 * covered by `src/common/rate-limit/*.spec.ts`, which builds a module with a tiny limit rather
 * than relying on the production numbers being small enough to trip.
 */
process.env.RATE_LIMIT_ENABLED = 'false';

/**
 * The retention sweep is a scheduled, global `DELETE` with no tenant scope — exactly the job
 * that must not be running in the background of a suite whose fixtures are backdated rows.
 * BullMQ produces a scheduler's first job the moment it is registered, so leaving this on
 * would let `createTestApp()` start deleting another spec's seed data mid-run.
 *
 * `test/retention-cleanup.e2e-spec.ts` turns it back on around each of its own `runCleanup`
 * calls; the worker re-reads the switch per run precisely so that is possible.
 */
process.env.CLEANUP_ENABLED = 'false';

process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET?.trim() || 'test-secret-not-for-production';
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:4000';
process.env.WEB_URL = process.env.WEB_URL?.trim() || 'http://localhost:3000';
