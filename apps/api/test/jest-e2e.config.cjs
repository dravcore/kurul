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
        },
      },
    ],
  },
  // Keep in sync with `apps/api/jest.config.cjs`: better-auth >=1.6 and its dependency
  // chain (better-call -> rou3, nanostores) are ESM-only and must go through ts-jest.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores)/)',
  ],
};
