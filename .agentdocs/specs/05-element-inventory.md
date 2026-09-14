# 05-element-inventory — design tokens & element inventory (`tokens`, `inspect`)

## Purpose

Defines the two analysis commands of the CLI (M3 milestone, ADR-008). `tokens` distills a clone's
captured CSS into `tokens.json`, the quantitative evidence the reverse-design skill cites.
`inspect` produces the ephemeral element inventory (logo, nav, hero, CTA, …) that inspect-elements
and customize-clone use to address elements by `data-dl-id`. Both operate on an existing clone
directory (`.design-lens/<slug>/`, see specs/03-clone-format.md) and never touch the live web.

## Requirements

### tokens
- `tokens <projectDir>` MUST read CSS from exactly two sources: (1) each entry in
  `<projectDir>/clone/manifest.json` `resources[]` whose `contentType` contains `text/css` or whose
  `localPath` ends in `.css`, read from disk under `clone/`; (2) each `<style>` block in
  `<projectDir>/clone/index.html`. It MUST NOT include `clone/assets/dl-overrides.css` or inline
  `style=""` attributes — tokens describe the captured design, not user edits.
- A manifest-listed CSS file missing on disk MUST produce a stderr warning and be skipped, never a crash.
- All CSS sources MUST be concatenated (manifest order, then `<style>` document order) into one string
  analyzed by a single `analyze()` call from `@projectwallace/css-analyzer`.
- Colors: each unique color from the analyzer MUST be parsed with `culori`; unparseable values,
  `transparent`, `currentColor`, and `inherit` are dropped. Clustering MUST be greedy by usage count
  descending: a color joins the first cluster whose representative is at OKLab Euclidean deltaE
  (`differenceEuclidean('oklab')`) < 0.02, else starts a new cluster. The representative (`hex`) is
  the highest-count member. Clusters MUST be sorted by OKLCH lightness descending.
- `roles` per cluster MUST be derived from the analyzer's per-property context, normalized:
  `color` → `text`; `background*` → `background`; `border*`/`outline*` → `border`; `*shadow` →
  `shadow`; `fill`/`stroke` → `fill`; anything else → `other`.
- `palette`: a cluster is neutral iff its OKLCH chroma < 0.03. `primaryGuess` = highest-count
  non-neutral cluster's hex (null if none); `neutrals` = neutral hexes, lightness descending;
  `accents` = remaining non-neutral hexes, count descending, max 6.
- `typography`: `families` from font-family declarations (generic-only stacks like `sans-serif`
  excluded); `usage` = `heading` if the family appears in a rule whose selector mentions `h1`–`h6`,
  `body` if it appears on `html`/`body`/`p` or is the most-used family, `both` if both. `faces` =
  the `src` `url()` paths of matching `@font-face` rules exactly as written in the localized CSS —
  stylesheet-relative inside an external stylesheet, `assets/…` inside an inline `<style>` block,
  absolute URL when left remote (ADR-013). `sizesPx` = distinct
  font-size values in px (rem/em converted at 16 px root; %/keywords excluded), integers, ascending.
  `scaleRatioGuess` = median of ratios between adjacent `sizesPx`, 2 decimals; null if < 3 sizes.
  `weights` = distinct numeric weights (`normal`→400, `bold`→700), ascending. `lineHeights` =
  distinct unitless values, 2 decimals, ascending.
- `spacing`: collect px values (rem/em ×16) of `margin*`/`padding*`/`gap`/`row-gap`/`column-gap`
  declarations, values > 0. `base` MUST be 8 if ≥ 50% of occurrences (count-weighted) are multiples
  of 8, else 4. `scalePx` = distinct values snapped to the nearest multiple of `base`, occurrence
  count ≥ 2, ascending, max 12 entries.
- `radii` = distinct border-radius px values ascending; any value ≥ 999px or ≥ 50% normalizes to the
  sentinel `9999`. `shadows` = distinct box-shadow strings, count descending, max 8.
- `motion`: `durationsMs` = distinct transition/animation durations as integer ms, ascending;
  `easings` = distinct timing-function strings, count descending, max 8; `keyframes` = `@keyframes`
  names in document order.
- Output: MUST always write `<projectDir>/tokens.json` (2-space pretty-printed, overwriting any
  previous run); with `--stdout` the same JSON is ALSO printed to stdout. Progress goes to stderr.
  Exit 0 on success (warnings allowed); exit 1 if `clone/index.html` or `clone/manifest.json` is missing.
