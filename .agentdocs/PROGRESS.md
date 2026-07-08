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
- 2026-07-08 · T07 done: `localize/css-rewrite.ts` `rewriteCss(css, baseUrl, resolve)` — css-tree
  v3 walk of Url + @import atrule preludes; returns rewritten css + refs[]{url,kind,localPath}.
  Kept PURE via a `resolve(absUrl,kind)=>string|null` callback (null=stay remote); relativization +
  ResourceStore availability belong to T11's resolver, not here. Traps: css-tree v3 `Url`/`String`
  nodes are `{type,value:string}` (flat, no nested Raw); set `node.value` then `generate()` RE-ESCAPES
  special chars — so `new URL('foo\\ bar')` percent-encodes the space to %20 (that's the browser-true
  ref), while a resolver returning a literal-space path is what exercises generate's `\ `/`\(` escaping.
  Handle @import String AND url() forms; `return this.skip` on the Atrule so its inner Url isn't
  double-counted. Left untouched w/o calling resolver: `data:` and `url(#fragment)` (SVG paint refs).
  Added css-tree@^3 + @types/css-tree (allowlisted). Did NOT build dist (M1 invariant: B10 stays SKIP).
- 2026-07-08 · T08 done: `localize/srcset.ts` — WHATWG "parse a srcset attribute" algo (parseSrcset)
  + stringifySrcset + rewriteSrcset (resolver DI, mirrors css-rewrite). The point of the module:
  collect the URL as a NON-whitespace run so commas INSIDE a url (data: URI, CDN `w_100,h_50` paths)
  stay put — kage's bare comma-split mangles these (research/kage-clone.md §4). Descriptor read after
  ws up to next TOP-LEVEL comma (paren-tracked), preserved verbatim; a url ending in comma(s) is
  descriptorless (commas stripped). data: candidates never resolved (already inline). 17 unit tests
  (w/x, descriptorless, comma-in-url data-URI+CDN, whitespace/newline variants, round-trip, resolver
  null=stay-remote). rewriteSrcset is T14's substitution primitive. Did NOT build dist (M1 invariant).
- 2026-07-08 · T09 done: `localize/html-rewrite.ts` `sanitizeHtml(html)` — cheerio inert pass
  (kage §2 list): strip `<script>`, `<noscript>`, `on*` attrs, `javascript:` URLs (href→`#`, else
  drop), `<meta http-equiv=refresh>`, dead hints (preconnect/dns-prefetch/modulepreload, and
  preload/prefetch only when `as=script`), IE conditional comments, ensure `<meta charset>`. 16
  unit tests (pos+neg per rule). Traps: cheerio `$('*')` widens to AnyNode (unlike `$('meta')`) →
  guard `'attribs' in el` before touching attribs; IE `<!--[if IE]><script>…<![endif]-->` is ONE
  comment node with the script INSIDE its `.data`, so element removal misses it — must strip the
  comment (walk `$('*').contents()`, narrow `node.type==='comment'`). `javascript:` detection
  strips tab/nl/cr/ff anywhere + leading ws before the prefix check (browser-true). Provenance
  comment prepend is T11/writer's job (needs sourceUrl/capturedAt), NOT this pure pass. Added
  cheerio@^1.2.0 (allowlisted). Did NOT build dist (M1 invariant: B10 stays SKIP).
- 2026-07-08 · T10 done: `output/manifest.ts` (buildManifest/resourceEntry/manifestJson) + `output/report.ts`
  (buildReport), both PURE. Traps: manifest owns the `clone/` prefix (urlmap emits `assets/…` into
  HTML; manifest localPath must be `clone/assets/…` because gate A7 joins from PROJECT dir, ADR-010)
  — resourceEntry takes the urlmap `assets/…` string and prefixes it; buildManifest re-asserts the
  invariant as defence-in-depth. tool.version locked to VERSION (not caller-overridable, AC-10).
  resourceEntry hashes the PASSED bytes (bytes/sha256 describe the stored file, not a caller digest).
  report: six `##` headings + license paragraph are VERBATIM (spec §template); parenthesised hints
  are content not literal text, so I render a real capture table / remote list / fidelity counters.
  manifestJson = 2-space JSON + trailing newline (keeps committed-dist diff clean). 18 unit tests
  (139 total). Did NOT build dist (M1 invariant: B10 stays SKIP until T11 wires the pipeline).
