import { defineConfig, devices } from '@playwright/test';
import { apiEnv, API_URL, webEnv, WEB_URL } from './stack-env';

/**
 * Browser end-to-end suite — four scenarios, deliberately.
 *
 * `docs/testing.md` deferred browser tests while the board UI was still changing shape every
 * week, and that judgement was right: a full suite written then would have been rewritten
 * three times. What it left behind is the gap this config closes — the flows that make the
 * product what it is (drag persistence, live sync, invitation, notification) had no
 * verification in a real browser at all. The unit and API-integration suites both pass with a
 * board that never renders.
 *
 * The scope stays four scenarios on purpose. Every test added here is one more thing to keep
 * green through a UI refactor, and the point of this suite is to notice when the *stack*
 * comes apart, not to re-check what the unit and integration suites already cover.
 */
export default defineConfig({
  testDir: './tests',

  /**
   * Chromium only. A second browser engine would roughly double the wall clock for a class of
   * bug (vendor-specific CSS/pointer differences) that this suite is not looking for — it is
   * checking that the stack holds together, and the stack is engine-independent. If a
   * rendering bug ever justifies it, add the project rather than widening every scenario.
   */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Serial-safe by construction: every test creates its own users, workspace and board with
   * unique identifiers, so nothing shares state and parallel execution is free. This is what
   * keeps the run inside its five-minute budget.
   */
  fullyParallel: true,

  /**
   * No retries, anywhere — including CI.
   *
   * A retry turns a flaky test into a green one, which is the single most effective way to
   * make a suite stop meaning anything. This suite is small enough that a genuine flake is
   * worth a person's attention. What makes that affordable is the other half of the stance:
   * no fixed waits anywhere, only `expect.poll` and web-first assertions (see
   * `support/board-page.ts`). If a scenario needs a retry to be green, it needs a fix.
   */
  retries: 0,
  forbidOnly: Boolean(process.env.CI),

  /**
   * 45s per test. Generous relative to what the scenarios do (the slowest, invitation, makes
   * two round trips through Mailpit), but the failure it guards against — a hung socket, a
   * server that never came up — should surface as a timeout with a trace, not as a job that
   * runs until the workflow's own limit.
   */
  timeout: 45_000,

  /**
   * Five minutes for the whole suite, enforced rather than aspired to.
   *
   * The budget is the reason this suite is four scenarios and not forty: a nightly that takes
   * twenty minutes is a nightly people stop reading. Putting the ceiling here instead of in
   * the workflow's `timeout-minutes` means it also applies locally, so the run that first
   * exceeds it is the one on the author's machine. Measured on a laptop the four take about
   * four seconds; the margin is for a cold CI runner, not for growth.
   */
  globalTimeout: 5 * 60_000,

  expect: {
    /**
     * 10s for a single assertion. Long enough for the realtime path's worst documented case
     * (a 120ms per-id debounce, then a REST refetch) plus a cold server-rendered navigation,
     * and short enough that a genuinely stuck expectation fails inside the test timeout with
     * room for the trace to be written.
     */
    timeout: 10_000,
  },

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: WEB_URL,
    /**
     * A trace for every failure, and only for failures. Traces are what make a nightly
     * failure diagnosable the next morning without reproducing it locally — which for a
     * realtime or mail scenario is the expensive part.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    /**
     * Deliberately shorter than `expect.timeout`: an action that cannot find its element is
     * almost always a changed selector, and a fast failure there keeps a UI rename from
     * costing the full test timeout four times over.
     */
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
  },

  /**
   * Both servers, started by Playwright and torn down with it.
   *
   * They run built artifacts, not `nest start --watch` / `next dev`: the production build is
   * what ships, and dev mode's on-demand route compilation adds seconds of latency to the
   * *first* visit of every route — latency that lands inside the assertions and reads as
   * flake. `e2e/build-stack.mjs` produces both before this file is loaded.
   *
   * `reuseExistingServer` is off in CI (a leftover process there means something is wrong)
   * and on locally, so an iteration loop can keep the stack warm between `playwright test`
   * runs.
   */
  webServer: [
    {
      // The compiled Nest entrypoint, not `pnpm --filter … start`: pnpm would sit between
      // Playwright and the server as an extra process, and Playwright's teardown kills the
      // process it spawned — leaving an orphaned API holding port 4110 for the next run.
      command: 'node ../apps/api/dist/main.js',
      env: apiEnv(),
      // `/health` is the API's own liveness probe and is exempt from rate limiting, so
      // polling it cannot consume the budget the tests need.
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The API writes one access-log line per request and the board makes eight on load, so
      // piping stdout buries the test report in traffic that the trace already records
      // better. stderr stays piped: that is where a crash or an unhandled rejection shows up,
      // and a server that died mid-run is exactly the failure worth reading in the console.
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // The standalone bundle `apps/web/Dockerfile` deploys, assembled by build-stack.mjs.
      // HOSTNAME is set because Next's standalone server binds `$HOSTNAME` and inherits
      // whatever the shell exported — on a developer machine that is the laptop's name,
      // which resolves to an address Playwright is not polling.
      command: 'node ../apps/web/.next/standalone/apps/web/server.js',
      env: { ...webEnv(), HOSTNAME: '127.0.0.1' },
      // `/login` rather than `/`: `/` is a middleware redirect, and a redirect answering
      // does not prove the app can render a page.
      url: `${WEB_URL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Same reasoning as the API above: Next's request log adds nothing the trace does not
      // already have, while a stack trace on stderr is the one thing worth seeing live.
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