- Gate anchor: run against a clone of the `basic` fixture (`plugin/cli/test/fixtures/sites/basic`),
  `tokens.json` MUST contain the `#3347ff` cluster and the fixture's font family.

### inspect
- `inspect <projectDir>` MUST serve `<projectDir>/clone/` via `lib/static-server` on an EPHEMERAL
  port (bind 127.0.0.1, port 0), open it in headless Chromium (resolved via `lib/runtime-deps`) at
  viewport 1440×900 by default (override with `--viewport WxH`), dsf 1, and measure LIVE in the page. Because it re-renders the on-disk clone
  (including `dl-overrides.css` and any HTML edits), results always reflect current edits. It MUST
  NOT read or write any cached/stored inventory or metadata file — there is none (ADR-002).
- The inventory JSON MUST go to stdout ONLY and MUST NEVER be written into the clone directory or
  anywhere under `<projectDir>` (ADR-002 — ephemeral by user decree). Human progress → stderr.
- Roles MUST be detected with the heuristics table below, evaluated in table order; an element
  already assigned a role is skipped by later roles. Confidence is deterministic: 0.9 for a role's
  first-listed pattern, −0.1 per subsequent pattern, floor 0.5.
- `logo`, `hero-heading`, `hero-image` yield at most ONE element each (best pattern, then document
  order); `nav-link`, `cta`, `footer`, `section` yield all matches (`cta` max 8, `section` max 12).
- Candidates lacking a `data-dl-id` attribute MUST be skipped with a stderr warning.
- All role candidates MUST be visible: a nonzero rendered box, painted visibility and nonzero
  opacity including ancestors. A descendant with restored `visibility: visible` remains eligible;
  offscreen elements such as footers remain eligible under their existing role rules.
- `--viewport WxH` MUST accept only positive safe integer CSS-pixel dimensions, validated before
  opening a browser/server. Skills pass the capture viewport explicitly, then a mobile viewport.
- `--kind <role>` filters output to that role only (valid values = the seven role names; invalid
  value → exit 1 with usage error). `--pretty` switches from compact single-line JSON to 2-space
  indented. An empty result for a role is NOT an error — exit 0 with whatever was found.
- Elements array ordering: table role order, then ascending numeric `data-dl-id` within a role.
- The browser and server MUST be closed before exit. Exit 1 only for: missing
  `<projectDir>/clone/index.html`, server bind failure, or browser launch/navigation failure.
- Gate anchor: on a clone of the `basic` fixture, output MUST contain `logo`, ≥ 2 `nav-link`,
  `hero-heading`, `hero-image`, and `cta`, each resolving to the fixture's unambiguous element.

## Interfaces & contracts

Command lines (skills invoke via the launcher `~/.design-lens/bin/design-lens`):

```
design-lens tokens <projectDir> [--stdout]
design-lens inspect <projectDir> [--kind logo|nav-link|hero-heading|hero-image|cta|footer|section] [--viewport WxH] [--pretty]
```

`tokens.json` schema (exact shape; all arrays may be empty, never absent):

```json
{
  "colors": [ { "hex": "#635bff", "oklch": "oklch(58% 0.23 275)", "count": 41, "roles": ["background","border"], "clusterOf": ["#635bff","#645cfe"] } ],
  "palette": { "primaryGuess": "#635bff", "neutrals": ["…"], "accents": ["…"] },
  "typography": { "families": [ { "name": "Inter", "usage": "body", "faces": ["assets/…/inter-400.woff2"] } ],
                  "sizesPx": [16, 18, 24, 40, 64], "scaleRatioGuess": 1.33, "weights": [400, 500, 700], "lineHeights": [1.2, 1.5] },
  "spacing": { "base": 8, "scalePx": [8, 16, 24, 32, 48, 64, 96] },
  "radii": [0, 8, 16, 9999], "shadows": ["…"],
  "motion": { "durationsMs": [150, 300, 600], "easings": ["cubic-bezier(.4,0,.2,1)"], "keyframes": ["fadeUp"] }
}
```

Field formats: `hex` = 6-digit lowercase (alpha stripped); `oklch` = `oklch(<L>% <C> <H>)` with L
whole percent, C 2 decimals, H whole degrees; `count` = summed occurrences of all cluster members;
`clusterOf` = member hexes, count descending; `usage` ∈ `"body" | "heading" | "both"`.