- 2026-07-08 · T11 done: `commands/clone.ts` orchestrates the M1 spine (launch→settle→robots→stamp→
  serialize→sanitize→localize→beautify→write) + `registerCloneCommand`; browser closed in `finally`
  so a fatal goto still exits (unreachable-URL→exit 1). dist BUILT & committed. Traps: (1) tsup bundle
  was 2.70 MB > B2c's 2 MB gate → enabled `minify:true` (deterministic) → 1.6 MB, but that surfaced
  (2) css-tree's ESM `lib/data-patch.js` does a CJS `require('../data/patch.json')` esbuild leaves as
  runtime `__require` → bundle crashed on load; fix = alias `css-tree`→its all-CJS entry so the JSON
  inlines (2.05 MB, ~50 KB under the gate — watch this in T12's percy embed). (3) SPEC-DRIFT ADR-011:
  sealed A4 forbids `127.0.0.1` in clone/, but urlmap host `127.0.0.1-4630`, the provenance sourceUrl,
  and the CORS-blocked (`net::ERR_FAILED`) alt-port webfont all violated it. Fixes: slug urlmap host
  (dots→`-`, updated T06 tests), drop sourceUrl from provenance (now in manifest/REPORT), launch
  Chromium `--disable-web-security`+`bypassCSP` so the cross-origin font is captured at render (A15).
  e2e hooks need `hookTimeout` (real Chromium > 10 s default). All 153 tests + `--m1` green.
- 2026-07-08 · T12 done: @percy/dom is now the primary serializer; own CSSOM walk kept as auto-
  fallback on percy throw/empty (only both failing is fatal). Bundle embedded gzip+base64 in
  generated `capture/percy-dom-src.ts` (`node scripts/gen-percy-src.mjs`) — raw 105 KB blows B2c's
  2 MiB gate; gzip→36 KB, dist now 2.084 MB (~13 KB headroom — watch future embeds). TRAP: percy
  output is NOT standalone — hides src/href behind `data-percy-serialized-attribute-*`, externalizes
  canvas PNG + adopted/blob sheets to `render.percy.local` resources[], litters `data-percy-*`. New
  PURE `capture/percy-restore.ts` (cheerio, 9 cases) reifies stand-ins, inlines canvas as `data:` img
  + adopted sheets as `<style>` from resources[], strips markers — without inlining the spa
  `rgb(1,2,3)` rule (only in the soon-stripped page `<script>`) vanishes. TRAPS: B3 greps src for
  literal "placeholder" (say "stand-in"); cheerio parks `<template>` content in a fragment
  `$('template span')` can't cross (assert on html); `.text()` on `<style>` is rawtext so CSS `>`
  survives; input needs no restore. All 163 tests + `--m1` + full gate green.
- 2026-07-08 · T13 done: lazy-load scroll sweep in `capture/settle.ts` (`lazyLoadSweep` + pure
  `scrollStepPx`), wired into clone.ts after settle behind `--no-scroll` (commander `--no-X` → `options.scroll`).
  Sweep scrolls `viewportHeight*0.8`/150ms to bottom dispatching synthetic `scroll` events (window-listener
  lazy-loaders too), re-races capped networkidle, scrolls to top, settles, repeats ONCE if body grew.
  TRAPS: (1) sweep is OPTIONAL — a throw becomes a warning (degradation ladder), must not block clone;
  (2) MUST `drainResponses()` after the sweep so newly-requested lazy images land in the store before
  localize; (3) e2e regex needs `\bsrc="(assets/...lazy...)"` — the img still carries `data-src="img/lazy.png"`
  (word boundary before `src` in `data-src`), but only the REAL src is localized to `assets/`, so anchoring
  the group on `assets/` disambiguates. 6 new tests (169 total). dist rebuilt (1.99 MB) & committed. Full gate green.
- 2026-07-08 · T14 done: new `localize/fetch-missing.ts` = PURE `collectSrcsetUrls` (cheerio + the
  WHATWG srcset parser, deduped/hash-stripped, http(s) only) + `fetchMissing` (narrow `RefetchClient`
  seam ⇒ unit-testable without a browser; Playwright's `context.request` satisfies it structurally).
  Wired into clone.ts as an OPTIONAL stage after the final `drainResponses()`, still inside the
  browser `try` — it is the last stage needing a browser. Provenance now flows: `StoredResource.via`
  is REQUIRED (browser.ts records `network`, fetchMissing records `refetch`) and localize.ts reads
  `stored.via` instead of hardcoding `'network'` — the store is the only thing that knows.
  TRAPS: (1) record under the REQUESTED url, not `response.url()` — a redirect would orphan the
  reference localize looks up. (2) Failures are NOT recorded as remote here: an unfetched url stays
  absent from the store, so localize's existing miss path records `fetch-failed` — one code path.
  (3) own `basic` fixture uses DENSITY descriptors (`1x/2x`, no `sizes`) so at `--dsf 1` Chromium
  never requests `hero@2x.png` → it can only exist via refetch (that is what makes the AC honest);
  the sealed fixture uses `w`+`sizes`, a different selection path — both now pass. (4) urlmap maps
  `hero@2x.png` → `hero_2x.png` (`@` ∉ `[A-Za-z0-9._-]`), so e2e must match on manifest `originalUrl`,
  never on the on-disk name. 15 new tests (184 total). dist rebuilt: 1.990 MiB — only ~10 KB under
  B2c's 2 MiB gate, so any future in-bundle embed needs the gzip+base64 trick T12 used.
  Sealed `--all` now: A1–A15 PASS incl. A14; A16/A17/A18 remain (T15/T17/T18).
- 2026-07-08 · T15 done: `capture/consent.ts` + `capture/consent-rules.ts`; dep `@ghostery/adblocker-playwright@2.18.1`
  (exact, external — bundle still 1.99 MB). Flags `--no-block-cookies`, `--filter-list <file>` added.
  SPEC DRIFT → ADR-012 (+ minimal `specs/02` edit, same commit): fanboy-cookiemonster has NO generic
  rule for `.cookie-banner`/`#consent` — only domain-scoped (`ft.com###consent`, `sellme.ee##.cookie-banner`)
  and compound (`#consent.alert`) — so spec-02's default could never satisfy sealed A16 (proved: ran
  `--all` with the live list ⇒ FAIL A16). Fix: ship 22 GENERIC built-in consent rules, prepended to the
  remote list; download failure now degrades to built-ins (`enabled`), not `unavailable`. A16 now PASSES.
  TRAPS: (1) `enableBlockingInPage` APPLIES cosmetics via `frame.addStyleTag()` — a 100s-of-KB
  `display:none` blob that percy would serialize into `clone/index.html`, and hiding ≠ removing. Both
  `this.injectStylesIntoFrame`/`injectScriptletsIntoFrame` dispatch through the instance, so override them:
  collect selectors → hand to `stampDom` (removes) → drop scriptlets (clone is inert). (2) `--filter-list`
  must REPLACE built-ins, else its e2e proves nothing; every banner e2e is now PAIRED with a survives-case.
  (3) consent is ON by default ⇒ e2e would hit the live web; every `runCli` now gets a tmp `DESIGN_LENS_HOME`
  with a pre-seeded no-match cache (`lib/home.ts` consolidates the home lookup shared with runtime-deps).
  (4) mtime of a just-written cache file can be a few ms in the FUTURE — a strict `age>=0` freshness test
  re-downloads every run; tolerate 60 s skew. (5) `##.cookie-banner` etc. need DOM hints (ids/classes) to
  surface from `getCosmeticsFilters`; with no hints you get `""`. A2 dropped 53→50 (banner subtree gone).
  Sealed `--all`: A1–A16 PASS; A17/A18 remain (T17/T18). Added T30 — spec-02 lists `--max-asset-mb` /
  `--include-media` but no task owned them. 215 tests. Full gate green.
- 2026-07-08 · T16 done: `collectCssUrls(html, pageUrl, store)` in `localize/fetch-missing.ts` (pure) +
  `FetchMissingOptions.via` (`RefetchVia = 'refetch'|'css-fetch'`, default `refetch`). clone.ts now runs
  TWO refetch stages: (a) srcset ⇒ `refetch`, (b) a CSS fixpoint loop ⇒ `css-fetch`. `css-fetch` was a
  manifest value the schema allowed but nothing emitted — now it has exactly one producer.
  KEY INSIGHT (what makes the AC honest): browsers load fonts LAZILY. A `@font-face` no element renders
  in is never requested, so its woff2 is absent from the store AND unnamed by any DOM attribute — it
  exists only in stylesheet text. That, not CORS, is why a CSS-discovered font needs refetching:
  cross-origin capture already works at render (ADR-011 `--disable-web-security` + `bypassCSP`, sealed
  A15). New fixtures `sites/cdn/` (2 faces: one used ⇒ `network`, one unused ⇒ `css-fetch`) + `sites/xorigin/`.
  TRAPS: (1) CSS refs resolve against the SHEET's url, not the page's — a page-relative resolve sends the
  CDN font request to the wrong origin. (2) The collect must LOOP: an uncaptured `@import` yields no refs
  until its own bytes land, so round N+1 re-collects; an `attempted` set keeps it strictly monotone (a
  permanently-dead font must not be retried every round) and `MAX_CSS_IMPORT_DEPTH=8` bounds both the
  in-call recursion and the round count. (3) A `<link rel=stylesheet>` missing from the store is NOT
  offered: it was discovered in HTML, so stamping it `css-fetch` would be a lie — it stays `fetch-failed`.
  (4) Ephemeral CDN port can't be committed into fixture CSS ⇒ `__CDN_ORIGIN__` placeholder, substituted
  into a tmp copy by the e2e. Consolidated the duplicated isCss/isFont/isImage trios (localize.ts +
  clone.ts) into `localize/media-type.ts` — fetch-missing needed the same predicate to decide what to
  descend into. 18 new tests (233 total). dist rebuilt (1.99 MB). Gate green; sealed `--all`: A1–A16 PASS,
  A17/A18 remain (T17/T18).
- 2026-07-08 · T17 done: `analyze/tokens.ts` (pure) + `analyze/css-sources.ts` (which CSS counts) + `commands/tokens.ts`;
  deps `@projectwallace/css-analyzer@^9.9.0`, `culori@^4.0.2`, `@types/culori`. 273 tests (ratchet 233). Gate green;
  sealed `--all`: A1–A17 PASS, only A18 (T18 `inspect`) remains.
  BLOCKER FIRST: bundle was 2,091,784 B vs B2c's 2,097,152 B ceiling; the deps add ~107 KB minified. `import * as
  cheerio from 'cheerio'` pulls the batteries-included entry, so `fromURL`/`loadBuffer` drag in undici (512 KB) +
  iconv-lite (491 KB), unshakeable (import-time side effects). We only call `cheerio.load` ⇒ tsup aliases `cheerio` →
  `dist/esm/load-parse.js` (the module the entry re-exports `load` from; byte-identical to the browser build).
  1,208,545 B now. Guarded by `test/unit/bundle-aliases.test.ts` — a stray `cheerio.loadBuffer` breaks only the BUNDLE.
  SPEC DRIFT → ADR-013 (+ minimal `specs/05` edit, same commit): spec-05 promised `faces[]` = clone-relative `assets/…`,
  but spec-02/03 localize a CSS ref relative to ITS OWN sheet (proved: `src: url(fonts/brand.woff2)`), and `assets/…` is
  uncomputable under spec-05's own single-concatenated-`analyze()` rule. Kept "exactly as written".
  TRAPS: (1) the analyzer exposes NO selector context for font-family and no font-weight/spacing VALUES — a second
  css-tree walk owns those (`this.rule`/`this.atrule`). (2) culori PARSES `transparent` → `#000000`: one
  `color:transparent` invents a black brand color unless dropped by keyword. (3) `font-family` in `@font-face` NAMES the
  face, it is not a usage — counting it makes every unused webfont (what T16 captures!) look like a design choice.
  (4) e2e counts come from the CLONE, not the fixture: @percy/dom materializes `:hover`/`:focus` into an inline `<style>`
  as `rgb(51, 71, 255)`, so basic's brand color is used 14× (7+5+2), and hex/rgb() must merge into ONE cluster.
  (5) clusters sort by LIGHTNESS desc, not count — `colors[0]` is white; the dominant color is not first.
- 2026-07-08 · T18 done: `analyze/heuristics.ts` (role table, thresholds, PURE) + `analyze/inspect.ts`
  (`probeElements` runs in-page; `classify` decides in Node) + `commands/inspect.ts` (serve→render→probe→stdout).
  330 tests (ratchet 273). Gate green; sealed `--all`: **A1–A18 ALL PASS** — full fixture parity (T19's AC).
  DESIGN SEAM: measure in the page, judge in Node. Roles depend on culori deltaE + cross-element ranking, so
  deciding in-page would drag culori into `page.evaluate` AND make every rule untestable without Chromium.
  TRAPS: (1) alpha-0 AGAIN — `rgba(0,0,0,0)` is the DEFAULT `<a>`/`<button>` background and culori reads it as
  BLACK (deltaE≈1.0 from white), so the fallback-CTA rule tags every short link unless alpha-0 is dropped.
  (2) `getComputedStyle().backgroundImage` is ABSOLUTE and embeds inspect's EPHEMERAL port ⇒ `relativizeUrl`
  strips the served origin, else stdout differs every run. (3) `hero-image` resolves to the hero SECTION, not the
  `<img>`: spec ranks img ∪ background-image by rect AREA, and the 1440×834 band beats the 960×480 img. Correct,
  surprising. (4) `hero-heading` runs BEFORE `cta`; with no `<h1>` its largest-text fallback legitimately eats the
  first text-bearing `<a>` — synthetic CTA unit fixtures need an h1 or they test nothing. (5) SVG has no
  `innerText` (the sealed logo is `a.logo > svg`) ⇒ textContent fallback. (6) `probeElements` crosses into the page
  as minified source: it must close over NOTHING — `SELECTORS` is passed as an arg, like `capture/stamp.ts`.
  (7) sealed A18 greps `"role":"logo"` (no space) ⇒ default output stays COMPACT single-line; `--pretty` opts out.
  NOT duplicated: exported `PlaywrightModule` from `capture/browser.ts` instead of re-declaring it — but did NOT
  reuse `launchCapture`, whose ResourceStore reads every response body inspect would throw away.
  `.agentdocs/ARCHITECTURE.md` is a B1-protected doc, so no new `capture/probe.ts`: stayed inside its module map.
- 2026-07-08 · T19 done: NO new code — a pure verification checkpoint. `bash .harness/e2e-assert.sh --all`
  exits 0 (A1–A18 PASS); full gate B0–B10 green, 330 tests, ratchet holds at 330. Parity was already
  reached by T17 (A17 tokens) + T18 (A18 inspect); T19's only job was to confirm it independently rather
  than trust the prior iteration's PROGRESS note. Ran the sealed script myself before ticking.
  TRAP for the next iteration: `verify.sh` (default mode) does NOT run `--all` — it only runs B10
  (`--m1`). The `--all` assertions live in S2, which fires only under `--strict`. So a regression in
  A10–A18 (percy serializer, srcset refetch, consent blocking, tokens, inspect) will stay INVISIBLE to
  the default gate you run constantly. T20/T21 touch the clone-end pipeline and the clone's structure —
  run `bash .harness/e2e-assert.sh --all` (or `--strict`) explicitly before committing, not just `verify.sh`.
  Remaining: T20 screenshot, T21 serve/verify, then M4 (skills/packaging) and M5 (ethics/docs/flags).
- 2026-07-08 · T20 done: `capture/browser.ts` + `capturePng`/`renderScreenshot`/`renderScreenshotOfDir` (BARE browser, not
  `launchCapture` — its ResourceStore would buffer every response body for pixels we discard); `commands/screenshot.ts`
  (pure `resolveTarget`/`resolveScreenshotFlags`/`defaultOutFile` + I/O); clone auto-emits the three PNGs. 348 tests
  (ratchet 330). Gate green; `--all` still A1–A18 PASS. SPLIT `output/writer.ts` into `writeCloneTree`+`writePng`+
  `writeProjectDocs` (was one untested `writeClone`): `clone-full.png` photographs the WRITTEN clone ⇒ tree lands first,
  and the re-render can add a warning that `manifest.json`/`REPORT.md` embed as `stats.warnings` ⇒ docs render LAST.
  TRAPS: (1) `lazyLoadSweep` leaves the page scrolled (it rewinds, settle.ts:138) — a viewport shot on a scrolled page
  frames the FOOTER and still passes every "is it a PNG" check ⇒ `capturePng` always `scrollTo(0,0)`; verify by EYE.
  (2) shots run AFTER refetch + one more `drainResponses()`: a full-page shot expands the viewport, triggering lazy
  loads that would race the `store.has()` missing-checks or land after browser close. (3) `document.fonts.ready` is
  load-bearing — a shot right after `load` records FALLBACK font metrics, a silent lie; bounded in-page by
  `Promise.race` so a dead CDN costs 5s. (4) `lib: ["ES2022"]`, no DOM ⇒ `document.fonts` needs `/// <reference
  lib="dom" />` (settle.ts escapes it only because playwright's types pull DOM in). (5) `--url` must reject non-http(s)
  or `file:///etc/passwd` gets painted into a PNG. MANUAL-RUN TRAP: an ad-hoc `clone` outside vitest downloads the
  consent list from the LIVE web unless `DESIGN_LENS_HOME` has a seeded `cache/filterlists/fanboy-cookiemonster.txt`.
  Remaining: T21 serve/verify, then M4 (skills/packaging) and M5 (ethics/docs/flags).
- 2026-07-08 · T21 done: `commands/verify.ts` (PURE `verifyClone` + `runVerify` shell + `summarizeVerify`) and
  `commands/serve.ts` (pure `parsePort` + blocking server). 9 checks, not spec-03's 6: its two compound sentences
  split — a refinement, not drift. Clone runs verify at its end (spec 02 §M3); REPORT `## Verify` is now real.
  401 tests (ratchet 348); B0–B10 + `--all` A1–A18 green; also drove clone+verify on `spa` by hand (9/9 PASS).
  TRAPS: (1) cheerio root-anchored `$('[data-dl-id]')`/`$('script')` DESCEND into `<template shadowroot>`, but
  `$('body').find(...)` does NOT — scoping to <body> blinds uniqueness+inert to every shadow-root stamp.
  (2) REAL RACE: `serve` arms SIGINT/SIGTERM BEFORE printing the port line — the parent reads stdout and signals
  back on another core first, killing it by default disposition (`code:null`). Its e2e signals with ZERO delay on
  purpose; a sleep hides the bug. (3) `server.close()` waits on keep-alive sockets ⇒ Ctrl-C HUNG ⇒ added
  `closeAllConnections()` to `lib/static-server.ts#close`. (4) parse5 never rejects bytes — an EMPTY index.html
  "parses" and false-PASSes 3 checks ⇒ `index-parseable` also demands a non-empty `<body>`. (5) NEVER check
  `dl-overrides.css` emptiness (ADR-002 appends rules there; e2e pins exit 0 after the 3 legal agent edits).
  (6) clone-time verify reads index.html from DISK but the manifest as TEXT (REPORT embeds the summary ⇒ docs
  written last); findings are warnings, and do NOT increment `stats.warnings` — already sealed in the verified
  manifest bytes. Remaining: M4 (T22–T26), M5 (T27–T30).
- 2026-07-08 · T22 done: the five `plugin/skills/*/SKILL.md`. Availability paragraph + brand checklist are
  diffed byte-for-byte against spec 07 (lines 72-76 / 82-90), not eyeballed. Gate green (401 tests, B3 now
  actually scans `plugin/skills` instead of SKIPping).
  TRAP (bites hard, silently): B3's placeholder hunt greps `plugin/skills` case-INSENSITIVELY for
  `TODO|FIXME|XXX\b|PLACEHOLDER|not implemented|NotImplemented` as bare SUBSTRINGS. Prose docs trip it:
  "placeholders", "Todo", "not implemented". The sealed allowlist survives only `placeholder SVG` /
  `generate a placeholder` / `placeholder="you@example.com"` (matched with `grep -vFf`, case-SENSITIVE,
  against the whole `path:lineno:content` line) — so spec 06's "generate a placeholder SVG" must stay on ONE
  source line to pass. TRAP 2: S6's token regex is `\$[0-9]`, i.e. ANY dollar-digit — a price or `$2` fails it,
  not just `$1`. TRAP 3: S8's heading needs an em dash (U+2014), never a hyphen or en dash.
  NOTE: T24's AC is already satisfied (`grep -c '## Before you ship — brand checklist'` == 1 in both
  customize-clone and build-from-design) because spec 07 §Per-skill content mandates that section in the
  bodies — writing T22 without it would have been an incomplete implementation. T24 is a verify-and-tick.
  Verified every command referenced against the REAL CLI (roles logo/nav-link/hero-heading/hero-image/cta,
  `tokens.json` at projectDir root with `clusterOf`, `screenshot <dir> --out`), not against spec prose.
  Remaining: T23 (LENSES + 2 templates; S7 red until then), T24-T26, M5 (T27-T30).
- 2026-07-08 · T23 done: `reverse-design/LENSES.md` + `templates/{DESIGN,VARIATIONS}.template.md`.
  Both templates are spec-04's "exact content"/"exact structure" blocks reproduced VERBATIM; the
  authoring rules spec 04 mandates but the blocks don't carry (all 12 headings kept even with no
  evidence; 3–5 variations, ≥1 conservative + ≥1 bold; concrete old → new rows) live in LENSES.md's
  closing "Writing rules" and a delete-me guidance section at VARIATIONS' tail — additive, so the
  greppable lines stay byte-exact. S7 + S7b flipped red → green; gate green (401 tests).
  TRAPS: (1) B3's placeholder hunt is `grep -rniE` over ALL of `plugin/skills`, not just SKILL.md —
  LENSES/templates must dodge TODO/FIXME/XXX/PLACEHOLDER prose too. (2) Cited only keys that exist in
  the REAL emitters (`motion.durationsMs` not `durations`; `typography.scaleRatioGuess`; `palette
  .primaryGuess`; inspect's `dlId`/`styles.background`; manifest at projectDir ROOT, not `clone/`).
  Spec 05 §tokens says `clone/manifest.json` — stale prose vs ADR-010; not touched, no code reads it.
  (3) inspect's `colors` is the literal STRING "see tokens.json", never an array.
  Remaining: T24 (verify-and-tick), T25–T26, M5 (T27–T30).
