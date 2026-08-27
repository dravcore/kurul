import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(rootDir, '../../packages');

export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir,
      // The workspace packages resolve through `package.json` `exports` to a git-ignored
      // `dist/`, so without these two entries the suite needs a build first and, worse, keeps
      // passing against a stale one. Pointing them at `src/index.ts` makes Vitest compile the
      // same source `pnpm typecheck` reads. The sources' `.js`-suffixed relative imports
      // (`export * from './enums.js'`) need nothing extra: Vite already resolves them to the
      // `.ts` file. `workspace-packages.test.ts` asserts the alias holds.
      '@kurul/shared-types': path.join(packagesDir, 'shared-types/src/index.ts'),
      '@kurul/auth-access': path.join(packagesDir, 'auth-access/src/index.ts'),
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
      // `app/**` (2026-08-27, re-measured): stmts 100 / branch 100 / funcs 100 / lines 100
      // (79/79, 6/6, 34/34, 79/79). The route tests this series added left the folder fully
      // covered, so the floor moves up with it rather than staying 15 points behind.
      // `app/layout.tsx` counts here too: `next/font/google` is stubbed in its test rather
      // than the file being excluded, because an excluded file is an invisible one.
      //
      // Board / task / layout (2026-08-12, same `test:cov` run): board 70/59/59/75,
      // task 65/65/63/67, layout 80/71/90/84. These are the interactive surfaces that
      // already have meaningful unit coverage; a second glob floor catches deleting a
      // board/task/layout test without waiting for a global average to become meaningful.
      //
      // `components/notification/**` and `lib/**` (2026-08-15, QA-04): the bell's badge, the
      // dropdown's click-through and the page that lists the same rows were the last
      // interactive surface with no floor watching it, and `lib/notification-actions.ts` and
      // `lib/notification-nav.ts` — the two modules that decide where a clicked notification
      // takes you — were at 0% on every metric. Measured after the behaviour tests landed:
      // notification 96.35/88.79/100/98.83, lib 96.08/88.49/98.23/96.98.
      //
      // `lib/**` is floored as a folder rather than as those two files because it is already
      // the best-covered folder in the app (91.55% statements before this change): a floor
      // there is a ratchet on code that is genuinely tested, which is the only kind this file
      // sets. It also means a new helper landing in `lib/` with no test at all is visible,
      // which is the regression the notification helpers themselves were.
      //
      // `components/auth/**`, `components/settings/**` and `components/dashboard/**`
      // (2026-08-23, maintenance sweep): the three interactive surfaces still missing a floor.
      // All three already carry real coverage, so this is a ratchet, not a target to grow into:
      // measured with `pnpm --filter @kurul/web test:cov`, auth 99.31/96.04/100.00/99.31,
      // settings 89.85/90.91/85.23/90.76, dashboard 94.12/68.42/95.24/93.33 (stmts/branch/
      // funcs/lines). Dashboard's branch figure is the outlier, but it still sits well above
      // `components/board/**`'s 54 branch floor, the lowest in this file, so it gets the same
      // few-points-under margin as the rest rather than a round of new tests.
      //
      // `components/settings/**` (2026-08-27, P7 fix wave): re-measured at 92.75/88.27/91.67/
      // 94.40 after the panel and settings IA changes, well past the figures above, so the
      // floor moves up with it (branch stays at 86, a few points under the measured 88.27,
      // for the same margin the rest of this file keeps).
      thresholds: {
        'app/**': {
          statements: 97,
          branches: 97,
          functions: 97,
          lines: 97,
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
        'components/notification/**': {
          statements: 91,
          branches: 83,
          functions: 95,
          lines: 93,
        },
        'lib/**': {
          statements: 91,
          branches: 83,
          functions: 93,
          lines: 92,
        },
        'components/auth/**': {
          statements: 94,
          branches: 91,
          functions: 95,
          lines: 94,
        },
        'components/settings/**': {
          statements: 90,
          branches: 86,
          functions: 89,
          lines: 92,
        },
        'components/dashboard/**': {
          statements: 89,
          branches: 63,
          functions: 90,
          lines: 88,
        },
      },
    },
  },
});
