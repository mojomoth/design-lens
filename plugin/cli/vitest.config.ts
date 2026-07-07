import { defineConfig } from 'vitest/config';

// Two named projects the sealed gate drives by name: `test` = `vitest run --project unit`,
// `e2e` = `vitest run --project e2e` (spec 08-testing). Unit tests are browser/server-free.
// The e2e project runs the BUILT bundle and stays empty until fixtures land (T11), so it must
// pass with no tests; `globalSetup` is intentionally omitted until then (M1 sequencing invariant).
export default defineConfig({
  test: {
    // Root-level (not valid per-project in this vitest): keep the e2e project green while it
    // holds no tests (until T11), and run test files serially so the e2e clone captures — which
    // launch Playwright and bind ports — never overlap.
    passWithNoTests: true,
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
