# 08-testing — Deterministic tests & backpressure contract

## Purpose
Defines the plugin's OWN test suite: three local fixture sites, the unit-test surface, the e2e
suite exercising the built bundle, and the backpressure rules that keep the loop honest. The
sealed gate (`.harness/e2e-assert.sh` against `.harness/fixture/`) is the independent
authority; this suite is the fast local proxy that must make it pass.

## Requirements

### Determinism & isolation
- Tests MUST NOT reference any external URL; the only permitted network target is `127.0.0.1`
  (own fixture servers). The live web is never a test target.
- Static fixtures MUST be served by the CLI's own static-server module
  (`plugin/cli/src/lib/static-server.ts`) on EPHEMERAL ports (listen on port `0`, read the
  assigned port). Tests MUST NOT bind or reference ports 4630/4631 (sealed harness fixture).
  Network-failure fixtures MAY use a minimal custom loopback HTTP server for behavior a static
  server cannot express: open response bodies, delayed resources and redirect/CORS boundaries.
  They still use ephemeral ports and close sockets/timers in teardown.
- `plugin/cli` tests MUST NOT read, execute, or depend on any path outside `plugin/cli/` —
  nothing under `.harness/`; the plugin dir is copied verbatim on install, so it must be
  self-contained.
- Unit tests (`test/unit/`) MUST run without a browser and without listening servers; only e2e
  tests may launch Playwright or bind ports.
- e2e tests MUST spawn the BUILT bundle as a child process (`node dist/design-lens.cjs …`),
  never import TS source, and MUST assert: machine JSON parseable on stdout, human progress on
  stderr, exit 0 on success / 1 on fatal (one negative case: unreachable URL → exit 1).

### Backpressure (loop integrity — mirrors ACCEPTANCE.md AC-05/AC-06)
- npm script names are load-bearing (the sealed gate calls them): `typecheck`, `test` (unit),
  `e2e`, `build`, `verify`. They MUST exist exactly as specified below and MUST NOT be renamed.
- Every test MUST carry a why-docstring: a comment beginning `// why:` immediately above each
  `it()`/`test()` (or above a `describe()` when one reason covers all its cases) stating what
  breaks if the test is removed — fresh-context agents use it to decide delete-vs-fix.
- Tests MUST NOT use `.skip`, `.only`, `xit`, or equivalent disablers; the unit-test count MUST
  never drop below the count at the `ralph-last-green` tag (sealed ratchet, AC-05). A failing
  test unrelated to the current task MUST be fixed, never deleted or weakened.

### Fixture content (plugin/cli/test/fixtures/sites/{basic,spa,banner})
- `basic/` MUST prove localization: external stylesheet with `@import "second.css"` and
  `url(bg.png)`; a `@font-face` loading a local woff2; an `<img>` with 1x/2x `srcset`; a
  favicon; an inline `style="background-image:url(…)"`; a `<pre>` block containing a tab, two
  consecutive spaces, and a blank line (beautifier byte-preservation proof); unambiguous
  landmarks — `header img.logo`, a nav with exactly 3 links, one `h1` hero heading, a large
  hero `<img>`, one `.btn` CTA; brand color `#3347ff` used ≥ 10 times across the served CSS
  (tokens gate); ≥ 40 elements total so a `data-dl-id ≥ 30 unique` assertion is meaningful.
- `spa/` MUST have an EMPTY `<body>` in source HTML, fully built by inline JS (render-required
  proof): styles injected via `CSSStyleSheet.insertRule` — including into
  `document.adoptedStyleSheets` — with the exact marker rule
  `.dl-spa-marker { color: rgb(1, 2, 3) }` (Chromium-normalized cssText, assert by substring);
  an IntersectionObserver lazy image (real `src` set on intersect) 3 viewport-heights down; a
  painted `<canvas>`; a custom element with an OPEN shadow root and slotted content; a form
  input whose value is set by JS after load.
