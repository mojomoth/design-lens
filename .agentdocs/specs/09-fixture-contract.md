# 09-fixture-contract — the sealed harness fixture and its assertions

## Purpose

This spec DOCUMENTS the sealed test target the clone engine is measured against: the fixture
site in `.harness/fixture/` and the assertion script `.harness/e2e-assert.sh`. Both are sealed
(sha256 manifest + out-of-repo copy, ADR-006) and READ-ONLY to build agents — this file is a
faithful mirror so the builder knows exactly what the independent gate asserts. If this document
and the sealed script ever disagree, the sealed script wins.

## Requirements

- Build agents MUST NOT modify, move, or delete anything under `.harness/**`. The seal is
  checked every iteration; a violation restores from the `bootstrap` tag and aborts (ADR-006).
  This is WHY the fixture is sealed: the agent can never "fix the test" by editing the target —
  the gate never reads agent-editable files, so green means the engine actually works.
- The engine MUST pass `bash .harness/e2e-assert.sh --m1` to complete any M1 task; verify.sh
  runs `--m1` every iteration once `plugin/cli/dist/design-lens.cjs` exists (AC-07).
- `bash .harness/e2e-assert.sh --all` is part of `verify.sh --strict` (AC-08) — the completion
  gate. `--all` includes everything in `--m1` plus the M2 fidelity and M3 analyze assertions.
- Milestone mapping (ADR-008): A1–A9 + A15 gate **M1** (spine). A10–A12 (percy serializer),
  A13 (scroll sweep), A14 (srcset refetch), A16 (consent blocking) gate **M2**. A17 (`tokens`)
  and A18 (`inspect`) gate **M3**.
- The engine MUST NOT special-case the fixture: no hardcoded `127.0.0.1`/port/`dl-card`/
  `#consent` logic in `plugin/cli/src/`. The fixture is a measurement target; every assertion
  must pass via the generic pipeline stages (specs/02-clone-engine.md).
- The `/slow.css` 800 ms delay MUST be absorbed by the engine's normal load discipline
  (`goto(waitUntil:'load')` + capped networkidle race), never by fixture-specific waits.
- Ports 4630/4631 are FIXED — `http://127.0.0.1:4631/...` is baked into `fixture/style.css`
  (see `.harness/config.env`). The plugin's OWN test fixtures
  (`plugin/cli/test/fixtures/sites/{basic,spa,banner}`, specs/08-testing.md) MUST use
  ephemeral ports and MUST NOT copy or import `.harness/fixture/` content.
- Local runs (the builder SHOULD run these before ending an iteration):
  - `node .harness/fixture/serve.mjs --check` — boots both ports, self-fetches every fixture
    file, exits 0/1 (sanity check that the fixture serves).
  - `bash .harness/e2e-assert.sh --m1` / `bash .harness/e2e-assert.sh --all` — the script
    manages the fixture server lifecycle itself; if a run dies uncleanly, kill any stale
    process still bound to 4630/4631 before re-running.

## Interfaces & contracts

### The sealed fixture (shipped in `.harness/fixture/` — READ-ONLY)

- **`serve.mjs`** — main port **4630** serves `fixture/`; alt port **4631** serves
  `fixture/thirdparty/` (fake CDN). The path `/slow.css` is served with an **800 ms delay**
  (exercises load discipline). `--check` mode boots both ports, self-fetches every file,
  exits 0/1. Also accepts `--port N` / `--alt-port N` (the gate uses the defaults).
- **`index.html`** — consent banner `<div id="consent" class="cookie-banner">` with a dismiss
  button; header with inline-SVG logo + `<nav>` with 3 links; hero section with `<h1>`,
  tagline `<p>`, `<a class="btn-primary">` CTA; hero `<img>` with srcset
  `"assets/hero-800.png 800w, assets/hero-1600.png 1600w"`; gallery of 3 SVG `<img>`; one
  `<img id="lazy-io" data-src="assets/lazy.svg">` swapped in by an IntersectionObserver; two
  `<dl-card>` custom elements with slotted content; a JS-painted `<canvas id="chart">`; a form
  `<input id="email">` whose value is set by JS; links `style.css` and `slow.css`.
  (`about.html` also ships as the nav/CTA link target; it is served but never cloned.)
- **`app.js`** — defines `dl-card` with an OPEN shadow root styled via `adoptedStyleSheets`
  (constructed `CSSStyleSheet`); injects a CSSOM rule `.js-injected { color: rgb(1, 2, 3); }`
  via `insertRule` into an empty `<style>` and appends a visible `div.js-injected`;
  IntersectionObserver lazy swap; canvas paint; sets the input value; consent dismiss handler.
  Each block is a deliberate trap forcing one engine capability (invisible-in-outerHTML CSSOM,
  shadow DOM, lazy-load, canvas, property-vs-attribute input state, consent).
- **`style.css`** — `@import "extra.css"`; `@font-face "Fixture Sans"` with
  `src: url(http://127.0.0.1:4631/fonts/fixture.woff2)`;
  `.hero { background-image: url(assets/bg.svg) }`. The colors `#0a2540` and `#ff5c35` are
  used ≥ 10 times across `style.css` + `extra.css` (tokens gate).
