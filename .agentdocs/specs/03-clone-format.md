# 03-clone-format — on-disk output contract for `.design-lens/<slug>/`

## Purpose
Defines exactly what `design-lens clone` writes to disk and what every other consumer (the
`tokens`/`inspect`/`screenshot`/`serve`/`verify` commands, the five skills, and the sealed gate)
may rely on. The output is a self-contained, pretty-printed, agent-editable folder mirror — a
"photograph, not a program" (ADR-001). How the bytes are produced is the clone-engine spec
(`specs/02-clone-engine.md`); this file is the contract for what lands on disk.

## Requirements
### Location & slug
- All artifacts MUST live under `<out>/<slug>/` where `<out>` defaults to `./.design-lens`
  (relative to the invoking cwd) and is overridden by `--out <dir>`. `<slug>/` is called the
  **project dir** below.
- Slug algorithm (pure function in `plugin/cli/src/lib/slug.ts`, unit-tested): if `--project
  <name>` is given, slug = sanitize(name); else slug = sanitize(hostname with `.` → `-`), and if
  the URL has a non-empty first path segment, append `-` + sanitize(segment). Query and fragment
  are ignored. sanitize() = lowercase; chars outside `[a-z0-9-]` → `-`; collapse runs of `-`;
  trim leading/trailing `-`. Examples: `https://stripe.com` → `stripe-com`;
  `https://stripe.com/sessions/x` → `stripe-com-sessions`.
- Collision: if `<out>/<slug>` already exists, the CLI MUST use `<slug>-2`, then `<slug>-3`, …
  (first free suffix). `clone` MUST NOT overwrite or write into an existing project dir.
- The chosen absolute project dir MUST be printed to stdout in the clone command's final JSON
  (key `projectDir`), so agents and scripts can find it.

### Directory tree (files the CLI writes)
- `clone/index.html` — MUST exist on every successful clone (exit 0). Pretty-printed
  (js-beautify, indent 2, `<pre>`/`<textarea>`/`<code>` unformatted), UTF-8 with
  `<meta charset="utf-8">`, inert: zero `<script>` elements, zero `on*` attributes, zero
  `javascript:` URLs. Line 1 MUST be the provenance comment (exact template below), before the
  doctype.
- Every element in `<body>` (including elements inside serialized open shadow roots; excluding
  `script`/`style`) MUST carry a unique `data-dl-id="dl-N"` attribute (N = positive integer,
  document order). These ids are the addressing system for all agent edits and MUST survive
  beautification byte-exact.
- `clone/assets/<host>/<path>` — every localized resource, at the deterministic URL→path
  mapping owned by `specs/02-clone-engine.md` (urlmap). Every file under `clone/assets/`
  except `dl-overrides.css` and `custom/**` MUST have exactly one `resources[]` entry in
  `manifest.json`.
- `clone/assets/dl-overrides.css` — MUST be created **empty (zero bytes)** at clone time, and
  MUST be referenced by `<link rel="stylesheet" href="assets/dl-overrides.css">` as the LAST
  stylesheet-bearing element in `<head>` (after all other `<link rel=stylesheet>` and `<style>`
  elements) so appended override rules win the cascade. It is the customize-clone skill's only
  style-edit surface (ADR-002); the CLI MUST never write rules into it.
- `clone/assets/custom/` — reserved for user-supplied replacement assets. Created on demand by
  the customize-clone skill; `clone` MUST NOT create it.
- `manifest.json` — provenance record at the **project-dir root** (a sibling of `clone/`, like
  `REPORT.md`/`tokens.json`; NOT inside `clone/`), schema below. This is what sealed gate AC-07
  reads: it exists at `<projectDir>/manifest.json` and each `resources[].localPath` resolves from
  the project dir (ADR-010). Capture evidence may also record absolute source URLs outside `clone/`. All resource
  references in `clone/index.html` and rewritten CSS (src, srcset, `link href`, `url()`,
  poster, …) MUST be either a relative path under `assets/`, a `data:`/`mailto:`/fragment URL,
  or an absolute remote URL enumerated in `manifest.remote[]`. Exception: `<a href>` page
  links are left as captured (never localized).
- `screenshots/original-viewport.png` — live page at the capture viewport (default 1440×900).
- `screenshots/original-full.png` — live page, full-page.
- `screenshots/clone-full.png` — the WRITTEN clone re-rendered from disk via a local static
  server, full-page (the fidelity check). All three MUST exist after a successful clone; a
  failed clone-rerender degrades to a `report.warnings[]` entry, not a fatal error.
- `REPORT.md` — capture report at the project-dir root (NOT inside `clone/`), template below.
  MUST contain the literal heading `## License & usage notice` and its full notice text.
- `tokens.json` — project-dir root; written by the `tokens` command only (never by `clone`).
  Schema is owned by the analyze spec, not this file.

### Agent-owned files (the CLI MUST keep its hands off)
- `DESIGN.md` and `VARIATIONS.md` (project-dir root) are written by the **reverse-design skill
  (the agent)**, never by the CLI. No CLI command may create, modify, or delete them; only explicit `validate-design` requires them;
  `verify` MUST pass whether they exist or not.
- `verify <projectDir>` MUST check this format's invariants: `clone/index.html` exists and is
  parseable; provenance comment present; all `data-dl-id` values unique; `dl-overrides.css`
  exists and is linked last; `manifest.json` parses and every `resources[].localPath` exists on
  disk; no `<script>`/`on*` in the HTML. Agent edits made per ADR-002 (appending
  `[data-dl-id]` rules to dl-overrides.css, editing text nodes, adding files under
  `assets/custom/`) MUST NOT fail `verify`.