- `banner/` MUST be a copy of `basic` plus a fixed-position `<div id="cookie-banner">`
  (deterministic `--remove-selector "#cookie-banner"` target), a decoy
  `<script src="tracker.js">`, and `banner/filter-list.txt` — a local filter file with exactly
  3 non-comment rules: `###cookie-banner` (cosmetic hide), `/tracker.js$script` (network
  block), `@@/hero.png$image` (exception) — consumed by `--filter-list <path>` unit tests of
  the adblocker engine (match/no-match + cosmetic selector extraction, no browser).

### Unit-test surface (each module below MUST have its own file in test/unit/)
- `localize/urlmap` — ≥ 30 cases: query strings, no-extension paths, dot-segment/`..`
  traversal attempts, overlong segments, fragments, default-port and case normalization,
  collision stability (mapping algorithm per specs/02-clone-engine.md).
- `localize/css-rewrite` — escaped url() forms (`url("a\"b.png")`, backslash-space), nested
  `@import` chains, `data:` URIs left untouched, protocol-relative URLs, `@font-face src`
  with `format()`.
- `localize/srcset` — `w` and `x` descriptors, descriptorless candidates, commas inside URLs
  (data-URI candidates MUST parse), whitespace variants.
- `capture/serialize` sanitize list — one positive and one negative case per strip rule.
- `lib/slug` — URL → slug determinism and collision behavior.
- `output/report` — rendered REPORT.md contains the exact headings of specs' template,
  including `## License & usage notice`.
- `analyze/tokens` — synthetic CSS in → known clustered palette out (`#3347ff` dominant).
- `lib/static-server` — content types, 404, path-traversal rejection.

### E2e surface (test/e2e/, tagged by milestone; later-milestone tests land with their milestone)
- Responsive inspection MUST preserve the legacy JSON/default geometry, exclude hidden role
  candidates, and switch roles at mobile size. Detailed inspection MUST cover direct hidden or
  unclassified containers, missing/duplicate/invalid IDs and options, computed custom properties,
  relative units, grid/flex, selected responsive image, parent/child relationships, font readiness
  and project-file immutability. Geometry and computed details must describe one measured frame.
- Font diagnostics MUST cover actual stalled font responses as well as failed faces and delayed
  FontFaceSet readiness. Successful non-font asset readiness must remain intact. Clone re-render
  diagnostics must survive in its report and manifest warning count.
  A real font started after load and still pending after the readiness limit MUST not block
  screenshot output; verify viewport/full-page framing and DSF 1/2 on that fallback path.
- M1 `clone basic` — clone/index.html written; unique `data-dl-id` ≥ 30; zero `127.0.0.1`
  refs inside `clone/` except `manifest.json`; @import chain + bg.png + woff2 + favicon +
  inline-style url localized; `<pre>` inner text byte-identical to source; manifest.json maps
  every localized asset; REPORT.md contains `License & usage notice`.
- M1 `clone spa` — `.dl-spa-marker` rule text present in a serialized `<style>`.
- M2 `clone spa` — canvas serialized as `img[src^="data:image"]`; `<template shadowroot`
  declarative shadow DOM with the slotted content; JS-set input value present as an attribute;
  the IO lazy image localized (scroll sweep proof).
- M2 `clone basic` — BOTH srcset candidates localized and rewritten.
- M2 `clone banner --remove-selector "#cookie-banner"` — banner absent from clone;
  `clone banner --filter-list …/filter-list.txt` — banner absent via cosmetic rule.
- M3 `tokens` on the basic clone — brand color `#3347ff` reported dominant; `inspect`,
  `screenshot`, `serve`, `verify` smoke cases.
- M2 SHOULD: a cross-origin webfont case mirroring the sealed alt-port CDN — globalSetup copies
  `basic/` to a temp dir, substitutes the literal token `__DL_CDN__` in its CSS with a second
  ephemeral-port origin serving the font, and clones the temp copy.

### Recorded skill-quality evaluation (separate from deterministic tests)
- Use the authored local `test/fixtures/sites/design-study/` reference for two independent fresh
  agent runs with complete product briefs: a marketing page and a dense management interface.
  Both use actual portable skills and the built CLI, with separate temporary workspaces. No
  generated design answers are supplied. All network traffic stays on 127.0.0.1; this banner-free
  fixture uses `--no-block-cookies` to avoid downloading the external filter list.
