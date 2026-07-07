# 00-product — Design Lens product definition

## Purpose

Design Lens is a plugin for BOTH Claude Code and OpenAI Codex CLI that helps developers —
especially vibe-coders who can prompt an app into existence but get generic "AI-slop" UI — build
aesthetically excellent frontends by starting from reference designs instead of generating UI
from scratch. It turns any admired page into (1) a faithful, inert, agent-editable local clone,
(2) an articulated design analysis explaining WHY the design works, and (3) a conversational
surface for customizing that clone or building a brand-new page with the same design DNA.

## Requirements

### Product identity
- The product MUST ship as one plugin named `design-lens`, version `0.1.0`, installable in both
  Claude Code and Codex CLI from this single repo (plugin root `plugin/`, marketplace at repo root).
- Both plugin manifests (`plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`)
  MUST carry version `0.1.0`, identical to `design-lens --version` output.
- All deterministic logic MUST live in the CLI (`plugin/cli/`, bundled to
  `plugin/cli/dist/design-lens.cjs`); skills MUST be thin prose procedures with no embedded logic.

### Feature 1 — Clone (reference capture)
- `design-lens clone <url>` MUST render one page in Playwright Chromium and write a
  self-contained folder mirror under `.design-lens/<slug>/` in the user's project.
- The clone MUST be inert — no JavaScript survives ("a photograph, not a program"), pretty-printed
  for reliable line-based agent edits, with every body element stamped with a stable, unique
  `data-dl-id` attribute (the addressing system for all later edits).
- CSS-in-JS output (CSSOM rules, `adoptedStyleSheets`), open shadow DOM, canvas content, and
  JS-set input state MUST be preserved in the serialized output (M2 fidelity, per ADR-008 staging).
- Assets (CSS, images, fonts, icons — including CSS-discovered refs and srcset variants) MUST be
  localized under `clone/assets/`; whatever stays remote MUST be enumerated with reasons in
  `manifest.json` and `REPORT.md`.

### Feature 2 — Designer reverse-engineering
- The `reverse-design` skill MUST produce `.design-lens/<slug>/DESIGN.md` (12-section designer
  analysis: decisions + hypothesized reasons, quantified in px/ratios/OKLCH/ms) and
  `VARIATIONS.md` (3–5 named directions with concrete token swaps), written by the agent — not
  the CLI — using CLI evidence (`tokens`, `inspect`, screenshots).

### Feature 3 — Conversational customization
- Customization MUST be agent-conversational with NO persistent edit manifest (ADR-002): the CLI
  `inspect` command prints an ephemeral element inventory as JSON to stdout; the agent edits the
  clone HTML directly anchored by `data-dl-id`; style edits append to
  `clone/assets/dl-overrides.css`; asset swaps go to `clone/assets/custom/`.
- Building a NEW page from the extracted design system (`build-from-design`) MUST copy zero
  assets, text, or logos from the clone — design principles and tokens only.

### Skills (exactly five, shared bodies for both tools)
- `clone-reference` — clone a URL from the user's request into `.design-lens/<slug>/` and summarize the capture report.
- `reverse-design` — designer-persona analysis of a clone → `DESIGN.md` + `VARIATIONS.md`.
- `inspect-elements` — live inventory of customizable elements (logo, nav, hero, CTAs) with their `data-dl-id`s.
- `customize-clone` — conversational edits to the clone (text, styles via `dl-overrides.css`, asset swaps).
- `build-from-design` — build the user's OWN page in their stack applying `DESIGN.md` principles.
- Skill bodies MUST reference only one executable path: `~/.design-lens/bin/design-lens`
  (never `${CLAUDE_PLUGIN_ROOT}`, `$ARGUMENTS`, `$1`, `{{ }}`, or backtick interpolation — ADR-004).

### v1 scope boundaries
- Clone scope MUST be one page per invocation (separate `<slug>` projects per page).
- The engine MUST target Chromium only, MUST NOT support authentication/cookies, and MUST NOT
  crawl links.

## Interfaces & contracts

- CLI commands: `clone <url>`, `tokens <projectDir>`, `inspect <projectDir>`,
  `screenshot <projectDir|--url U>`, `serve <projectDir>`, `verify <projectDir>`, `--version`.
  Human progress → stderr; machine JSON → stdout; exit 0 success (warnings allowed) / 1 fatal.
- Output root: `.design-lens/<slug>/` containing `clone/` (index.html, assets/, manifest.json),
  `screenshots/`, `tokens.json`, `REPORT.md`, and agent-written `DESIGN.md` + `VARIATIONS.md`.
- Install strings (verbatim in root README.md): Claude — `claude plugin marketplace add <repo>`
  then `claude plugin install design-lens@design-lens`; Codex — `codex plugin marketplace add
  <repo>` then `codex plugin add design-lens`.
- Runtime home: `~/.design-lens/` provisioned by the SessionStart bootstrap hook; launcher
  `~/.design-lens/bin/design-lens`.

## Out of scope (v1 — do not build, do not wander toward)

- Multi-page crawling (one page per invocation; separate projects per page).
- Authentication, cookies, paywalled content.
- Single-file HTML export — folder mirror only; `single-file-cli` is AGPL and is never vendored
  or imported (ADR-005); MAY be an external optional process in v2 only.
- MCP server (rejected: skills + CLI via shell is fully portable and costs no context tokens).
- Plugin-packaged subagents (Claude subagents / Codex TOML agents are not portable across both tools).
- Persistent edit manifest / properties.yaml write-back — explicitly rejected by the user (ADR-002).
- npm publication of the CLI package (the committed bundle is the distribution).
- Firefox and WebKit engines (Chromium only).

## Verified facts (do not re-litigate)

- Codex 0.139.0 reads BOTH `.agents/plugins/marketplace.json` (native) and
  `.claude-plugin/marketplace.json` (legacy compat), and requires `.codex-plugin/plugin.json`
  alongside `.claude-plugin/plugin.json` — verified via strings on the installed binary
  (research/gaps.txt §2, research/codex-plugin.md; ADR-003).
- Codex has NO runtime placeholder expansion in skill bodies (`$ARGUMENTS`, `$1`, `{{}}`,
  backtick interpolation are skip-markers in its importer) and does not substitute
  `${CLAUDE_PLUGIN_ROOT}` in bodies, only in hook processes (research/codex-plugin.md; ADR-004)
  — hence argument-free skills and the fixed launcher path.
- kage (the closest prior art) strips ALL JS but thereby loses CSS-in-JS
  (`insertRule`/`adoptedStyleSheets`) and shadow DOM, and leaves off-domain assets remote
  (research/kage-clone.md) — this is why Design Lens builds its own engine (ADR-001).
- `single-file-cli` 2.0.83 is AGPL (research/clone-tech.md) — single-file export is excluded and
  its code is never vendored (ADR-005).
- `@playwright/mcp` has no browser_install tool; browsers cannot be self-provisioned via MCP
  (research/gaps.txt §3) — provisioning is the bootstrap hook's job (ADR-007), and no MCP server
  is shipped.
- The user explicitly rejected a persistent edit-manifest system; the element inventory is
  ephemeral stdout JSON (ADR-002).
