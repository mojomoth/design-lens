# 02-clone-engine — the clone pipeline

## Purpose
Defines the `design-lens` CLI command surface and the full `clone` pipeline: a Playwright-Chromium
render of one URL, serialized CSSOM-aware, sanitized to an inert page, with every referenced asset
localized into a pretty-printed folder mirror. The pipeline is built in three milestones (ADR-008):
M1 spine, M2 fidelity, M3 polish — the spine must stay green while fidelity lands on top.

## Requirements

### General
- The CLI MUST be a self-contained npm package at `plugin/cli/` (no npm workspaces), bundled by
  tsup to the committed `plugin/cli/dist/design-lens.cjs`. npm scripts MUST be exactly
  `typecheck`, `test`, `e2e`, `build`, `verify` (sealed gate calls these names). `--version` MUST
  print `0.1.1`, identical to both plugin manifests (AC-10).
- I/O discipline: human-readable progress → stderr; machine output (JSON) → stdout — nothing
  else ever goes to stdout; exit 0 on success (warnings allowed), exit 1 on fatal errors.
- `playwright` and `@ghostery/adblocker-playwright` MUST be resolved via
  `lib/runtime-deps.ts#loadRuntimeDep` (try `require(name)`, fall back to
  `~/.design-lens/runtime/node_modules/<name>`); both stay EXTERNAL to the bundle (ADR-005/007).
  Agents MUST NOT run `playwright install` — Chromium is harness/bootstrap-provisioned (ADR-008).
- The clone output MUST contain no JavaScript ("a photograph, not a program", ADR-001). Output
  layout, `manifest.json` schema, and `REPORT.md` template are normative in
  `specs/03-clone-format.md`; this spec defines what the pipeline records into them.
- `--timeout <n>` is in SECONDS and budgets the WHOLE clone run. The implementation MUST convert
  to milliseconds wherever Playwright expects ms (`page.goto`, `waitForLoadState`): keep a
  `deadline = start + n*1000` and pass `min(remaining_ms, stage_cap_ms)` to each browser wait.
  Budget exhaustion during navigation is fatal (exit 1); during an optional stage it degrades with
  a warning. Post-processing (sanitize→write) is never interrupted by the budget.
- Tests MUST only target 127.0.0.1 fixtures at `plugin/cli/test/fixtures/sites/{basic,spa,banner}`
  served on EPHEMERAL ports by `lib/static-server.ts`. Ports 4630/4631 belong to the sealed
  harness fixture (`.harness/fixture/`, read-only) and MUST NOT be bound by the plugin's own tests.

### M1 spine (gate: `bash .harness/e2e-assert.sh --m1`)
Stages run in this order; each stage is one module with unit tests.
1. **Launch** (`capture/browser.ts`) — Chromium headless via `loadRuntimeDep('playwright')`;
   context with `--viewport` (default 1440×900; both dimensions MUST be positive safe integers), `--dsf` (default 1), real default Chromium UA
   unless `--user-agent`; `page.emulateMedia({ reducedMotion: 'reduce' })` MUST be set BEFORE
   navigation (freezes reveal animations at final state). Chromium launches with
   `--disable-web-security` (+ `--disable-features=IsolateOrigins,site-per-process`) and the
   context sets `bypassCSP` so cross-origin CSS assets — notably a CORS-unheadered CDN webfont —
   load and are captured at render instead of failing `net::ERR_FAILED` (ADR-011). Resource
   capture starts immediately:
   `page.on('response')` → `localize/resource-store.ts` records
   `{url, status, contentType, body: Buffer}`; body-read failures are tolerated and recorded as
   warnings, never thrown.
2. **Navigate & settle** (`capture/settle.ts`) — `page.goto(url, { waitUntil: 'load', timeout })`;
   then `Promise.race([page.waitForLoadState('networkidle'), sleep(15_000)])` (networkidle is the
   standard capture signal but MUST be capped — analytics/websockets can starve it); then wait
   `--settle` ms (default 1500). Out-of-band: fetch `<origin>/robots.txt`; if a `User-agent: *`
   group disallows the path, record `robotsDisallowed: true` in the manifest and a notice in
   REPORT.md — the clone PROCEEDS (transparency, not blocking). Any robots fetch/parse failure ⇒
   `false`, no warning.
