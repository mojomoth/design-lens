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

// cheerio's package entry is the "batteries-included" module: alongside `load` it exports
// `fromURL`/`loadBuffer`/`decodeStream`, dragging in undici (512 KB) and iconv-lite (491 KB) —
// a full HTTP client and every legacy text codec, for a CLI that only ever calls `cheerio.load`
// on strings it already holds. esbuild cannot tree-shake them away (undici has import-time side
// effects), so 1.0 MB of the 2 MB budget was dead weight. `dist/esm/load-parse.js` is the exact
// module the entry re-exports `load` from — same parse5 default, byte-identical semantics — so
// aliasing to it is a pure size win, not a behaviour change. Enforced by a unit test that fails
// if any src file starts using a second cheerio export.
const cheerioLoadParse = path.join(
  path.dirname(require.resolve('cheerio/package.json')),
  'dist/esm/load-parse.js',
);

// The bundle (dist/design-lens.cjs) is a committed artifact. Config MUST be deterministic — no
// timestamps, no environment-dependent banners — so `npm run build` reproduces it byte-for-byte
// (spec 01-packaging, AC-11). `playwright`, `playwright-core` and the adblocker stay external so
// the CJS bundle stays small; they resolve at run time via lib/runtime-deps.ts. `minify` is ON —
// esbuild minification is deterministic (no timestamps/env). Minification plus the two aliases
// below keep the bundled cheerio/css-tree/js-beautify/css-analyzer/culori tree under the hard
// < 2 MB repo-hygiene gate (AC-03/B2c).
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
    options.alias = { ...options.alias, 'css-tree': cssTreeCjs, cheerio: cheerioLoadParse };
  },
});
