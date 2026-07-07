import { defineConfig } from 'tsup';

// The bundle (dist/design-lens.cjs) is a committed artifact. Config MUST be deterministic — no
// timestamps, no environment-dependent banners — so `npm run build` reproduces it byte-for-byte
// (spec 01-packaging, AC-11). `playwright`, `playwright-core` and the adblocker stay external so
// the CJS bundle stays small (< 2 MB); they resolve at run time via lib/runtime-deps.ts.
export default defineConfig({
  entry: { 'design-lens': 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  noExternal: [/.*/],
  external: ['playwright', 'playwright-core', '@ghostery/adblocker-playwright'],
  clean: false,
  splitting: false,
  sourcemap: false,
  minify: false,
  dts: false,
  shims: false,
  treeshake: true,
});