3. **Pre-serialize DOM mutations** (`capture/stamp.ts`, via `page.evaluate`) — (a) remove every
   `--remove-selector` match, and every match of the cosmetic selectors the consent engine returned
   for this page (M2, ADR-012); (b) stamp `data-dl-id="dl-N"` (document-order counter, N from 1) on
   every element under `document.body`, including elements inside OPEN shadow roots, skipping
   `script`/`style`. Ids MUST be unique and MUST survive serialization (sealed gate: ≥ 30 unique).
   No capture-time metadata file is written — `inspect` measures the served clone live (ADR-002).
4. **Serialize** (`capture/serialize.ts`) — the OWN ~50-line CSSOM-walk serializer (M1 default,
   M2 fallback), run in page context: for each `document.styleSheets` entry whose `cssRules` is
   readable and whose owner node is a `<style>`, replace its text with
   `[...sheet.cssRules].map(r => r.cssText).join('\n')` (captures `insertRule`-injected rules
   invisible in `outerHTML` — the sealed `.js-injected` assertion); append one
   `<style data-dl-adopted>` per `document.adoptedStyleSheets` entry; `<link>` stylesheets keep
   their element (bodies are localized from the ResourceStore; cross-origin `cssRules` access
   throws SecurityError and MUST be caught, keeping the `<link>`). Return
   `'<!DOCTYPE html>' + document.documentElement.outerHTML`.
5. **Sanitize** (exported pass in `localize/html-rewrite.ts`, cheerio) — strip: all `<script>`;
   all `on*` attributes; `javascript:` URLs (`href` → `#`, other attributes dropped);
   `<meta http-equiv="refresh">`; dead hints (`preconnect`, `dns-prefetch`, `modulepreload`,
   script `preload`/`prefetch` links); `<noscript>` (removed entirely); IE conditional comments
   (script smuggling). Ensure `<meta charset="utf-8">` exists. Prepend the provenance comment
   (exact text in `specs/03-clone-format.md`).
6. **Localize** (`localize/{urlmap,html-rewrite,css-rewrite,srcset}.ts`) — rewrite every
   reference through the urlmap (below): `img src/srcset`, `source src/srcset`, `link href`
   (stylesheet/icon/apple-touch-icon/mask-icon/manifest — token-aware `rel` parsing),
   `video src/poster`, `audio/track/embed/object`, inline `style=""` `url()`, `<style>` blocks.
   CSS rewriting MUST use css-tree (walk `Url` nodes and `@import` atrule preludes — regex
   mishandles escapes): each external stylesheet body from the ResourceStore is rewritten against
   ITS OWN URL and saved under `assets/`; refs discovered inside CSS (fonts, background images,
   nested `@import`) are enqueued recursively and localized from the ResourceStore — this includes
   woff2 fonts captured during render. At M1, refs whose resource is NOT in the ResourceStore stay
   remote and are recorded in `manifest.remote[]` (refetch lands in M2). Always left alone:
   `data:`, `mailto:`, fragments; `<a href>` page links stay absolute to the live web;
   cross-origin iframes stay remote (recorded). Bulk media (mp4/webm/mp3/pdf/zip) stays remote
   unless `--include-media`; bodies over `--max-asset-mb` (default 25) stay remote and are
   recorded with reason `oversize`.
7. **Beautify** (`output/beautify.ts`) — js-beautify (`html-beautify` + `css-beautify`): indent 2,
   `unformatted: ['pre', 'textarea', 'code']`, wrap 0. Pretty-printing is a HARD requirement — it
   is what makes agent line-based edits reliable. `<pre>` content MUST survive byte-identical.
8. **Write** (`output/{writer,manifest,report}.ts`) — write `clone/index.html`, localized assets,
   an EMPTY `clone/assets/dl-overrides.css` plus its `<link>` LAST in `<head>`, `manifest.json`,
   `REPORT.md` (must contain the "License & usage notice" heading), then print the summary + a
   one-line ethics notice to stderr and the result JSON to stdout. Write failures are fatal.

