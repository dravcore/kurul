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
  // The two workspace packages resolve through their `package.json` `exports` to `dist/`,
  // which is git-ignored and only exists after a build. Tests must never depend on that: a
  // fresh checkout has no `dist`, and a stale one is worse, because it silently runs last
  // week's enums against this week's service. Both specifiers are pointed at the packages'
  // `src/index.ts` instead, so Jest compiles the same source `pnpm typecheck` reads.
  //
  // Those sources are NodeNext-style and import each other with a `.js` suffix
  // (`export * from './enums.js'`), which Jest's CommonJS resolver takes literally. The
  // second entry strips the suffix from every relative specifier and lets Jest pick the
  // extension from `moduleFileExtensions` instead. That is lossless for the files that were
  // already `.js` (`src/generated/prisma/index.js` does `require('./runtime/client.js')`;
  // `js` is first in the extension list, so the same file is found), and it is what makes
  // `./enums.js` reach `enums.ts`. `src/workspace-packages.spec.ts` asserts both mappings hold.
  // Keep in sync with `apps/api/test/jest-e2e.config.cjs`.
  moduleNameMapper: {
    '^@kurul/shared-types$': '<rootDir>/../../../packages/shared-types/src/index.ts',
    '^@kurul/auth-access$': '<rootDir>/../../../packages/auth-access/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
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
          // `moduleNameMapper` above tells Jest's resolver where `@kurul/*` lives; this tells
          // the TypeScript resolver the same thing, because ts-jest's type resolution follows
          // tsconfig, not the mapper. Today it changes nothing observable: `tsconfig.base.json`
          // sets `isolatedModules: true`, ts-jest 29 reads that as "transpile only", and a
          // transpile never looks a module up. Forcing `isolatedModules: false` in this block
          // with `dist` deleted is how the entry was proven: without it every spec importing a
          // shared type fails on TS2307, with it they pass. `paths` is resolved against the
          // directory of the tsconfig ts-jest finds (`apps/api`), so no `baseUrl` is needed.
          paths: {
            '@kurul/shared-types': ['../../packages/shared-types/src/index.ts'],
            '@kurul/auth-access': ['../../packages/auth-access/src/index.ts'],
          },
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
  //
  // `kysely` arrived the same way and is worth naming, because the version that brought it
  // was a *patch*: `better-auth@1.6.27` added it to its own chain, and two suites that had
  // nothing to do with the change stopped parsing. A dependency allowlist maintained by hand
  // does not break when we change something; it breaks when somebody else does.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores|file-type|@tokenizer|strtok3|token-types|peek-readable|uint8array-extras|@borewit|kysely)/)',
  ],
  // No `moduleNameMapper` for `file-type`, and the reason is worth keeping because it was
  // needed until this bump.
  //
  // `file-type@21`'s `exports` map offered `import` and `module-sync` and no `require`
  // condition at all, so Jest's CommonJS resolver — which asks for `require`/`default` —
  // answered `Cannot find module 'file-type'` even though the package was installed. The fix
  // was to map the specifier straight at the file that map would have chosen,
  // `file-type/node`.
  //
  // `file-type@22` collapsed the whole map to `{ types, default }`: the `./node` and `./core`
  // subpaths are gone, so the old mapping stopped resolving — and because it ran inside
  // `require.resolve` at config load, it took the entire suite down before a single test could
  // run, rather than failing the one file that imports the package. A `default` condition is
  // also exactly what the CJS resolver was missing, so Jest now finds the package on its own
  // and the mapping has nothing left to do. Deleted rather than repointed: an indirection that
  // no longer indirects is a thing the next reader has to disprove.
  //
  // `transformIgnorePatterns` above still lists `file-type` — the entry it resolves to is ESM
  // either way, and that has not changed.
  collectCoverageFrom: ['**/*.(t|j)s', '!**/generated/**'],
  coveragePathIgnorePatterns: ['/generated/'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Coverage floor. The two lasting rules (raise it when the baseline rises; record a drop
  // here instead of lowering the floor to erase it; never exclude a file from the
  // denominator) live in docs/testing.md's Coverage section, not here, per the repo's own
  // working-notes policy. Full measurement history is in git log for this file.
  //
  // Baselines are measured on `develop` after merge (`pnpm --filter @kurul/api test:cov`) or
  // read from CI's `api-coverage` artifact for that run, never on a feature branch.
  //
  //   2026-08-22  75.94 / 68.79 / 77.69 / 76.81  measured on the feat/demo-mode branch, not
  //                                              develop. The develop-after-merge figure for
  //                                              that PR (#299, 75120af) was
  //                                              75.82 / 68.70 / 77.80 / 76.70.
  //   2026-08-26  77.06 / 69.96 / 78.95 / 77.91  develop at 017838a. Margins 2.06 / 3.96 /
  //                                              1.95 / 1.91 over the floor below.
  //
  // Files over ~50 statements at 0% unit coverage, each an all-or-nothing operation covered
  // end to end instead:
  //   account-deletion.service.ts (133 stmts)  test/account-deletion.e2e-spec.ts
  //   demo/reset.ts (97 stmts)                 test/demo-reset.e2e-spec.ts
  //   task/task.controller.ts (64 stmts)       test/task.e2e-spec.ts
  //
  // `./src/account/` floors at 0 across every metric: account-deletion.service.ts above is
  // the whole reason, and its unit coverage is deliberately 0, not a regression.
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 66,
      functions: 77,
      lines: 76,
    },
    './src/common/guards/': { statements: 100, branches: 93.75, functions: 100, lines: 100 },
    './src/common/rate-limit/': {
      statements: 98.33,
      branches: 94.87,
      functions: 91.3,
      lines: 99.09,
    },
    './src/account/': { statements: 0, branches: 0, functions: 0, lines: 0 },
  },
};
