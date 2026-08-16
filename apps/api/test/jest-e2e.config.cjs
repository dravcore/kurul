const path = require('node:path');

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'mjs', 'cjs'],
  rootDir: __dirname,
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  setupFiles: [path.join(__dirname, 'setup-e2e.ts')],
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
  // Keep in sync with `apps/api/jest.config.cjs`: better-auth >=1.6 and its dependency
  // chain (better-call -> rou3, nanostores) are ESM-only and must go through ts-jest, and so
  // are `file-type` and its chain (`@tokenizer/inflate`, `strtok3`, `token-types`,
  // `peek-readable`, `uint8array-extras`, `@borewit/text-codec`) — see the longer note in the
  // unit config, including why `@borewit` is on this list and why the `file-type`
  // `moduleNameMapper` both configs used to carry is gone as of v22.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores|file-type|@tokenizer|strtok3|token-types|peek-readable|uint8array-extras|@borewit|kysely)/)',
  ],
};