- Preserve commands, capture hashes, DESIGN.md, VARIATIONS.md, implementation and viewed
  1440×900, 768×1024 and 390×844 images. Independently check traceability, honest uncertainty,
  task-specific structural differences, mobile/long-content quality, real interactions and
  keyboard focus. CSS occurrence counts and unbound keyframes must not become claims about
  painted area or observed motion. Preserve source capture evidence and use original content.
- Commit reproducible briefs, protocol and actual results under `test/evaluations/`; keep generated
  artifacts outside the repo. Record limits, including launcher mapping for a repository-level
  run instead of testing installed plugin discovery. If a skill/CLI cause fails a scenario, retain
  the failed run, fix the cause and rerun fresh; manually repaired output is not a skill pass.

### Relationship to the sealed gate
- `.harness/**` is SEALED (sha256 manifest, checked every iteration). Build agents MUST NOT
  create, edit, or delete anything under `.harness/`, including "helpful" fixture fixes.
- The harness independently boots `.harness/fixture/serve.mjs` on ports 4630 (site) + 4631
  (fake CDN) and runs `bash .harness/e2e-assert.sh --m1` (AC-07) / `--all` (AC-08) against the
  built bundle. Own-suite green MUST imply sealed-gate green: every sealed assertion has an
  own-fixture equivalent listed above (marker CSSOM rule ↔ `.js-injected`; canvas/shadow/input/
  lazy ↔ spa; srcset ↔ basic; consent-banner-absent ↔ banner; alt-port font ↔ CDN case). If the
  sealed gate fails while the own suite passes, extend the OWN fixtures/tests to reproduce the
  failure locally — never touch `.harness/`.

## Interfaces & contracts
- `plugin/cli/package.json` scripts (exact strings):
  `"typecheck": "tsc --noEmit"` · `"test": "vitest run --project unit"` ·
  `"e2e": "vitest run --project e2e"` · `"build": "tsup"` ·
  `"verify": "npm run typecheck && npm run test && npm run build && npm run e2e"`
  (build precedes e2e because e2e runs `node dist/design-lens.cjs`).
- `plugin/cli/vitest.config.ts` (single file) defines two named projects: `unit` (include
  `test/unit/**`, no setup) and `e2e` (include `test/e2e/**`, `globalSetup:
  'test/e2e/global-setup.ts'`, testTimeout ≥ 120 000 ms, `fileParallelism: false`).
- `test/e2e/global-setup.ts` starts one static-server instance per fixture site on port 0,
  publishes origins via vitest `provide()`/`inject()` under the single key
  `fixtureUrls: { basic: string; spa: string; banner: string; cdn: string }`, and returns a
  teardown closing all servers.
- Fixture tree (binaries are tiny valid committed files, < 5 KB each):
  `test/fixtures/sites/basic/{index.html, style.css, second.css, fonts/brand.woff2, img/{logo.svg, hero.png, hero@2x.png, bg.png, favicon.png}}`
  · `test/fixtures/sites/spa/{index.html, img/lazy.png}`
  · `test/fixtures/sites/banner/{…basic copy…, tracker.js, filter-list.txt}`.
- e2e clone output MUST go to a per-test temp dir (`fs.mkdtemp`), never into the repo tree.

## Out of scope
- The sealed gate's internals (`.harness/verify.sh`, `.harness/e2e-assert.sh`,
  `.harness/fixture/`) — read-only; their assertions are mirrored in ACCEPTANCE.md.
- Live-web or real-site testing (manual, post-loop, per ACCEPTANCE.md "Manual").
- Numerical LLM quality scores. Deterministic source-to-clone pixel/geometry checks are required
  by ADR-023; independent design interpretation remains a recorded evidence review. The ADR-030
  retention and reference-fidelity numbers are deterministic consistency gates over
  agent-authored tables, not LLM quality scores.
- Testing the Codex install leg (ACCEPTANCE.md AC-18 handles it; demotable to a warning).