Per-role heuristics (deterministic layer; the agent adds judgment on top):

| Role | Candidate patterns (evaluated in order) |
|---|---|
| `logo` | `header img` · `[class*="logo" i]` · `a[href="/"] img, a[href="/"] svg` · first `svg`/`img` inside `header`/`[role=banner]` |
| `nav-link` | `nav a` · `[role="navigation"] a` — keep only elements whose rect top is within the top 25% of the viewport |
| `hero-heading` | first `h1` · else the visible element with the largest computed font-size having direct text, within the first viewport |
| `hero-image` | largest `img` or non-`none` `background-image` element intersecting the first viewport, by rect area |
| `cta` | `a`/`button` with `class*="btn" i` or `class*="cta" i` · else `a`/`button` with text ≤ 4 words AND background-color at OKLab deltaE > 0.15 from the body background |
| `footer` | `footer` · `[role="contentinfo"]` |
| `section` | direct children of `body`/`main` with rect height > 200 px |

`inspect` stdout schema (exact top-level shape):

```json
{ "elements": [ { "dlId": "dl-17", "role": "logo", "confidence": 0.9, "tag": "img",
    "selector": "[data-dl-id=\"dl-17\"]", "text": null, "src": "assets/…/logo.svg",
    "rect": { "x": 24, "y": 18, "width": 120, "height": 32 },
    "styles": { "color": "…", "background": "…", "fontSize": "…", "fontFamily": "…" } } ],
  "colors": "see tokens.json" }
```

Field semantics: `dlId` = the element's `data-dl-id` value; `selector` = exactly
`[data-dl-id="<dlId>"]`; `text` = collapsed/trimmed innerText, max 120 chars, null if empty;
`src` = the `src` attribute as written in the HTML for `img` (localized relative path), the
`url()` value for background-image elements, null otherwise; `rect` = getBoundingClientRect in CSS
px rounded to integers; `styles` = computed `color`, `background-color` (key `background`),
`font-size`, `font-family` as returned by `getComputedStyle`.

Modules (per ARCHITECTURE.md map): `src/commands/tokens.ts`, `src/commands/inspect.ts` (wiring);
`src/analyze/tokens.ts`, `src/analyze/inspect.ts`, `src/analyze/heuristics.ts` (pure logic —
heuristics selectors/thresholds unit-testable without a browser); `src/lib/static-server.ts` (serving).

## Out of scope

- LLM labeling and `page.ariaSnapshot()` layers — the agent reading inspect output IS the judgment
  layer in v1. No Set-of-Marks screenshot overlays.
- Image-derived palettes (node-vibrant), CDP DOMSnapshot computed-style analysis, CSS coverage.
- Any persistent inventory/manifest of editable elements, and any write-back tooling (rejected — ADR-002).
- Automatic multi-viewport aggregation; tokens export formats (Figma/Scss/CSS custom properties).
- Analyzing pages other than the local clone; both commands are offline-only.

## Verified facts

- `@projectwallace/css-analyzer` 9.9.0: `analyze(cssText)` returns 150+ metrics incl. unique colors
  with per-property context, fontFamilies, fontSizes, shadows, animation durations/timing functions,
  units, `@font-face`/`@keyframes` — research clone-tech.md §B3.
- `culori` 4.0.2 provides OKLCH conversion and deltaE distance for near-duplicate color clustering —
  clone-tech.md §B3.
- Spacing/radius scale extraction = histogram computed values, snap to the modal 4/8 px scale —
  clone-tech.md §B3.
- The layer-1 deterministic selectors (`header img`, `[class*="logo"]`, `nav a`, largest
  above-the-fold img, `btn|cta` classes, short-text high-contrast CTA) are the shipping-product
  pattern — clone-tech.md §B1.
- Stable `data-*` id stamping with a "never remove/edit" rule is Onlook's verified `data-oid`
  mechanism — clone-tech.md §B2; our `data-dl-id` is stamped at capture (specs/02-clone-engine.md).
- Element inventory is ephemeral: `inspect` prints JSON to stdout and is never written into the
  clone — ADR-002 (user-confirmed decree).
- Both `@projectwallace/css-analyzer` and `culori` are on the dependency allowlist; Chromium is
  provisioned by bootstrap, never by these commands — CONVENTIONS.md, ADR-008.
- Human progress → stderr, machine JSON → stdout, exit 0/1 — canonical contract, README.md.
