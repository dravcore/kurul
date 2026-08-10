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
    },
  },
});
