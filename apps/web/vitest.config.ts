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
      // No *global* `thresholds` gate here, still on purpose — but not for the reason this
      // comment used to give. Overall coverage is no longer ~13%; it is around 46%, and the
      // `app/**` floor below is the glob threshold the old note said it was waiting for.
      // What keeps a global floor off is that the number is still an average over two very
      // different populations: units with real tests sit well above it, and page-level
      // components with none sit near zero. A floor at the average would ratchet on the
      // second group's absence rather than on any regression in the first.
      //
      // Route-level tests now exist, so `app/**` is exactly the "meaningfully-tested
      // folder" that comment was waiting for — and it is the one place a glob floor is not
      // brittle: routes are thin (await params, translate a title, compose components) and
      // a new page arriving with no test at all is the regression worth catching. The
      // global gate stays absent for the reason above; only this folder is floored.
      //
      // Floors sit a few points under the measured baseline, the same margin
      // `apps/api/jest.config.cjs` uses, so routine refactors do not trip them.
      //
      // `app/**` (2026-08-12): stmts 90.93 / branch 100 / funcs 90 / lines 90.93.
      // `app/layout.tsx` counts here too: `next/font/google` is stubbed in its test rather
      // than the file being excluded, because an excluded file is an invisible one.
      //
      // Board / task / layout (2026-08-12, same `test:cov` run): board 70/59/59/75,
      // task 65/65/63/67, layout 80/71/90/84. These are the interactive surfaces that
      // already have meaningful unit coverage; a second glob floor catches deleting a
      // board/task/layout test without waiting for a global average to become meaningful.
      thresholds: {
        'app/**': {
          statements: 85,
          branches: 90,
          functions: 85,
          lines: 85,
        },
        'components/board/**': {
          statements: 65,
          branches: 54,
          functions: 54,
          lines: 70,
        },
        'components/task/**': {
          statements: 60,
          branches: 60,
          functions: 58,
          lines: 62,
        },
        'components/layout/**': {
          statements: 75,
          branches: 65,
          functions: 85,
          lines: 78,
        },
      },
    },
  },
});