- **`assets/`** — `hero-800.png`, `hero-1600.png`, `bg.svg`, `gallery-1.svg`, `gallery-2.svg`,
  `gallery-3.svg`, `lazy.svg`. **`thirdparty/fonts/fixture.woff2`** (served only via port 4631).

### `e2e-assert.sh` assertions (mirror of the sealed script)

`--m1` (spine; runs every iteration once `plugin/cli/dist/design-lens.cjs` exists):

| ID | Assertion |
|---|---|
| A1 | `clone http://127.0.0.1:4630/index.html` exits 0 and writes `clone/index.html` |
| A2 | `data-dl-id` count ≥ 30, all unique |
| A3 | the `.js-injected` rule text is present in the clone output (CSSOM serialization works) |
| A4 | zero `127.0.0.1` references inside `clone/` excluding `clone/manifest.json` |
| A5 | `style.css` AND `extra.css` (via `@import`) localized under `clone/assets/` |
| A6 | `bg.svg` localized and its CSS `url()` rewritten |
| A7 | `manifest.json` parses; every `resources[].localPath` exists on disk |
| A8 | `REPORT.md` exists and contains "License & usage notice" |
| A9 | `clone/index.html` has no `<script>` tags and no `on*` handler attributes |
| A15 | the alt-port webfont (`fixture.woff2`) is localized (it IS network-captured during render — the body text uses "Fixture Sans", so the font loads at render time) |

`--all` (adds the following; the strict completion gate):

| ID | Assertion |
|---|---|
| A10 | canvas serialized as `<img src="data:image...">` |
| A11 | declarative shadow DOM present (`<template shadowroot`) with the `dl-card` content |
| A12 | the JS-set input value present as a `value="…"` attribute |
| A13 | `lazy.svg` (IntersectionObserver image) localized and referenced via `src` |
| A14 | BOTH srcset candidates (`hero-800.png` and `hero-1600.png`) localized |
| A16 | the consent banner (`#consent`) is ABSENT from the clone |
| A17 | `tokens` output contains `#0a2540` and `#ff5c35` and the "Fixture Sans" family |
| A18 | `inspect` finds roles: `logo`, ≥ 3 `nav-link`, `hero-heading`, `hero-image`, `cta` |

Notes for the builder:
- A10–A18 are asserted against the same single clone invocation as A1 (plus one `tokens` and
  one `inspect` run for A17/A18). No fixture-specific CLI flags rescue a failing assertion —
  the generic pipeline must produce these results.
- A16 only asserts absence; whether removal happens via the adblocker's cosmetic rules or a
  cached/local filter list is the engine's concern (specs/02-clone-engine.md). The banner's
  `cookie-banner` class is deliberately generic.
- A14 requires refetching the srcset variant NOT chosen by the browser at the capture
  viewport; A13 requires the scroll sweep to trigger the IntersectionObserver before serialize.

## Out of scope

- The internal implementation of `.harness/e2e-assert.sh`, `.harness/verify.sh`, and
  `serve.mjs` — sealed; the builder consumes exit codes only.
- The plugin's own vitest fixtures and their assertions (specs/08-testing.md).
- Cloning `about.html` or multi-page behavior — only `index.html` is the gate target.
- Changing fixture ports, content, or adding fixture files — sealed by definition.

## Verified facts

- `.harness/**` is sealed with a sha256 manifest plus an out-of-repo copy, checked every
  iteration; the machine gate never reads agent-editable files (ADR-006).
- `document.documentElement.outerHTML` misses input state, canvas, shadow DOM, and all CSS
  injected via `insertRule`/`adoptedStyleSheets` — CSS-in-JS renders as empty `<style>` tags;
  CSSOM-walking serializers (@percy/dom) fix this (research/clone-tech.md). This is why A3,
  A10, A11, A12 exist.
- Playwright's `networkidle` is officially discouraged and can be starved; it must be raced
  against a cap (research/clone-tech.md). This is why `/slow.css` exists.
- kage strips all JS but loses CSS-in-JS and shadow DOM and leaves third-party CDN assets
  remote (research/kage-clone.md, ADR-001). This is why the alt-port CDN font (A15) and the
  inert-sanitize assertion (A9) exist.
- Agents editing their own gates and deleting tests are the canonical Ralph-loop reward hacks;
  sealed gates + test-count ratchets are the countermeasure (research/ralph-loop.md, ADR-009).
- Ports 4630/4631 and `PLAYWRIGHT_VERSION=1.61.1` are pinned in `.harness/config.env`; the alt
  port is baked into `fixture/style.css` and cannot change (config.env comment).
- Milestone staging M1 (own ~50-line CSSOM-walk serializer) → M2 (@percy/dom upgrade) → M3
  (analyze/packaging) is decided in ADR-008; `--m1` and `--all` are its gate boundaries.
- Google Fonts-style UA-dependent font serving is why missing-resource refetch uses
  browser-context requests (research/clone-tech.md); the fixture font, however, is captured
  during render, which is why A15 sits in the M1 spine.
