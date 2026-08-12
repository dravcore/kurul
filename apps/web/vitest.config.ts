import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: ['node_modules/**', '.next/**', '**/*.test.{ts,tsx}', '**/*.config.*'],
      // No `thresholds` gate here on purpose: overall coverage sits around 13% because
      // `app/**` route entrypoints and most page-level components have no unit tests yet
      // (they're better covered by e2e/integration tests, which don't exist in this repo
      // yet either). A global floor at today's ~13% wouldn't catch any real regression in
      // the units that *are* tested, and per-directory glob thresholds would be brittle
      // while `apps/web` is still being split/refactored (see tech-debt Wave 5/6). Revisit
      // once route-level tests exist or coverage is measured per meaningfully-tested folder.
      //
      // Route-level tests now exist, so `app/**` is exactly the "meaningfully-tested
      // folder" that comment was waiting for — and it is the one place a glob floor is not
      // brittle: routes are thin (await params, translate a title, compose components) and
      // a new page arriving with no test at all is the regression worth catching. The
      // global gate stays absent for the reason above; only this folder is floored.
      //
      // Floors sit a few points under the measured baseline (2026-08-12, `pnpm --filter
      // @kurultay/web test:cov`: stmts 90.93 / branch 100 / funcs 90 / lines 90.93), the
      // same margin `apps/api/jest.config.cjs` uses, so routine refactors do not trip it.
      // `app/layout.tsx` counts here too: `next/font/google` is stubbed in its test rather
      // than the file being excluded, because an excluded file is an invisible one.
      thresholds: {
        'app/**': {
          statements: 85,
          branches: 90,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
});
