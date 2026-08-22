import { defineConfig, devices } from '@playwright/test';
import { apiEnv, API_URL, webEnv, WEB_URL } from './stack-env';

/**
 * Browser end-to-end suite — seven scenarios, deliberately.
 *
 * `docs/testing.md` deferred browser tests while the board UI was still changing shape every
 * week, and that judgement was right: a full suite written then would have been rewritten
 * three times. What it left behind is the gap this config closes — the flows that make the
 * product what it is (drag persistence, live sync, invitation, notification) had no
 * verification in a real browser at all. The unit and API-integration suites both pass with a
 * board that never renders.
 *
 * The scope stays small on purpose. Every test added here is one more thing to keep green
 * through a UI refactor, and the point of this suite is to notice when the *stack* comes
 * apart, not to re-check what the unit and integration suites already cover.
 *
 * **Why the number went from four to five.** `tests/task-attachment.spec.ts` was added for
 * P3-1, and it is here rather than in the API or Vitest suites because of what only a browser
 * produces: a real `<input type="file">` builds a real multipart body, and it is *Chromium's*
 * encoding of a non-ASCII filename meeting busboy's `defParamCharset` that had never been
 * checked anywhere — the API suite writes its own multipart bodies, so it cannot disagree with
 * the browser. The scenario then takes the download and compares it byte for byte, which is
 * the difference between a row that renders and a file that comes back. That is the same test
 * this file's admission criterion asks for — a way the *stack* comes apart that no in-process
 * suite can see — and the ROADMAP records it as P3-1's "one scenario added to the Playwright
 * smoke".
 *
 * The cost was measured before it was accepted, not asserted after: 24 consecutive local runs
 * of the five, 4.0–4.5s wall clock each (median 4.2s), against 3.6–3.9s for the four. The
 * fifth scenario is the slowest single test at ~2.3s, and it costs the *suite* about half a
 * second because the workers run it beside the others. Against the five-minute ceiling below
 * that is 1.4% of the budget — the ceiling is still sized for a cold CI runner, not for this.
 *
 * **Why the number went from five to six.** `tests/board-import.spec.ts` was added for P3-3, and
 * it meets the same admission criterion for the same kind of reason. The importer's body is built
 * by an `<input type="file">` and a `FormData` the *browser* encodes; the API suite composes its
 * own multipart bodies, so it cannot disagree with Chromium about the field name, the boundary or
 * the `Content-Type`. And the roadmap metric for that item is not "the endpoint answers a report"
 * but "the partial-failure report is shown to the user" — a claim about a screen, made about a
 * report that exists only in the body of one `201` (ADR 0025: no `ImportRun` table, no status
 * endpoint). An API test cannot fail on a panel that renders nothing, and a Vitest test cannot
 * fail on a report the browser never received.
 *
 * The scenario is also the only place the report's numbers are checked against the board they
 * describe: it ends on the board page counting the cards the server returns, so "4 tasks" on the
 * panel and four cards on the board have to be the same four.
 *
 * Measured the same way, on the same class of machine (Apple M3 Max, 14 cores, 36 GB, Node
 * 24.18), 8 consecutive runs each with the servers warm: the five at 4.2–5.1s (median 4.4s), the
 * six at 4.3–5.6s (median 4.75s) — about 0.3s of median. The sixth is the *fastest* single test
 * of the six at ~1.5s, because it drives one form and two page loads and does its setup over
 * HTTP. Against the five-minute ceiling the whole suite is now 1.6% of the budget.
 *
 * **Why the number went from six to seven.** `tests/mobile-navigation.spec.ts` was added for
 * P3-8, and it is the clearest case yet for the admission criterion — because what it measures
 * is not reachable from an in-process suite by construction, not merely inconvenient there.
 * Its subject is *layout at a width*: an off-canvas drawer below 768px, a 44px floor under
 * every touch target, and a document that no longer grows past the viewport (issue #184). jsdom
 * lays nothing out, so every `getBoundingClientRect` in a Vitest test is zeros and every one of
 * those assertions would pass whatever the CSS said — the exact vacuous-assertion failure
 * `docs/testing.md` names. The input is out of reach too: `hasTouch` and `isMobile` are context
 * options, so the touch drag it exercises cannot be driven from anywhere but a browser context
 * created with them.
 *
 * It is one file with four tests rather than four files, and it costs the suite about 1.4s of
 * median — measured the same way, 8 consecutive warm runs on the same machine: the six at
 * 4.6–5.2s (median 4.8s), the seven at 5.9–7.1s (median 6.15s). The slowest of the four is the
 * scroll-and-drag scenario at ~2.1s, which seeds 25 cards over HTTP and dispatches a real touch
 * sequence over CDP. Against the five-minute ceiling the whole suite is 2.1% of the budget.
 *
 * That margin is headroom for a cold CI runner and still not an argument for an eighth: the
 * paragraph at the top of this file is the admission test, and "there is time" has never been
 * it.
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
   * The budget is the reason this suite is seven scenarios and not forty: a nightly that takes
   * twenty minutes is a nightly people stop reading. Putting the ceiling here instead of in
   * the workflow's `timeout-minutes` means it also applies locally, so the run that first
   * exceeds it is the one on the author's machine. Measured on a laptop (Apple M3 Max, 14
   * cores, 36 GB, Node 24.18) the five took 4.0–4.5s over 24 runs, the six 4.3–5.6s over 8,
   * and the seven 5.9–7.1s over 8; the margin is for a cold CI runner, not for growth.
   *
   * Read that margin as headroom for the runner, not as room for an eighth scenario: the
   * paragraph at the top of this file is the admission test, and "there is time" has never
   * been it.
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
      // `/login` rather than `/`: `/` is a redirect from `proxy.ts`, and a redirect answering
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
