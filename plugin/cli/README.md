# design-lens

**Capture references and measure the design you can actually see.**

Design Lens **0.4.0** captures a rendered reference page into an editable local snapshot and
measures its layout, typography, responsive reflow, and addressable elements. Available assets
are localized; warnings and remote-resource entries describe capture limits. Original scripts
are removed, so the result does not recreate the source application's behavior.

This package is the CLI engine of the [design-lens plugin](https://github.com/mojomoth/design-lens)
for Claude Code, OpenAI Codex CLI, Cursor, and OpenCode. Its skills turn evidence into `DESIGN.md`
and adaptable `VARIATIONS.md`, then build and verify new work when requested. The CLI itself
supplies capture and measurement; it does not generate those design documents or application code.
It also measures a built page against the reference (`qa`) and checks the documents' signature,
tone and build-contract tables (`validate-design`).

## Install

Version 0.4.0 is prepared in this repository; no GitHub release or npm publication is implied.
To test the local version, run from the repository root:

```bash
npm --prefix plugin/cli ci
npm --prefix plugin/cli run build
bash plugin/scripts/bootstrap.sh
~/.design-lens/bin/design-lens --version
```

The expected local version is `0.4.0`. Updated skills must be loaded from this checkout's
`plugin/` separately. The following public channels install their published version, which may
be older than this checkout.

Pick the channel that matches your tool (full matrix in the
[repository README](https://github.com/mojomoth/design-lens#install)):

```bash
# Claude Code / Codex — plugin channel (skills + auto-provisioning hook)
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens

# Any skills-capable agent (Claude Code, Codex, Cursor, OpenCode, …)
npx skills add mojomoth/design-lens

# Direct CLI use — no plugin system at all
npx design-lens setup        # provisions ~/.design-lens (Playwright + Chromium, one time)
npx design-lens clone https://example.com
```

## Commands

| Command | What it does |
| --- | --- |
| `clone <url>` | Capture one page with localized assets, provenance, warnings and source/clone images. |
| `fidelity <projectDir> --json` | Compare the current clone against every saved source capture; write hash-bound `fidelity.json`. |
| `tokens <projectDir>` | Write captured CSS color, typography, spacing and motion statistics to `tokens.json`. |
| `inspect <projectDir>` | Print the current visible role inventory; optional lite, selector, multi-viewport, detailed or direct-ID measurements. |
| `tone <projectDir>` | Profile each source full-page screenshot's light/mid/dark pixels and full-bleed dark bands into `tone.json`. |
| `screenshot <projectDir>` | Render a clone to PNG; use `--url <url>` instead for a live page. |
| `serve <projectDir>` | Preview the clone on a loopback server. |
| `verify <projectDir>` | Check clone-format integrity: provenance, IDs, asset paths and inertness. |
| `validate-design <projectDir> --json` | Read-only validation of design recipes, evidence references, measured values, signatures, tone, retention, build contract and reference fidelity. |
| `qa --dir <build> \| --url <url>` | Measure a built page for defects, contract drift and lineage; write a QA run with review images. |
| `qa-confirm <qaDir> --codes <list>` | Confirm a QA run's review images were viewed by matching their codes; write `review.json`. |
| `runlog <dir>` | Append phase marks to, or summarize, the local `RUNLOG.jsonl`. |
| `setup` | Provision `~/.design-lens` when no plugin hook did it. |

Use the `projectDir` returned by `clone`; repeated captures may receive suffixed names. Examples
below use an illustrative project path. Inspection prints JSON to stdout and progress/warnings
to stderr, without writing an inventory file.

## Capture and compare responsive states

```bash
~/.design-lens/bin/design-lens clone https://example.com --viewports 1440x900,768x1024,390x844
~/.design-lens/bin/design-lens fidelity .design-lens/example-com --json
```

The clone skill requests these three sizes by default. A direct `clone` command without viewport
flags still captures only 1440×900. `--viewports WxH,...` and an explicit `--viewport WxH` are
mutually exclusive. The source reloads at each size. An explicit `--viewports` request builds one
editable `clone/` with each available sample's complete static DOM in a separate declarative open
shadow tree. CSS selects the nearest recorded width; arithmetic midpoint ties choose the larger.
Samples with the same width use the same rule for height. These generated ranges are sample
selection rules, not recovered source breakpoints. Exact fidelity applies only to the recorded
viewport pairs; intermediate sizes retain authored CSS without a source-match guarantee.
Unavailable captures remain unverified and do not produce invented variants. The default source
capture budget is 90 seconds per requested size; `--timeout` sets the total source capture budget
in seconds, with the remaining budget shared among remaining sizes.

Capture stabilization flags (validated before any browser starts):

| Flag | Default | Behavior |
| --- | --- | --- |
| `--media <remote\|poster\|include>` | `poster` | `poster` replaces each painted video with its captured frame or poster (original `src` kept as `data-dl-original-src`, listed in `manifest.substituted[]`); `remote` keeps the 0.3.0 behavior; `include` (alias `--include-media`) stores media files. |
| `--lazy-images <eager\|native>` | `eager` | Promote `loading=lazy` images and frames before readiness. |
| `--readiness-ms <ms>` | 5000 | First readiness window for fonts and visible images (at least 1000); retries double it. |
| `--readiness-retries <n>` | 2 | Additional readiness windows (0–5), never consuming the reserved capture budget. |
| `--capture-attempts <n>` | 2 | Repeat a capture whose state changed during photography (1–4). |
| `--freeze-timers` | off | Suppress page timer callbacks after readiness, for pages that never stop changing. |

SMIL animations and `<marquee>` elements are paused by default. Stabilization changes are
**disclosed**, not hidden: REPORT.md lists `Substituted (not remote)` lines under `## Left remote`
and `Disclosed:` lines under `## Fidelity notes`, evidence records the policy and attempts, and
fidelity repeats disclosures per capture. Disclosures keep a capture complete; a substituted video
is compared as a still image and motion is never verified. Media that painted nothing, visible
images still pending, state changes after every attempt and iframes still make a capture incomplete.

Source records live in `evidence.json` and `evidence/`: viewport-specific observations, DOM,
assets, images, capture conditions and file hashes. IDs are scoped to their capture; a `dl-17`
in one source capture need not be the same element as `dl-17` in another. Preserve these records
when editing the clone. Resource variants are stored separately by content, and accessible frames
and `srcdoc` are made static recursively. Even accessible frame snapshots remain `unverified`
until frame-scoped child measurements are available; preserving their pixels alone cannot certify
small embedded elements. Unavailable frames or closed shadow roots remain limits.

The composed clone has globally unique numeric `data-dl-id` values. Each source-derived element
records `data-dl-source-capture` and `data-dl-source-id`; use both to trace it back to the immutable
source observation. Native HTML IDs stay local to their shadow tree. The manifest's optional
`composition` records variants, generated media conditions, element correspondence and limitations.

`fidelity` blocks external requests while rendering the current clone. It compares full-page,
first-viewport and major-region images, and matches major element positions and sizes. The fixed
policy uses pixelmatch threshold `0.1`, excludes antialiasing differences, allows at most 0.5%
image mismatch and 1% major-region mismatch, and allows at most 1 CSS px geometry difference.
Image-size differences, missing required elements/fonts/images, incomplete captures or insufficient
evidence cannot be averaged away.
When source files are intact but capture completeness is missing, available comparisons may carry
`diagnosticOnly: true`. They can help locate defects but retain `unverified` status. Missing images
and source integrity failures are never treated as usable diagnostic image evidence.

| Result | Meaning | Exit code |
| --- | --- | --- |
| `pass` | All recorded static states satisfy the comparison policy. | 0 |
| `fail` | The current clone has a detected mismatch or integrity failure. | 1 |
| `unverified` | Available evidence is insufficient for a complete comparison. | 1 |

`fidelity.json` binds the report to the source evidence hash and current clone file hashes.
Rerun after every edit; an older report does not certify changed files. The CLI measures and
reports differences. The clone skill makes evidence-based asset/HTML/CSS repairs for at most
three rounds, verifies every captured size after each round, and restores the best candidate
when improvement stops. It does not replace the page with a screenshot or relax the policy.
Requested customization may intentionally differ from the source; report those expected changes
instead of undoing them. Older clones without source evidence remain usable and return `unverified`;
collect missing source evidence by recapturing into a new project.

## Responsive and detailed inspection

```bash
~/.design-lens/bin/design-lens inspect .design-lens/example-com --lite --viewports 1440x900,768x1024,390x844
~/.design-lens/bin/design-lens inspect .design-lens/example-com --lite --viewports 1440x900,390x844 --id dl-17 --selector ".hero h1"
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 390x844 --all --details --pretty
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 1440x900 --kind hero-heading --details
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 390x844 --id dl-17 --id dl-18 --pretty
```

| Option | Behavior |
| --- | --- |
| `--viewport WxH` | Measure at positive integer CSS-pixel dimensions; default 1440×900. |
| `--details` | Add computed styles, parent/child IDs, selected image source and page metadata. |
| `--all` | Include every stamped element, including hidden elements and open Shadow DOM; with `--lite`, the visible elements of the active variant. |
| `--id dl-N` | Measure a stamped element, including open Shadow DOM; repeat for several IDs; implies details. |
| `--kind <role>` | Restrict to logo, nav-link, hero-heading, hero-image, cta, footer or section. |
| `--selector <css>` | Measure CSS selector matches in the document and every open shadow root (repeatable, at most 20 matches each); combines with `--id`, ids first. |
| `--lite` | Compact elements: `id`, `tag`, `r` (x, y, w, h), `v` (1 active, 0 inactive variant), a `family\|size/lineHeight\|weight\|letterSpacing\|transform` font string, colors and optional box, layout, effects and pseudo content; empty values omitted. |
| `--viewports <list>` | With `--lite` only: measure several sizes in one run, output `{colors, viewports:[{viewport, page, elements}]}`. |
| `--pretty` | Indent JSON instead of the default single line. |

Bare `inspect` keeps the original `{elements, colors}` shape, 1440×900 viewport and DSF 1.
Roles now exclude hidden candidates. `--viewport` alone keeps that JSON shape; `--details` and
`--id` add `page` and per-element `details`. Inspection always describes the current local clone,
including custom overrides; repeat it after edits.

For a composed clone, inspect at the intended size to identify its active sample. Use the returned
canonical IDs for edits and the source provenance for evidence lookup. Append styling changes to
`clone/assets/dl-overrides.css`, which is linked last in the document and each generated shadow
tree. An ID-scoped rule reaches that element in its own tree; changing another sampled state may
require its own ID. Preserve captured styles and source records, and rerun all recorded sizes after
changes. Original page shadow roots still require their own host/part or scoped override handling.
For root/body changes, use the generated proxy IDs returned by inspection or listed in manifest
composition. Captured source root selectors are transformed during composition; newly appended
`html`, `body` or `:root` rules do not select those proxies. Unsupported root overrides are reported
as a limitation, and any diagnostic comparison remains unverified.

`--all` excludes `--id`, `--kind` and `--selector`; `--kind` excludes `--selector`; `--viewport`
and `--viewports` are mutually exclusive. Selectors are parsed before the browser starts; an
invalid selector exits 1 with empty stdout. Without `--lite`, `--selector` returns the detailed
`--id` shape. An ID absent at one viewport yields `v: 0` or a `page.warnings` entry, not an error.
An unclassified target has `role: null` and `confidence: null`; a hidden or `display: contents`
container can still return useful style details. A missing/duplicate ID or malformed option exits
1; an empty role result exits 0. Open shadow-root descendants are included; closed roots remain unavailable.

Details include typography, box sizes and spacing, borders, grid/flex layout, overflow, visibility,
`parentDlId`, `childDlIds` and `currentSrc`, plus pseudo-elements, backgrounds, gradients, image
cropping and shadow-root context. Parent/child IDs describe direct relationships,
including hidden children. Follow a parent ID to inspect its container. `page` includes viewport,
DSF, root font size, body measurements and font readiness; body itself has no capture ID.
`currentSrc` reports the selected image separately from its editable `src` attribute.

An initial font request that stalls before the load event is aborted after five seconds so fallback can
render; normal stylesheet/image loading still waits for completion. Redirected font hops retain normal
browser navigation/CORS behavior and the after-load readiness check; if navigation itself fails,
the command exits 1 without returning measurements. If font readiness itself times out or is
unavailable, screenshots capture the current painted fallback with a warning, without waiting
for the same fonts again. Font readiness waits up to 5000ms after navigation. `page.fonts` reports `ready`, `timeout` or
`unavailable` and any `failedFamilies`; failures also produce stderr warnings. Ready means the
font-loading check settled, not proof that every glyph used the intended face. A fallback can
change wrapping and dimensions, so retain that limit when interpreting measurements.

## Interpret and verify the evidence

`tokens.json` has `schemaVersion: 2` and is a census of the current clone's CSS, including inline
style declarations. It is not an original-page measurement. Color entries expose `alpha`,
alpha-preserving `css` and `oklch` values; fully transparent colors are excluded from the palette.
`spacing.base` is `null` without supporting direct lengths for a 4px or 8px grid. Unsupported
values are not snapped to an invented scale, and `calc()` operands are not counted as lengths.
Font shorthand family/weight and the selector's target contribute to typography statistics.

Color counts are declaration occurrences, not screen area or semantic importance. `provenance`
records source files and hashes, warnings, unresolved declarations and assumptions, including
the static 16px rem/em conversion. Inactive rules and inherited values can still differ from
rendered values. Prefer source evidence for source claims and detailed clone inspection for the
current clone; keep those observation types separate.

## Validate an implementation blueprint

The agent writes `DESIGN.md` and `VARIATIONS.md`; the CLI validates them without editing either
document or the evidence:

```bash
~/.design-lens/bin/design-lens validate-design .design-lens/example-com --json
```

Keep the twelve existing `DESIGN.md` analysis sections. Include populated `### Layout recipe`,
`### Typography recipe`, `### Color roles`, `### Spacing recipe`, `### Component recipes` and
`### Responsive rules` tables, and a `### CSS recipe` with a CSS code block. The
`## Measured observations` table uses these columns:

```markdown
| Label | Capture | Viewport | Observation | Field | Value | Unit | Precision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| observed-reference | viewport-1440x900 | 1440x900 | dl-17 | styles.fontSize | 48 | px | 0 |
```

This row illustrates the format; replace every field with a value from your evidence. `Capture`
and `Viewport` must match a saved capture; `Observation` is `page` or a captured `dl-N`. Use
`observed-reference` for original measurements, `observed-clone` for current clone observations,
and `unavailable` when a needed observation cannot be obtained. Describe intentions as inferences
and new behavior as proposals in prose. Include reference measurements for every complete capture
and cover layout, typography and color.

Numeric values use separate `px`, `rem` or `unitless` units and precision 0–6; the validator checks
rounding at that precision. px/rem conversion uses the observed root font size. `css` values are
compared as strings, while `color` values are compared by RGBA including alpha; use `-` for their
precision. Source file hashes and observation references must resolve. `observed-clone` claims
also require a current fidelity report bound to the edited clone.

DESIGN.md also needs three tables. `### Typeface forms` (in section 5): `Role | Source family and
status | Form class | Form features | OFL substitutes`, with form classes such as pixel, stencil,
square-terminal, techno, grotesk or mono and substitutes written `Family (class)` sharing a class
with the row. `### Tone budget` (in section 6): `Capture | Viewport | Metric | Value | Unit |
Precision`, copying at least `darkShare` and `fullBleedDarkShare` (Unit `ratio`) per capture from
`tone.json`; a missing or stale `tone.json` makes these rows unverified. `### Signature priority`
(in section 10): `Rank | Device | Kind | Evidence | Transfer | Build check`, five to ten ranked rows
citing `capture/dl-N/field` measured rows or `tone/capture/metric` tone rows.

```markdown
| Rank | Device | Kind | Evidence | Transfer | Build check |
| --- | --- | --- | --- | --- | --- |
| 1 | Light canvas; black only as small inverse tiles | tone | tone/viewport-1440x900/fullBleedDarkShare | keep | no full-bleed dark band |
```

`VARIATIONS.md` retains three directions grounded in the observations and records the target
brief, selected direction, structural changes and verification criteria. It adds a
`## Signature retention` matrix (`Rank | Variation A | … | Drop basis`, cells `keep|adapt|
substitute|drop: treatment`), a `**Design basis:** sha256:<hex>` bullet equal to the report's
`documents.design.basisSha256`, and a `### Build contract` table (`Contract | Value | Source`:
`mode`, `fonts`, `display-fonts`, `dark-share-max`, `full-bleed-dark-max`, `stylesheets` for
clone-base, and `check:<rank>` rows such as `h1 :: font-family ~ Orbitron`: a kebab-case computed
property of the first visible match, or `count`, compared with `=`, `!=`, `~`, `!~`, `>=` or `<=`;
pseudo-element selectors never match). After build QA,
`## Reference fidelity` (`Rank | Device | Decision | Verdict | Evidence`) cites the newest
confirmed `qa/<runId>`. Quoted `Brief:`, `Content:` or `User:` clauses must appear verbatim in the
Target brief. The report (schemaVersion 2) adds `documents` (sha256 and status per document,
plus the design basis), `variationScores` and `referenceFidelity`; these deterministic scores check
consistency, not design quality. If no target product is known, leave its requirements unknown.
Validation returns `pass`, `fail` or `unverified`; only `pass` exits 0. Missing evidence is not proof of correctness. Validation checks structure and
measured claims, not the truth of design-intent interpretations or a new application's behavior;
independent implementation and rendered review remain necessary.

## Measure a build: `qa` and `qa-confirm`

```bash
~/.design-lens/bin/design-lens qa --dir ./dist --project .design-lens/example-com --content CONTENT.md --brand "Example"
~/.design-lens/bin/design-lens qa --url http://127.0.0.1:5173/ --viewports 1440x900,390x844 --content CONTENT.md
~/.design-lens/bin/design-lens qa-confirm .design-lens/example-com/qa/<runId> --codes <code-1>,<code-2>
```

`qa` needs exactly one of `--url` or `--dir` (served on a loopback port; must contain
`index.html`). Options: `--project <projectDir>` (enables reference checks; default viewports are
then the evidence capture sizes, else 1440x900,768x1024,390x844), `--mode derive|clone-base`
(default from the Build contract), repeatable `--content <file>` and `--brand <text>`,
`--viewports`, `--out`, `--max-clicks <n>` (default 40 per viewport), `--timeout <seconds>`
(default 300) and `--json`. Each run writes `qa-<epochMs>-<8 hex>` under `<projectDir>/qa/` (or
`--out`, or `.design-lens/qa/`): `qa.json`, screenshots, review images and, with `--project`,
`build-lineage.json`. validate-design only sees runs under `<projectDir>/qa/`, so do not pass
`--out` for a run you will cite. Stdout is one line with `status`, `out`, `counts` and the ordered `review`
image paths; stderr has one line per finding.

| Check | Fails on |
| --- | --- |
| `navigation` | The main document answered with HTTP 400 or above (an error page, not the build). |
| `dead-control` | Tabs, buttons or pointer-styled elements whose click changes nothing (URL, scroll, DOM, scroll or toggle events, pixels). |
| `stand-in-link` | `#`, empty or `javascript:` links, missing or self targets, ↗ on in-page links, five or more labels sharing one in-page target; a target inside a shadow root unless a click scrolls it into view. Hash routes (`#/about`) are destinations. Five or more labels sharing one bare site root is a warning. |
| `fixed-overlap` | A fixed or sticky element covering a control's centre or at least 15% of it (a warning below 15%; coverage below 5% by a bar pinned to the viewport top is not reported). |
| `horizontal-overflow`, `clipped-content` | Document overflow, or small accidental spill hidden by an ancestor's overflow clipping. |
| `solid-icon` | An image rendered as one solid block although its source has detail (an icon under an overlay is skipped, not measured). |
| `unsourced-number` | Numbers with units (months, years, people, percent, …) absent from every `--content` file. |
| `broken-image`, `font-readiness`, `request-failed` | Broken images, failed fonts, failed same-origin requests. |
| `source-asset`, `source-text`, `brand-residue` | Reference files or long reference text in the build, or `--brand` names anywhere visible. |
| `font-drift`, `tone-drift`, `signature-check` | Families outside the contract, display headings whose glyphs a platform fallback paints, dark shares above its maxima, failing `check:<rank>` rows. |
| `source-asset` (captured styles) | Inlined `style[data-dl-captured-styles]` blocks in a derive build, or in a clone-base build whose contract says `stylesheets: rewritten` (a warning when `retained`). |
| lineage | derive: clone `data-dl-id`s present; clone-base: best retained ratio below 0.3. |

The status is `fail` with any failing finding, `unverified` when a status-affecting check was
skipped (no `--content`, no valid Build contract with `--project`, the deadline, cross-origin font
network errors), else `pass`; only `pass` exits 0. Review images (tiles at the widest and
narrowest viewport, viewport shots elsewhere, and REFERENCE/BUILD compare sheets with
`--project`, both pages scaled by one factor) each carry six yellow code badges; only salted hashes
are stored. Each viewport in `qa.json` counts its click-probed `controls` (candidates, clicked,
live, dead, skipped). `qa-confirm`
normalizes the codes, writes `review.json` when all match, and otherwise reports which images were
not confirmed and exits 1. `review.json` (`qaSha256`, `confirmed`, `images`, `confirmedAt`,
`proof`) carries a proof only matching codes can produce, so a hand-written file does not count.
validate-design requires the run cited in Reference fidelity to be the newest run, to have run
with `--project`, to have no `fail`, to be confirmed, and to have checked the current Build
contract and mode (`qa.json` records both; editing the contract after qa needs a new run).

## Run log

Each command (except `setup`, `runlog`, `--version` and `--help`) appends one JSON line to
`RUNLOG.jsonl` in the nearest `.design-lens` directory enclosing its project (or the current
directory's `.design-lens` for URL-only runs): command, arguments (review codes redacted),
working directory, process ids, version, `DESIGN_LENS_AGENT`, exit code, duration and, where the
command records them, per-phase timings. `clone` logs to the `.design-lens` enclosing its `--out`
root. It
is best effort, never prints, never changes an exit code and is never transmitted.
`DESIGN_LENS_RUNLOG=off` disables it; an absolute path redirects it.

```bash
DESIGN_LENS_AGENT=analysis-helper ~/.design-lens/bin/design-lens tone .design-lens/example-com
~/.design-lens/bin/design-lens runlog .design-lens --mark build --event start
~/.design-lens/bin/design-lens runlog .design-lens --summary
```

`runlog <dir>` uses `<dir>` when it is named `.design-lens`, else its nearest `.design-lens`
ancestor, else an existing `<dir>/.design-lens`; it never creates the directory, so in a fresh
project mark a phase only after `clone` has created `.design-lens` (otherwise it exits 1). `--mark <phase> --event start|end|abort` appends a mark
(phase: lowercase letters, digits and dashes; `--note <text>` and `--tokens <n>` only with
`--mark`); `abort` closes a window whose work was interrupted, and its time is reported apart from
completed phases. `--summary`, the default, prints per-phase windows with the commands inside them,
per-command and per-agent counts, token notes and phase timings as a table on stderr, or as JSON on
stdout with `--json`. Verdict commands (`qa`, `qa-confirm`, `validate-design`, `fidelity`,
`verify`) record the status they reported, so the summary separates a non-pass verdict exit from an
error.

## Additional screenshots and application checks

For a matched mobile comparison, use equal viewport, scale and full-page mode, and new filenames:

```bash
~/.design-lens/bin/design-lens screenshot .design-lens/example-com --width 390 --height 844 --dsf 1 --full-page --out clone-mobile-1.png
~/.design-lens/bin/design-lens screenshot --url https://example.com --width 390 --height 844 --dsf 1 --full-page --out reference-mobile-1.png
```

Use unused paths and preserve capture images. The screenshot command defaults to DSF 2 and a
viewport-only image, so set comparison flags explicitly. A fresh source image is a later
observation, not the original capture. Open the images to assess fidelity: creating a PNG or
passing `verify` does not validate appearance, links, keyboard behavior or a new application's
functional states. The agent skills perform those additional checks with available tools and
report any unverified behavior.

Cloned pages are private study material. The
[fair-use policy](https://github.com/mojomoth/design-lens/blob/main/plugin/README.md#fair-use--respect-for-designers)
applies: clones are never to be deployed or redistributed. New work uses the user's own content
and assets, with source-specific brand material excluded.

## License

MIT © mojomoth. Bundled and runtime third-party licenses are enumerated in
[NOTICE.md](./NOTICE.md).
