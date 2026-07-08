# PROGRESS.md — iteration learnings (append-only log; newest at the bottom)

Rules: ≤ 10 lines per entry, never edit old entries. Durable reusable patterns get PROMOTED into
the pinned section below (that section may be edited in place).

## Codebase patterns (pinned — keep short, current, and true)

- (none yet)

## Log

- 2026-07-06 · harness scaffolding created; no build iterations have run yet.
- 2026-07-08 · T01 done: scaffolded plugin/cli (tsc strict, eslint flat, tsup, vitest) + lib/slug.
  Traps: vitest 3.2 `passWithNoTests`/`fileParallelism` are ROOT-only, NOT per-project (put them
  under `test:`, not inside a `projects[].test`). `new URL()` percent-encodes spaces in path
  segments, so a space in a slug fixture becomes `-20-`; use dash-safe URLs in slug tests.
  Kept deps to devDeps only (runtime deps land per-task per the plan); avoided `@eslint/js`
  (not allowlisted) by exporting a plain flat-config array with `tseslint.configs.recommended`.
- 2026-07-08 · T02 done: commander program factory `src/cli.ts` (pure, no parse/exit) + `src/version.ts`
  (`VERSION='0.1.0'`, single source of truth) + `src/index.ts` entry. Trap: commander LATEST (v14/v15)
  requires node>=22 (EBADENGINE on our node 20) — pin `commander@^12` (engines >=18). Test drives it
  in-process via `exitOverride()`+`configureOutput()`; `--version` throws CommanderError{exitCode:0}
  after writing. Did NOT `npm run build` (would create dist/ → flips B10 red pre-T11 per M1 invariant).
- 2026-07-08 · T03 done: `lib/static-server.ts`. Split into a PURE `resolveRequest(root,target,exists)`
  + `contentTypeFor()` (unit-tested, binds NO port — spec 08 forbids listening servers in unit
  tests) and the `startStaticServer()` node:http wrapper (for T21 serve + e2e global-setup, 127.0.0.1
  only). Traversal guard uses `path.relative(root, resolved)` and fires 403 BEFORE `exists`; test uses
  allExist=()=>true so a 403 proves the guard, not a missing file. Real server injects an isFile()
  predicate → directories become 404, not read errors. Did NOT build dist (M1 invariant: B10 stays SKIP).
- 2026-07-08 · T04 done: authored own fixture sites basic/spa/banner (test/fixtures/sites/). No tests
  (AC is grep markers; consumers land T11 globalSetup). Traps: B3 placeholder scan only hits src/,
  plugin/scripts, plugin/skills — NOT test/fixtures, so a decoy tracker.js is safe. Binaries must be
  <5KB: a solid-color PNG's zlib size scales with W×H (2400×1200 → ~11KB), so hero pair sized down to
  600×300 / 1200×600. No fontTools available → brand.woff2 is a real wOF2-signed container (Node brotli),
  fetched-as-bytes only (no test parses it as a font). #3347ff appears 14× across basic CSS (≥10 gate).- 2026-07-08 · T05 done: `lib/runtime-deps.ts` `loadRuntimeDep<T>(name)` — two-tier `createRequire`
  (repo node_modules / launcher NODE_PATH, then `~/.design-lens/runtime/node_modules` fallback);
  honors DESIGN_LENS_HOME like bootstrap. Missing-dep throws a named, bootstrap-pointing Error with
  `{cause}` (CONVENTIONS: no silent swallow). Added `playwright@1.61.1` EXACT dep (allowlisted,
  external in tsup) so the test resolves the real module object. Trap: `npm install playwright`
  triggers a browser-download postinstall — set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (guardrail:
  never download browsers; bootstrap already provisioned Chromium). Did NOT build dist (M1 invariant).
- 2026-07-08 · T06 done: `localize/urlmap.ts` `localPathFor(url,contentType?)` (module was left
  untracked by a prior iteration — reviewed, confirmed spec-compliant, added 38 unit tests). Spec
  §urlmap returns `assets/<host>/…` (NOT `clone/assets/…` — the plan text is shorthand; the manifest
  prefixes `clone/` per ADR-010). Traps: percent-decode segments BEFORE resolving `.`/`..` so
  `%2e%2e` traversal collapses; overlong collapse (91+`-`+8hex=100) hashes the CLEANED segment and
  strips a real extension if it's the last segment, so test overlong via a DIRECTORY segment. URL
  parser drops default ports + lowercases host for free; `?` with empty query yields search=''.