## Verified facts
- `outerHTML` capture loses `insertRule`/`adoptedStyleSheets` CSS, canvas bitmaps, shadow DOM,
  and live input state — exactly what the `spa` fixture forces the serializer to prove
  (research/clone-tech.md).
- `@percy/dom` 1.32.x serializes CSSOM rules into head stylesheets, canvas → `<img>` data URI,
  open shadow roots → `<template shadowroot>`, input state → attributes — the M2 spa
  assertions match its documented behavior (research/clone-tech.md; ADR-008).
- Chromium normalizes rule cssText to `.dl-spa-marker { color: rgb(1, 2, 3) }`, so the marker
  is asserted against normalized output, not authored source (research/clone-tech.md).
- kage's `urlx` is a pure, heavily-cased URL→path module (query folding, normalization,
  traversal defense) — the model for the ≥ 30-case urlmap suite (research/kage-clone.md).
- srcset parsing is nontrivial enough that SingleFile bundles `parse-srcset`; comma-in-URL
  tolerance is a real failure mode (research/clone-tech.md).
- Why-docstrings and a test-count ratchet are the proven countermeasures to agents deleting or
  gutting tests to go green (research/ralph-loop.md; ADR-009).
- Sealed fixture ports 4630/4631 are baked into `.harness/fixture/style.css` and MUST NOT be
  reused; `serve.mjs` delays `/slow.css` by 800 ms to exercise settle discipline
  (.harness/config.env, .harness/fixture/serve.mjs — sealed).
- The sealed assertion list (data-dl-id ≥ 30, `.js-injected` rule, zero `127.0.0.1` refs except
  manifest.json, canvas/shadow/input/lazy/srcset/alt-port-font/banner-absent) is fixed in
  ACCEPTANCE.md AC-07/AC-08 and cannot be renegotiated (ADR-006).

### Fidelity and blueprint regression coverage (ADR-023)
Add local marketing/editorial/dashboard-form/web-component/JS-responsive cases. Compare actual
rendered source/clone pixels and geometry, including shadow/canvas output. Negative controls
must reject missing small logos, replacement fonts, layout shifts, mobile-only DOM loss, page
height changes, stale hashes and incomplete evidence. Cover base/redirect/SVG/CSS variables/
image-set/SRI/CSP/srcdoc resources, alpha/calc/font shorthand/selector token failures, and false
measurement citations. Independent agents exercise the actual skills and implement from a
blueprint; retain reproducible inputs/results with generated artifacts outside the repository.

### Tone, validation, build QA, inspection, capture and run-log coverage (ADR-030)
Unit tests cover pixel lightness/histograms and tone bands on synthetic PNGs, markdown and build
contract parsing, every new validate-design failure mode (typeface forms, tone rows, stale tone as
unverified, signature citations and kinds, stale design basis as fail, selection basis, retention
range, quote verification, contract cross-checks, reference fidelity missing/failed/unverified/
unconfirmed/older run/failed signature check, `documents` fields), qa's number tokenizer and unit
classes, LCS, review codes and contract evaluation, run-log location/redaction/summary, and
capture diffing, media substitution and stabilization validation. E2E spawns the bundle: a
`qa-study` fixture reproduces the experiment's defects (span tabs with and without pointer/hover
styles, five-label `#footer` links, a self-anchor with ↗, a fixed button covering 18% of a CTA, an
inverted opaque PNG icon, a 5 px masked overflow, unsourced month counts) and must fail with each
check id, while a clean page with content passes; wrong review codes write no `review.json`; a
`--project` case covers lineage in both modes, source assets and contract checks. Inspect lite,
selector and multi-viewport cases keep flagless output identical. Capture cases cover poster
substitution, lazy/hidden images, timer freezing (opt-in; the existing incomplete timer case stays
green without it) and SMIL. Run-log cases prove nested layouts log once and `DESIGN_LENS_RUNLOG=off`
logs nothing. Existing assertions keep their outcomes; changed defaults keep the old behavior
covered under the opt-out flag. The 0.4.0 skills get fresh independent local evaluations
exercising qa, qa-confirm and reference fidelity, recorded under `test/evaluations/0.4.0/`
together with the external baseline that motivated them.
