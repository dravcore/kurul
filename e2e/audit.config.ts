import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The accessibility audit rig, deliberately *not* part of the smoke suite.
 *
 * A phase that changes colour tokens, focus handling or shell shape closes with an axe sweep
 * over the routes it touched, in both themes. That sweep used to be a script written from
 * scratch each time and thrown away afterwards, which left `@axe-core/playwright` in the
 * workspace with no caller and left the next phase re-deriving the sign-in and route wiring it
 * needs. This is that script, checked in, so the dependency has a live reader and the sweep is
 * reproducible rather than remembered.
 *
 * It sits behind its own config and its own command, the same way the measurement rig does:
 *
 *     pnpm --filter @kurul/e2e exec playwright test -c audit.config.ts
 *
 * Not in `tests/`, for the reason the smoke suite's own header gives: that suite is eight
 * scenarios sized to a five-minute ceiling, and its admission test is "a way the stack comes
 * apart that no in-process suite can see". An axe sweep is neither. It is evidence produced on
 * demand at the end of a UI phase, it loads twelve pages, and adding it to the nightly would
 * cost every run for a result nobody reads until a phase closes.
 *
 * It sits beside `playwright.config.ts` rather than inside `audit/` for a mechanical reason:
 * Playwright resolves a `webServer` command's working directory against the *config's*
 * directory, and a config one level down would look for `apps/api/dist` under `e2e/`.
 *
 * The stack, the environment and the ports are inherited from `./playwright.config.ts` by
 * spreading it, so the pages axe reads are the pages the smoke suite drives: the same built
 * artifacts, the same database, the same standalone web bundle. What is overridden is only
 * `workers: 1` (twelve page loads contending with each other prove nothing about the pages) and
 * the reporter.
 */
export default defineConfig({
  ...base,
  testDir: './audit',
  testMatch: '**/*.audit.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  globalTimeout: 20 * 60_000,
  reporter: [['list']],
  use: { ...base.use, trace: 'off', screenshot: 'off', video: 'off' },
});
