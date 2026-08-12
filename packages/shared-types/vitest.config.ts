import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Nothing in this package touches a DOM — it is types plus a handful of shared values.
    environment: 'node',
    // Tests live in `test/` rather than beside the sources on purpose: `tsconfig.json` builds
    // `src/**` into `dist`, so a colocated `*.test.ts` would be compiled and published with
    // the package. Keeping them out also matches the repo's convention of leaving test files
    // out of the app tsconfigs (see `eslint.config.mjs`).
    include: ['test/**/*.test.ts'],
  },
});