### M2 fidelity (gate: `bash .harness/e2e-assert.sh --all`)
- **Consent blocking** (`capture/consent.ts`, applied between launch and navigate) — the blocker is
  ALWAYS constructed via `PlaywrightBlocker.parse(text)` over filter-list TEXT, so every source
  shares one code path. Default text = the built-in generic consent ruleset
  (`capture/consent-rules.ts`) followed by fanboy-cookiemonster, downloaded to
  `~/.design-lens/cache/filterlists/` with a 7-day TTL (file mtime); the built-in ruleset is
  REQUIRED because fanboy-cookiemonster carries no generic rule for the common `.cookie-banner`
  container, only domain-scoped ones (ADR-012). `--filter-list <file>` (local list, deterministic
  tests, no network) REPLACES that default text entirely, built-ins included. Then
  `blocker.enableBlockingInPage(page)` gives network blocking; the engine's cosmetic verdicts are
  INTERCEPTED rather than injected, and their selectors are removed by `capture/stamp.ts` — a clone
  is markup, so hiding would leave the banner in the file (ADR-012). `--no-block-cookies` disables.
  A download failure ⇒ warn, proceed with the built-in rules alone (still `enabled`); a list that
  cannot be read or parsed ⇒ warn, proceed, record `consentBlocking: "unavailable"`
  (values: `enabled|disabled|unavailable`).
- **Lazy-load sweep** (in `capture/settle.ts`, after settle, unless `--no-scroll`) — scroll by
  `viewportHeight * 0.8` every 150 ms to `document.body.scrollHeight`, dispatching synthetic
  `scroll` events (IntersectionObserver libs); re-race networkidle (15 s cap); scroll back to top;
  settle `--settle` ms again. If body height grew during the sweep, repeat ONCE.
- **@percy/dom serializer upgrade** — inject the @percy/dom browser bundle and run
  `PercyDOM.serialize()`: CSSOM rules, `adoptedStyleSheets`, input state → attributes, `canvas` →
  data-URI `<img>`, open shadow roots → declarative `<template shadowroot>`. Its script source
  MUST be embedded as a string at build time (esbuild text-loader alias or a generated
  `src/capture/percy-dom-src.ts`) and injected with `page.addScriptTag({ content })` —
  `require.resolve` paths do not exist inside the single-file bundle. The own CSSOM-walk
  serializer is KEPT as automatic fallback: percy throwing or returning empty output ⇒ warn +
  fall back; only both failing is fatal.
- **Refetch of uncaptured resources** (`localize/fetch-missing.ts`) — resources referenced but not
  network-captured during render (unused srcset variants, CSS-discovered fonts) are fetched via
  `context.request.get(url)` — browser-context fetch carries the real browser UA, which is what
  makes Google Fonts return woff2 (verified UA-dependence; see Verified facts). Retries ×2;
  failures ⇒ remote + reason `fetch-failed`. Manifest `via` values: `network|css-fetch|refetch`.