## Interfaces & contracts
### Provenance comment (line 1 of `clone/index.html`, exact template)
```html
<!-- Cloned by design-lens v0.2.0 at <capturedAt ISO-8601> for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->
```
`0.2.0` is the locked plugin/CLI version (AC-10); `<capturedAt>` matches
`manifest.source.capturedAt`. The raw source URL is intentionally NOT embedded here — the sealed
A4 assertion forbids the capture host (e.g. `127.0.0.1`) anywhere inside `clone/`, so the source
URL lives only in `manifest.source.url` and `REPORT.md` (both outside `clone/`), ADR-011.

### `manifest.json` schema (project-dir root — provenance record, NOT an edit manifest, ADR-002)
```json
{
  "version": 1,
  "tool": { "name": "design-lens", "version": "0.2.0", "playwright": "<exact pinned version>" },
  "source": { "url": "…", "finalUrl": "…", "title": "…", "capturedAt": "ISO8601",
              "viewport": { "width": 1440, "height": 900 }, "userAgent": "…", "robotsDisallowed": false },
  "resources": [ { "localPath": "clone/assets/…", "originalUrl": "…", "contentType": "…", "bytes": 0, "sha256": "…", "via": "network|css-fetch|refetch" } ],
  "remote":    [ { "url": "…", "reason": "cross-origin-iframe|oversize|media-skipped|fetch-failed", "referencedBy": "…" } ],
  "stats": { "elementsStamped": 0, "styleRules": 0, "fonts": 0, "images": 0, "cssFiles": 0, "warnings": 0 }
}
```
- `via`: `network` = captured during render; `css-fetch` = discovered inside CSS and fetched;
  `refetch` = re-fetched post-render (e.g. srcset variants). `remote[].reason` is the closed
  enum shown. `tool.playwright` = the exact pin from `.harness/config.env` (ADR-008).

### `REPORT.md` template (exact headings — gate-checked)
```
# Clone Report: <title>
## Source            (URL, capture time, viewport, robots note)
## Capture results   (table: images/fonts/css/other — count, bytes; consent blocking status)
## Left remote       (each with reason)
## Fidelity notes    (canvas converted: N; open shadow roots serialized: N; cross-origin iframes left live: N;
                      closed shadow DOM is undetectable and may be missing; JS interactivity intentionally removed;
                      recorded capture warnings, including clone-render font fallback diagnostics)
## Verify            (pass/warn summary from the verify routine)
## License & usage notice
This clone is for private design study and derivation. All content, images, logos, fonts and text
remain the property of their owners. Do not deploy or redistribute this clone. Before shipping any
work derived from it: replace the logo and all brand assets, rewrite all copy, replace or license
all photography, and check font licenses (font files and their source hosts are listed above).
```
The six `##` headings and the notice paragraph are verbatim; the parenthesized hints describe
content, not literal text.

## Out of scope
- How the clone is captured, serialized, sanitized, and localized (pipeline stages, urlmap
  path rules, degradation ladder) — `specs/02-clone-engine.md`.
- `tokens.json` and `inspect` JSON schemas — analyze-commands spec.
- Any persistent edit manifest / properties write-back (rejected, ADR-002) and single-file
  HTML export (AGPL `single-file-cli` forbidden, ADR-005).
- Multi-page crawls, authenticated pages: one page per invocation, one project dir per page.

## Verified facts
- A directory mirror with assets under a reserved per-host dir is the proven shape (kage does
  exactly this); single-file export is out (AGPL) — kage-clone.facts.txt; ADR-001, ADR-005.
- Element inventory is ephemeral stdout JSON; edits anchor on `data-dl-id`; style edits append
  to the live stylesheet `dl-overrides.css`; asset swaps go to `assets/custom/` — ADR-002
  (user-confirmed; a properties.yaml write-back system was explicitly rejected).
- The sealed gate asserts: `clone/index.html` exists; ≥ 30 unique `data-dl-id`; zero
  `127.0.0.1` refs inside `clone/` except `manifest.json`; `manifest.json` parseable and
  mapping every localized asset; `REPORT.md` contains "License & usage notice" — ACCEPTANCE.md
  AC-07 (mirror of sealed `.harness/e2e-assert.sh`).
- Both plugin manifests and the CLI `--version` are locked to `0.2.0` — ACCEPTANCE.md AC-10;
  the provenance comment and `manifest.tool.version` carry the same string.
- Pretty-printed output is what makes agent line-based edits (grep for `data-dl-id` → stable
  line windows) reliable; js-beautify chosen over prettier for tolerance of serializer-emitted
  markup — plugin-design.md §5.2 step 10.
- Human progress → stderr, machine JSON (incl. `projectDir`) → stdout, exit 0 success with
  warnings / 1 fatal — .agentdocs/README.md canonical contract.

### Additional evidence artifacts (ADR-023)
`evidence.json` indexes immutable, capture-scoped source observations and saved source files under
`evidence/`; it is not an edit manifest. Source bytes are copied independently of mutable clone
files and checksummed. Legacy projects may lack this artifact and remain structurally valid.
`fidelity.json` and versioned comparison images record findings, source/clone hashes and measured
clone observations. Old results cannot be reused after edits. Preserve the primary capture's
existing image paths and format contracts. Additional viewport assets stay separate from primary
resources; source origin URLs remain outside clone/. inspect does not write inventory state.
