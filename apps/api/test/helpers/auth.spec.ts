import { buildUniqueSlug, uniqueEmail, uniqueSuffix } from './auth';

/**
 * Regression coverage for #173: `createWorkspace`'s slug and `signUp`'s email used to
 * derive their uniqueness from `Date.now()` plus a handful of `Math.random()`
 * characters, which a deterministic reproduction (see the PR description) showed
 * collides — sometimes under load, and with certainty for the many e2e call sites that
 * appended no randomness at all. The actual failure is a race between concurrent
 * `test:e2e` processes sharing a database, which an in-process e2e test can't force
 * deterministically. What CAN be pinned down deterministically is the generator
 * itself: freeze the clock (the exact condition two concurrent processes hit when they
 * reach the same call within the same millisecond) and confirm it still can't produce
 * a duplicate. That's what this file asserts — a true regression test for the race
 * would be flaky by construction, so this is the closest deterministic proxy.
 */
describe('test/helpers/auth unique-value generators', () => {
  // Comfortably larger than the old generator's entropy (36^4 = 1,679,616 for the
  // slug, 36^6 ≈ 2.18e9 for the email) so this count alone would have caught the old
  // formula colliding, without making the suite slow.
  const CALLS = 50_000;

  it('uniqueSuffix produces no duplicates across many calls with the clock frozen', () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000; // arbitrary fixed millisecond
    try {
      const seen = new Set<string>();
      for (let i = 0; i < CALLS; i++) {
        seen.add(uniqueSuffix());
      }
      expect(seen.size).toBe(CALLS);
    } finally {
      Date.now = originalNow;
    }
  });

  it('buildUniqueSlug produces no duplicates even when every caller passes the same literal prefix with the clock frozen', () => {
    // Mirrors the real-world shape that #173 traced the failure to: many e2e spec
    // files call `createWorkspace(agent, name, 'roles-${Date.now()}')` with an
    // IDENTICAL literal prefix (the reused `roles-`, `a-`, `b-`, ... prefixes across
    // board.e2e-spec.ts, task.e2e-spec.ts, workspace.e2e-spec.ts, ...), and two
    // concurrent processes computing that string within the same millisecond used to
    // collide with certainty.
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const seen = new Set<string>();
      for (let i = 0; i < CALLS; i++) {
        seen.add(buildUniqueSlug('roles'));
      }
      expect(seen.size).toBe(CALLS);
    } finally {
      Date.now = originalNow;
    }
  });

  it('buildUniqueSlug always satisfies the DTO constraints regardless of the label', () => {
    // create-workspace.dto.ts: 2-48 chars, lowercase alphanumeric with optional
    // single hyphens (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`).
    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const labels = [
      'ws',
      'roles',
      'a-very-long-label-that-would-have-blown-past-the-48-character-cap-on-its-own',
      '',
    ];
    for (const label of labels) {
      const slug = buildUniqueSlug(label);
      expect(slug.length).toBeGreaterThanOrEqual(2);
      expect(slug.length).toBeLessThanOrEqual(48);
      expect(slug).toMatch(slugPattern);
    }
  });

  it('uniqueEmail produces no duplicates across many calls with the clock frozen', () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const seen = new Set<string>();
      for (let i = 0; i < CALLS; i++) {
        seen.add(uniqueEmail('user'));
      }
      expect(seen.size).toBe(CALLS);
    } finally {
      Date.now = originalNow;
    }
  });
});
