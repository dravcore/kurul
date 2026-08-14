/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'mjs', 'cjs'],
  rootDir: 'src',
  // `test/helpers/*.ts` (e.g. `auth.ts`, used by every `*.e2e-spec.ts`) lives outside
  // `src` on purpose — it's test-only code, not part of the shipped API — but its slug/
  // email uniqueness logic (`buildUniqueSlug`, `uniqueEmail`, `uniqueSuffix`; see the
  // doc comment on `uniqueSuffix` for why it exists — #173) is worth covering with a
  // fast, DB-free unit test rather than only indirectly through e2e runs. Extending
  // `roots` (discovery only — `rootDir` above still governs module resolution/coverage)
  // lets `test/helpers/*.spec.ts` run under the ordinary `pnpm test` alongside `src`'s
  // unit tests, without pulling in the `*.e2e-spec.ts` files next to it (those don't
  // match `testRegex` below: it requires a literal `.spec.ts`, not `.e2e-spec.ts`).
  roots: ['<rootDir>', '<rootDir>/../test/helpers'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j|mj)sx?$': [
      require.resolve('ts-jest'),
      {
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          // ts-jest compiles each file on its own into the CommonJS module Jest executes.
          // `apps/api/tsconfig.json` now inherits NodeNext from the base config, which under
          // a CJS package resolves ESM-only dependencies through `require(esm)` — a thing
          // ts-jest's single-file output cannot express. Pinning the transform back to
          // classic CommonJS keeps the runtime honest; the type-level win of NodeNext is in
          // `pnpm typecheck` and `nest build`, which are unaffected by this override.
          module: 'CommonJS',
          moduleResolution: 'Node',
        },
      },
    ],
  },
  // better-auth >=1.6 is ESM-only, and so is the dependency chain it pulls in
  // (better-call -> rou3, nanostores). Jest runs CommonJS, so every one of these has to be
  // handed to ts-jest instead of being skipped as a plain `node_modules` require.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores)/)',
  ],
  collectCoverageFrom: ['**/*.(t|j)s', '!**/generated/**'],
  coveragePathIgnorePatterns: ['/generated/'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Floor set a few points below the measured baseline (2026-08-09, `pnpm --filter
  // @kurultay/api test:cov`: stmts 57.19 / branch 48.29 / funcs 59.68 / lines 58.12) so CI
  // fails on real regressions without being so tight that routine refactors trip it.
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 45,
      functions: 57,
      lines: 56,
    },
  },
};
