# Design Lens

**Turn reference designs into frontends for your product.**

Design Lens **0.4.0** connects reference capture, design evidence, reverse engineering, adaptation,
implementation, and measured visual/behavioral verification. 0.4.0 focuses on reference
fidelity: ranked signature devices, typeface forms, pixel-measured tone, a checked build
contract, and a `qa` command whose review images must actually be viewed. It works with Claude Code and OpenAI Codex CLI;
Cursor and OpenCode can install the skills through the channels in the [repository README](../README.md).

## Skills

Invoke with `/design-lens:<name>` in Claude Code or `$<name>` in Codex, followed by your request.

| Skill | What it does |
| --- | --- |
| `clone-reference` | Capture a reference at three viewport sizes with media posters and readiness retries, compare one editable clone against the evidence, and repair supported differences for at most three rounds. |
| `reverse-design` | Produce `DESIGN.md` with cited observations, typeface forms, a tone budget and 5–10 ranked signature devices, and `VARIATIONS.md` with scored directions and a build contract. |
| `inspect-elements` | Measure roles, exact elements and CSS selectors across several viewports in compact lite form, or in full detail, using stable IDs. |
| `customize-clone` | Edit study-copy text, imagery and styles, then check matching before/after views and affected controls. |
| `build-from-design` | Adapt supported principles to the user's product and stack (`derive`, or `clone-base` on request), build to the contract with original content/assets, and verify with `qa`. |

For example, in Claude Code:

```text
/design-lens:build-from-design Use https://example.com for typography and spacing inspiration. Build a project-management screen in this repo and check it on desktop and mobile.
```

Or in Codex:

```text
$build-from-design https://example.com의 타이포그래피와 여백을 참고해 이 저장소에 프로젝트 관리 화면을 만들고 검증까지 해줘.
```

When you request a build, the agent completes missing analysis, chooses a direction from known
context, implements, and checks the result without asking for the same approval at each step.
It asks when an essential fact or consequential choice cannot be resolved. Clone-only and
analysis-only requests stay within that scope; local implementation does not imply publication.

`DESIGN.md` records capture conditions, font and evidence limits, twelve analysis sections, and
transferable principles. Its layout, typography, color, spacing, component and responsive recipes
include CSS examples and measured observations linked to a capture and element. `VARIATIONS.md` offers three directions by default (3–5 when useful),
separates clone-compatible token changes from new-product structural adaptations, and records
the selected brief and verification results. A reference marketing page may inspire a compact
management interface; its section order and component structure do not have to be copied.

What makes a reference recognizable is recorded explicitly. `### Signature priority` ranks five to
ten devices (tone, display typeface form, grid lines, ornaments, component chrome, hero motion,
closing bands) with cited evidence. `### Typeface forms` classifies each type role by glyph form
(pixel, stencil, techno, grotesk, …) and lists open-licensed substitutes of the same form.
`### Tone budget` copies pixel-measured light/dark shares and full-bleed dark bands from
`tone.json`. In `VARIATIONS.md`, a signature-retention matrix scores every direction, the selected
direction records the hash of those tables (`Design basis`) and a `Build contract` (mode, fonts,
display fonts, dark maxima, `check:<rank>` style assertions). `validate-design` checks all of it.

Builds default to `derive`: new markup, no clone files. `clone-base`, only when you ask for it,
copies the clone into your project, deletes its captured images, fonts, icons and media, replaces
all text and imagery, and keeps the skeleton and layout stylesheets; the study clone is untouched.

`qa` checks the built page at every captured viewport: dead tabs and buttons, stand-in links,
fixed elements over controls, clipped content, icons rendered as solid blocks, numbers absent from
your content files, broken images, font and request failures, reference assets/text and brand
residue, font and tone drift against the contract, signature checks, and measured lineage. It
writes review images (tiles and REFERENCE/BUILD compare sheets) that each carry a short code;
`qa-confirm` accepts the run only when every code was read from the images. The agent then fills
`## Reference fidelity` from that run. Menus, forms, carousels and keyboard behavior are still
checked with available browser tools. `verify` alone checks clone format, not visual quality.