- **srcset** (`localize/srcset.ts`) — descriptor-preserving parser that MUST tolerate commas
  inside candidate URLs (kage's naive comma-split is a known bug); both fixture variants localized.

### M3 polish
- **Screenshots** — before closing the page: `screenshots/original-viewport.png` and
  `original-full.png`; after writing, serve `clone/` on an EPHEMERAL port
  (`lib/static-server.ts`), re-render, write `screenshots/clone-full.png`.
- **Verify routine** — `verify <projectDir>` integrity check (also run at the end of `clone` as
  warnings, not fatal); MUST still pass after agent edits (dl-overrides.css rule + text edit).
- Commands `tokens`/`inspect`/`screenshot`/`serve` wired per their own specs; bootstrap/hooks,
  skills, install gates, and docs are other specs' scope.

### Error handling (degradation ladder)
- Per-stage try/catch: consent blocking optional → scroll sweep optional → percy → own serializer
  → only navigation failures (goto timeout, DNS) and output-write failures are fatal (exit 1, one
  line: cause + hint such as `--timeout` or check URL).
- Every degradation appends to `report.warnings[]`; every non-localized resource is enumerated in
  REPORT.md "Left remote" and `manifest.remote[]` with reason
  `cross-origin-iframe|oversize|media-skipped|fetch-failed`. No bare catch-and-continue (CONVENTIONS).

## Interfaces & contracts

### Command surface (commander; `src/index.ts` is wiring only)
| Command | Purpose | Flags (defaults) |
|---|---|---|
| `clone <url>` | full pipeline → `.design-lens/<slug>/` | `--project <name>` · `--out <dir>` (`./.design-lens`) · `--viewport <WxH>` (`1440x900`) · `--dsf <n>` (1) · `--timeout <s>` (90, SECONDS, whole run) · `--settle <ms>` (1500) · `--no-scroll` · `--no-block-cookies` · `--filter-list <file>` · `--remove-selector <css>` (repeatable) · `--max-asset-mb <n>` (25) · `--include-media` · `--user-agent <ua>` |
| `tokens <projectDir>` | captured CSS → `tokens.json` | `--stdout` |
| `inspect <projectDir>` | live element inventory → JSON on stdout | `--kind <role>` · `--pretty` |
| `screenshot <projectDir\|--url U>` | PNG of clone or live URL | `--out <file>` · `--full-page` · `--width/--height` · `--dsf <n>` (2) |
| `serve <projectDir>` | static server for the clone | `--port <n>` (0 = ephemeral, default; the chosen port is printed to stdout) |
| `verify <projectDir>` | clone integrity check | `--json` |
| `--version` / `--help` | commander built-ins | |

On success `clone` prints exactly one JSON line to stdout:
`{"projectDir": "<ABSOLUTE path to .design-lens/<slug>>", "warnings": <n>}` — the path MUST be
absolute (specs/03-clone-format.md mandates the same). Slug derivation lives in `lib/slug.ts`
(contract in `specs/03-clone-format.md`).

### urlmap (`localize/urlmap.ts` — PURE module, no I/O, 30+ unit tests)
`localPathFor(url: string, contentType?: string): string`, deterministic (same URL ⇒ same path,
so rewriting may precede fetching; the pipeline resolves fetches before the final rewrite pass so
`contentType` is known when needed).
- Normalize first: resolve against the owning document/stylesheet URL; lowercase scheme + host;
  drop default port and fragment.
- Map to `assets/<host>/<pathname>`. The host segment is SLUGGED — `hostname` with every run of
  non-`[a-z0-9]` characters collapsed to `-` (`example.com`→`example-com`, `127.0.0.1`→`127-0-0-1`)
  — then a non-default port is appended as `-<port>` (colon is illegal on Windows; the literal
  host must never appear in `clone/` per sealed A4, ADR-011). The two fixture hosts differ only by
  port (`127-0-0-1-4630` vs `127-0-0-1-4631`) and MUST NOT collide.
- Empty or trailing-slash path ⇒ append `index`.
- Missing extension ⇒ append one inferred from contentType (`text/css`→`.css`,
  `font/woff2`→`.woff2`, `image/png`→`.png`, `image/svg+xml`→`.svg`, `image/jpeg`→`.jpg`,
  `image/webp`→`.webp`, unknown→`.bin`; JavaScript is never localized — scripts are dropped).
- Query string ⇒ `__q-<first-8-hex-of-sha256(query)>` inserted before the extension.
- `..` segments collapsed (no traversal above `assets/`); percent-decoded segment characters
  outside `[A-Za-z0-9._-]` replaced with `_`; segments > 100 chars ⇒ first 91 chars + `-` +
  8-hex sha256 of the full segment.

### Module layout (`plugin/cli/src/` — one module per concern)
```
index.ts                    # commander wiring only
commands/{clone,tokens,inspect,screenshot,serve,verify}.ts
capture/{browser,consent,consent-rules,settle,stamp,serialize}.ts
localize/{resource-store,urlmap,html-rewrite,css-rewrite,srcset,fetch-missing}.ts
output/{writer,manifest,report,beautify}.ts
analyze/{tokens,inspect,heuristics}.ts
lib/{runtime-deps,slug,log,static-server}.ts
```

### Libraries (allowlist in CONVENTIONS.md; pins are load-bearing)
| Library | Pin | Role | Why (over alternatives) |
|---|---|---|---|
| `playwright` | exact = `PLAYWRIGHT_VERSION` in `.harness/config.env` | render engine | EXTERNAL to bundle (browser-binary logic doesn't bundle); pin keeps dev + `~/.design-lens/runtime` identical (ADR-008) |
| `@ghostery/adblocker-playwright` | exact (2.18.x line) | consent blocking (M2) | uBO-compatible network + cosmetic hiding; MPL-2.0 ⇒ EXTERNAL to bundle (ADR-005) |
| `@percy/dom` | `^1.32` | M2 serializer | only maintained OSS serializer covering CSSOM + shadow DOM + canvas + input state (MIT) |
| `cheerio` | `^1` | HTML post-processing | jQuery API over parse5; offset surgery unnecessary since output is beautified anyway |
| `css-tree` | `^3` | CSS `url()`/`@import` rewrite | real parser; regex (kage) mishandles escapes; SingleFile itself bundles csstree |
| `js-beautify` | `^2` | pretty-print | more tolerant than prettier of serializer-emitted noncompliant markup; smaller bundle |
| `@projectwallace/css-analyzer` | `^9` | tokens metrics (M3) | 150+ metrics incl. per-property color context; actively maintained |
| `culori` | `^4` | OKLCH + deltaE clustering (M3) | standard color math lib |
| `commander` | `^12` | arg parsing | boring and small |

Dev: `typescript`, `tsup`, `vitest`, `eslint` + `typescript-eslint`, `@types/node`. tsup config:
`format: ['cjs']`, `platform: 'node'`, `target: 'node20'`, `noExternal: [/.*/]`,
`external: ['playwright','playwright-core','@ghostery/adblocker-playwright']`, shebang banner.

## Out of scope
- Multi-page crawling, authentication/cookies, paywalled pages; Firefox/WebKit; single-file HTML
  export (single-file-cli is AGPL — never vendored or imported, ADR-005); MCP server; persistent
  edit manifest (ADR-002).
- Covered by other specs: `tokens`/`inspect` algorithms, output-directory/manifest/REPORT schemas
  (`specs/03-clone-format.md`), bootstrap.sh, skills, fixture site contents.

## Verified facts (do not re-litigate)
- `networkidle` is documented "DISCOURAGED" yet remains the standard capture signal; it MUST be
  capped via `Promise.race` because analytics/websockets can starve it — research/clone-tech.md §A1.
- `@percy/dom` (1.32.x, MIT) serializes CSSOM rules, `adoptedStyleSheets`, input state →
  attributes, canvas → data-URI `<img>`, open shadow roots → `<template shadowroot>`; injected as
  a script tag then `PercyDOM.serialize()` — research/clone-tech.md §A1.
- `outerHTML` alone loses `insertRule`/`adoptedStyleSheets` CSS (CSS-in-JS renders empty
  `<style>` tags); the fix is walking `document.styleSheets` + `adoptedStyleSheets` and emitting
  `cssRules[i].cssText`; cross-origin sheets throw SecurityError on `cssRules` —
  research/clone-tech.md §A1/§A3.
- Google Fonts is UA-dependent (empirically verified): no UA ⇒ single TTF face; Chrome UA ⇒ woff2
  + `unicode-range` subsets. Fetch font CSS inside the browser context and refetch with the real
  browser UA (`context.request.get`) — research/clone-tech.md §A3.
- `@ghostery/adblocker-playwright` 2.18.1 applies network blocking AND cosmetic hiding; the
  fanboy-cookiemonster list URL (`https://secure.fanboy.co.nz/fanboy-cookiemonster.txt`) verified
  live HTTP 200 — research/clone-tech.md §A3.
- The sanitize list (scripts, `on*`, `javascript:` URLs, meta refresh, dead hints, noscript, IE
  conditional comments, ensure meta charset) is kage's shipped, verified behavior — research/kage-clone.md §2.
- Deterministic URL→path mapping with `__q-<sha256-prefix>` query folding enables rewriting
  before fetching completes (kage `urlx`); kage's srcset parser splits on bare commas and mangles
  comma-containing CDN URLs — ours must not — research/kage-clone.md §3/§4.
- `emulateMedia({ reducedMotion: 'reduce' })` before navigation freezes reveal animations; scroll
  sweep + synthetic scroll events is the production lazy-load pattern; js-beautify is more
  tolerant than prettier of serializer output — research/clone-tech.md §A1/§A3/§A4.
- Own-engine decision, no-JS output, M1 own serializer → M2 percy staging, and pinned Playwright
  with harness-provisioned Chromium are settled — ADR-001, ADR-005, ADR-008.
