import { createRequire } from 'node:module';
import path from 'node:path';

import { defineConfig } from 'tsup';

// css-tree's ESM build (`lib/data-patch.js`) loads its 46 KB syntax patch via a CommonJS
// `require('../data/patch.json')` from inside an ES module. esbuild will NOT inline a `require`
// that appears in ESM (in real ESM `require` is foreign), so it leaves a runtime `__require` whose
// relative path resolves next to the OUTPUT bundle and crashes on load ("Cannot find module
// '../data/patch.json'"). Aliasing css-tree to its all-CJS entry makes every `require('*.json')`
// a plain CJS require that esbuild bundles inline — the single-file bundle then carries the data.
const require = createRequire(import.meta.url);
const cssTreeCjs = path.join(path.dirname(require.resolve('css-tree/package.json')), 'cjs/index.cjs');

// The bundle (dist/design-lens.cjs) is a committed artifact. Config MUST be deterministic — no
// timestamps, no environment-dependent banners — so `npm run build` reproduces it byte-for-byte
// (spec 01-packaging, AC-11). `playwright`, `playwright-core` and the adblocker stay external so
// the CJS bundle stays small; they resolve at run time via lib/runtime-deps.ts. `minify` is ON —
// esbuild minification is deterministic (no timestamps/env), and it is what keeps the bundled
// cheerio/css-tree/js-beautify tree under the hard < 2 MB repo-hygiene gate (AC-03/B2c).
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
  minify: true,
  dts: false,
  shims: false,
  treeshake: true,
  esbuildOptions(options) {
    options.alias = { ...options.alias, 'css-tree': cssTreeCjs };
  },
});
