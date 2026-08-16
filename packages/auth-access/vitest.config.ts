import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No DOM here — this package is Better Auth role definitions and nothing else.
    environment: 'node',
    // Tests live in `test/` rather than beside the sources: `tsconfig.json` builds `src/**`
    // into `dist`, so a colocated `*.test.ts` would be compiled and published with the
    // package. Same arrangement as `packages/shared-types`.
    include: ['test/**/*.test.ts'],
  },
});
