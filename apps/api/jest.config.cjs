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
  //
  // `file-type` v21 is ESM-only for the same reason and reaches us through
  // `attachment-mime.ts`'s `await import('file-type')`. Its own chain is listed too:
  // `@tokenizer/inflate`, `strtok3`, `token-types`, `uint8array-extras`, plus `peek-readable`
  // underneath `strtok3` and `@borewit/text-codec` underneath `token-types`.
  // `@tokenizer/inflate` in particular is not optional — it carries the OOXML sniffing that
  // gives a `.docx`/`.xlsx`/`.pptx` its own media type, so leaving it out makes office uploads
  // fail as a 415 that reads like a wrong MIME rule rather than a transform gap. `@borewit` is
  // on this list because the suite named it, not because the chain was guessed: the run that
  // followed adding the rest failed with `Unexpected token 'export'` in
  // `@borewit/text-codec/lib/index.js`. Extend the list the same way — run it, read the package
  // the error names, add that one. Keep in sync with `apps/api/test/jest-e2e.config.cjs`.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores|file-type|@tokenizer|strtok3|token-types|peek-readable|uint8array-extras|@borewit)/)',
  ],
  // `file-type@21`'s `exports` map offers `import` and `module-sync` and no `require`
  // condition at all, so Jest's CommonJS resolver — which asks for `require`/`default` —
  // answers `Cannot find module 'file-type'` even though the package is installed and
  // `transformIgnorePatterns` above is ready to transform it. Pointing the specifier at the
  // file that map would have chosen is the narrow fix.
  //
  // The broad fix, `testEnvironmentOptions.customExportConditions: ['node', 'import']`, was
  // tried first and rejected on measurement: it flips *every* dual-published dependency to its
  // ESM entry, and the suite immediately failed on `synckit`'s untransformed `import` — a
  // package nothing in this API imports on purpose. One mapped specifier changes one package.
  moduleNameMapper: {
    '^file-type$': require.resolve('file-type/node'),
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/generated/**'],
  coveragePathIgnorePatterns: ['/generated/'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Floor set a few points below the measured baseline (2026-08-14, `pnpm --filter
  // @kurultay/api test:cov`: stmts 77.86 / branch 69.31 / funcs 79.64 / lines 79.24 — raised
  // from the 2026-08-09 baseline of 57.19/48.29/59.68/58.12 after closing the workspace/
  // activity/label/common-pipes-and-decorators cold zones tracked as audit finding QA-03) so
  // CI fails on real regressions without being so tight that routine refactors trip it. Raise
  // this again the same way once the next baseline moves: measure, then set floor a few points
  // under the new number rather than under the old one.
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 66,
      functions: 77,
      lines: 76,
    },
  },
};