## CLI

The skills use `~/.design-lens/bin/design-lens`, also available for direct use. Progress goes to
stderr; command results use stdout. `clone` returns the actual `projectDir`, including any suffix
or custom output location. Use that path for later commands.

```text
design-lens clone <url>            # local capture, manifest, report and images
design-lens fidelity <projectDir> --json # compare the current clone to saved source evidence
design-lens tokens <projectDir>    # captured CSS statistics → tokens.json
design-lens inspect <projectDir>   # current visible role inventory as JSON (--lite for compact output)
design-lens tone <projectDir>      # pixel tone of source screenshots → tone.json
design-lens validate-design <projectDir> --json # read-only design, retention and contract checks
design-lens qa --dir <build> --project <projectDir> # measured build QA → <projectDir>/qa/<runId>/
design-lens qa-confirm <qaDir> --codes <c1,c2,…>   # confirm the review images were viewed
design-lens runlog .design-lens --summary          # per-phase and per-agent command timings
design-lens screenshot <projectDir> | --url <url>   # PNG of a clone or live URL
design-lens serve <projectDir>     # local preview
design-lens verify <projectDir>    # clone-format integrity; exit 1 on violation
```

The clone skill requests `--viewports 1440x900,768x1024,390x844` by default. Direct CLI calls
retain the single `--viewport 1440x900` default; explicit `--viewport` and `--viewports` cannot
be combined. Each requested size reloads the original. With `--viewports`, one editable document
contains the complete static DOM of every available sample in separate declarative open shadow
trees. CSS selects the nearest captured width, with midpoint ties choosing the larger; equal-width
samples use the same rule for height. These ranges select captured states, not recovered source
breakpoints. Only the recorded viewport pairs can earn an exact source comparison; intermediate
sizes retain captured CSS without a source-match guarantee. Missing samples remain unverified.
Useful clone flags also include `--timeout <seconds>`, `--settle <ms>`,
`--remove-selector <css>` (repeatable), `--filter-list <file>`, `--no-scroll`, and `--no-block-cookies`.
Capture stabilization: `--media <remote|poster|include>` (default `poster`: a painted video becomes
its captured frame or poster, disclosed in REPORT.md), `--lazy-images <eager|native>` (default
`eager`), `--readiness-ms <ms>` (5000) and `--readiness-retries <n>` (2), `--capture-attempts <n>`
(2) and opt-in `--freeze-timers` for pages that keep changing. Disclosures keep a capture complete;
motion is never verified.

`fidelity` renders that one clone at every saved source size with external requests blocked. It
compares viewport, full-page and major-region images plus element geometry. `pass` exits 0;
`fail` and `unverified` exit 1. Missing evidence, fonts, images, required elements or incomplete
captures prevent a full pass. A pass covers the recorded static states, not application behavior.
Intact but incomplete evidence may produce comparisons marked `diagnosticOnly`; those captures
remain `unverified` even if their available pixels match. Missing images or integrity failures
cannot serve as diagnostic source images.
The CLI measures and diagnoses; the agent repairs assets, HTML or CSS using the source evidence,
rechecks all sizes after every round, and stops after three rounds or no improvement. It restores
the best candidate and reports any remaining differences. Authorized customization may create
expected differences from the original and is not undone solely to make fidelity pass.

`evidence.json` and `evidence/` are immutable source records. `fidelity.json` is tied to the source
evidence and current clone file hashes; regenerate it after edits. Never change original evidence
to improve a result. Older clones remain usable, but without source evidence their fidelity is
`unverified`; recapture into a new project when source measurements are needed.

### Inspect actual layout

```bash
~/.design-lens/bin/design-lens inspect .design-lens/example-com --lite --viewports 1440x900,768x1024,390x844
~/.design-lens/bin/design-lens inspect .design-lens/example-com --lite --viewports 1440x900,390x844 --id dl-17 --selector ".hero h1"
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 390x844 --id dl-17 --id dl-18 --pretty
```

