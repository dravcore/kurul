import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The measurement rig, deliberately *not* part of the smoke suite.
 *
 * Two numbers this repository has promised — the ROADMAP's "attaching a 10 MB file ≤3s" and
 * P2-8's claim that the board stays cheap — are measurements, not assertions. Putting them in
 * `tests/` would have made every nightly pay for them and would have turned a slow laptop into
 * a red build, which is the one thing a performance number must never do: a threshold that
 * fails the build gets raised until it stops failing, and then it measures nothing.
 *
 * So they live here, behind their own config and their own command:
 *
 *     pnpm --filter @kurul/e2e exec playwright test -c measure.config.ts
 *
 * It sits beside `playwright.config.ts` rather than inside `measure/` for a mechanical reason:
 * Playwright resolves a `webServer` command's working directory against the *config's*
 * directory, and a config one level down would look for `apps/api/dist` under `e2e/`.
 *
 * The stack, the environment and the ports are inherited from `./playwright.config.ts` by
 * spreading it — the same built artifacts, the same database, the same `STORAGE_PATH`. That is
 * the point of extending rather than redeclaring: a measurement taken against a differently
 * configured stack is not comparable to anything, and a second copy of `webServer` would drift
 * from the first the first time either is touched.
 *
 * What is overridden, and why:
 *
 *  - **`workers: 1`.** Every number here is a duration. Two of them measured at once are two
 *    measurements of a contended machine.
 *  - **`retries: 0` and a long `globalTimeout`.** A measurement that runs twice reports the
 *    warm run; the loops inside these files are long by design and must not be cut short.
 *  - **`trace: 'off'`.** The tracer instruments the very thing being measured.
 *
 * Nothing here fails on a number. Each file asserts only that the operation *succeeded* — a
 * 201, a rendered board — and then prints what it measured, because a rig that silently
 * reports a timing for a request that 500'd is worse than no rig.
 */
export default defineConfig({
  ...base,
  testDir: './measure',
  testMatch: '**/*.measure.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  globalTimeout: 30 * 60_000,
  reporter: [['list']],
  use: { ...base.use, trace: 'off', screenshot: 'off', video: 'off' },
});