`--lite` returns compact elements (rect, a one-line font string, colors, box, layout, effects,
pseudo content; empty values omitted) and `--viewports` measures several sizes in one run.
Repeatable `--selector <css>` matches in the document and open shadow roots (20 matches per
selector). Use `--all --details` only when a complete stamped inventory is really needed.

Replace the example project and ID with those from your capture. Bare `inspect` retains its
1440×900, DSF-1 default and original `{elements, colors}` JSON shape. `--viewport WxH` changes
measurement size; `--details` adds computed typography, box/grid/flex values, direct parent/child
IDs, the selected image source, and page/root/body/font metadata. `--kind <role>` narrows roles.

Role results exclude hidden candidates. `--all` covers all stamped elements, including hidden
containers, body content, cards, forms, tables and open Shadow DOM. Repeated `--id` selects several
elements and implies details. `--all`, `--id` and `--kind` are mutually exclusive. Closed shadow
roots remain unavailable. Details include pseudo-elements, backgrounds, gradients, image cropping
and parent/child relationships. Follow `parentDlId` to inspect an actual layout parent; use page body metadata
when the parent has no stamped ID. Measurements reflect current edits and are not saved as an inventory.

Composed clones give every editable element a globally unique numeric `data-dl-id` and retain its
capture-qualified origin in `data-dl-source-capture` and `data-dl-source-id`. Native HTML IDs stay
inside their own shadow trees. Use the canonical IDs returned by inspection for edits; a source
`dl-N` alone does not identify a canonical element. The shared `clone/assets/dl-overrides.css` is
linked last in the document and every generated shadow tree. Append ID-scoped rules there;
inspect the relevant variant at each intended size and rerun `fidelity` after edits.
Use the generated root/body proxy IDs for root styling. The composer transforms captured source
root selectors, but newly appended `html`, `body` or `:root` overrides do not select those proxies;
unsupported root overrides are reported and prevent a fidelity pass.

An initial font request that stalls before the load event is aborted after five seconds so fallback can
render; normal stylesheet/image loading still waits for completion. Redirected font hops retain normal
browser navigation/CORS behavior and the after-load readiness check; if navigation itself fails,
the command exits 1 without returning measurements. If font readiness itself times out or is
unavailable, screenshots capture the current painted fallback with a warning, without waiting
for the same fonts again. Inspection waits up to five seconds for font readiness after navigation and warns about timeouts
or failed families. A ready font set does not prove which face painted every glyph. Token counts
are CSS occurrences, not painted-area shares; static rem/em conversions assume 16px. Use computed
measurements to check the actual component at each viewport. See the [CLI reference](./cli/README.md).

`tokens.json` uses schema version 2: colors retain alpha, transparent entries cannot become the
representative palette, and unsupported spacing bases are `null`. Provenance lists local CSS
sources (including inline declarations), unresolved values and assumptions. Declaration statistics
are distinct from source measurements; `calc()` operands are not independent spacing tokens.

`validate-design` checks required recipes, capture/observation references, numeric units and
rounding, including color alpha. It reads evidence without changing it. Observed clone claims
require a current hash-bound fidelity report. It cannot establish whether design intent is correct
or whether a new implementation reproduces the design; those require independent review and rendering.

### What a clone contains

```text
.design-lens/<slug>/
├── clone/
│   ├── index.html              # editable static DOM; sampled shadow trees with --viewports
│   ├── assets/<host>/<path>    # captured assets that could be localized
│   └── assets/dl-overrides.css # shared appended edits; CSS specificity still applies
├── manifest.json              # capture context, resource provenance and remote references
├── evidence.json              # source observations, capture conditions and file hashes
├── evidence/                  # separate DOM, assets and screenshots for each source size
├── fidelity.json              # current clone comparison bound to evidence and clone hashes
├── tone.json                  # pixel tone of each source full-page screenshot (tone command)
├── qa/<runId>/                # build QA runs: qa.json, screenshots, review images, lineage
├── REPORT.md                  # capture/fidelity warnings, font hosts and usage notice
└── screenshots/               # original viewport/full page and clone full-page capture
```

Analysis adds `tokens.json`, `DESIGN.md`, `VARIATIONS.md`, and separately named comparison images
as needed. Each command except `setup` and `runlog` also appends one line to `.design-lens/RUNLOG.jsonl` (command, agent role
from `DESIGN_LENS_AGENT`, exit code, duration, phases); it is local only, review codes are
redacted, and `DESIGN_LENS_RUNLOG=off` disables it. Capture images remain intact. Failed captures or render stages are reported; assets
may remain remote, and closed shadow roots or live application behavior may be missing.
The local clone strips scripts and inline event handlers, so it is study material rather than a
restored application. A later source screenshot can differ from the original capture's state.

## Installation and first run

Version 0.4.0 is prepared in this checkout; this guide does not claim it has been published to
GitHub releases or npm. To validate this checkout locally, run from the repository root:

```bash
npm --prefix plugin/cli ci
npm --prefix plugin/cli run build
bash plugin/scripts/bootstrap.sh
~/.design-lens/bin/design-lens --version
```

That provisions the local 0.4.0 CLI. Install or load this checkout's `plugin/` separately to use its
updated skills; runtime setup does not replace previously installed skill text.

Published installation channels remain available via the marketplace (see the repository root
`README.md` for both install blocks), and install the version currently published there. A
`SessionStart` hook then runs `scripts/bootstrap.sh`, which provisions `~/.design-lens/`: the CLI
bundle, the pinned Playwright runtime, and Chromium. It is idempotent, and it never blocks session
start — on failure it prints one actionable line to stderr and exits 0.

### Codex: trusting the hook

**Codex does not run non-managed (plugin) hooks until you trust them.** Until you do, the
`SessionStart` bootstrap silently does not fire and `~/.design-lens/bin/design-lens` will not
exist. Either:

- trust the hook interactively when Codex prompts you, via `/hooks`; **or**
- run the bootstrap yourself, once:

```bash
bash <plugin-cache-dir>/scripts/bootstrap.sh
```

Claude Code runs plugin hooks without this step.

## Fair use & respect for designers

**Reference-driven design is how designers have always worked.** Nobody learns typography, layout,
or motion from first principles in a vacuum — they study work they admire, name what makes it
good, and carry the principle (not the pixels) into something new. Architects sketch buildings.
Painters copy in galleries. Design Lens is that sketchbook, made legible to an AI agent.

**Design Lens keeps you honest by separating studying a design from shipping one.** Those are two
different activities, and this plugin refuses to blur them:

- **Studying** — `clone-reference` and `reverse-design`. Capture the page, take it apart,
  explain supported patterns and possible reasons. The clone exists to be studied.
- **Shipping** — `build-from-design` and the `## Before you ship — brand checklist`. Build new
  work from the extracted principles: no logos, no copy, no photography, no assets carried over.
  `build-from-design` is the promoted clean path, and it requires zero assets copied from the
  clone. Its opt-in `clone-base` mode keeps only the copied markup skeleton and layout
  stylesheets, which are still the reference's code: the checklist requires rewriting them or
  confirming the right to reuse them before anything is deployed. The checklist runs before you
  ship, and it ends by grepping your output for the reference's brand name — it must return nothing.

**Clones are never to be deployed or redistributed.** A clone is for private design study and
derivation, full stop. Everything inside it — content, images, logos, fonts, text — remains the
property of its owners, and Design Lens licenses none of it to you. Every clone therefore ships
with its provenance recorded: a `## License & usage notice` in `REPORT.md`, a source-URL mapping
for every asset in `manifest.json`, and the origin host of every font file so you can check its
license. The stance is transparency, not blocking: Design Lens records what it took and warns you
loudly, and it trusts you to do the right thing with it.

If you would be uncomfortable showing the original designer what you shipped, the checklist is not
finished.

## License

Design Lens is MIT licensed. Third-party bundled and runtime dependencies are enumerated in
[`NOTICE.md`](./NOTICE.md). Content captured by `clone` is **not** covered by that license and
remains the property of its owners.
