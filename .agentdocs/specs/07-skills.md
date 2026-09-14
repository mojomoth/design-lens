# 07-skills — the five SKILL.md files

## Purpose

Skills are the agent-facing surface of Design Lens: thin prose procedures that both Claude Code
and Codex load verbatim from `plugin/skills/`. All deterministic logic lives in the CLI; a skill
orchestrates evidence gathering, product adaptation, implementation and verification. This spec fixes the
portability rules, the exact frontmatter, and the body procedure of each of the five skills.

## Requirements

### Portability (hard constraints — the sealed gate AC-12 lints these)

- There MUST be exactly five skills, each at `plugin/skills/<name>/SKILL.md`:
  `clone-reference`, `reverse-design`, `inspect-elements`, `customize-clone`,
  `build-from-design`. No other skill directories MUST exist.
- Each SKILL.md MUST be ONE shared body consumed by both tools. Per-tool variants MUST NOT exist.
- Frontmatter MUST contain exactly two keys — `name` and `description` — and no other key
  (`argument-hint`, `arguments`, `allowed-tools`, `when_to_use`, `context`, `agent`, `model`,
  `hooks`, etc. are all forbidden). `name` MUST equal the skill's directory name.
- No SKILL.md (frontmatter or body) may contain any of: `$ARGUMENTS`, `$` followed by a digit,
  `{{`, backtick-command interpolation (`` !` ``), `@`-file mentions, or the string
  `CLAUDE_PLUGIN_ROOT` — exactly the tokens the Codex importer skips; the sealed gate greps them.
- Bodies MUST be argument-free: target URLs, project slugs, and file paths come from the user's
  message ("the target URL is in the user's request"). In Claude Code, unconsumed slash-command
  arguments are auto-appended as `ARGUMENTS: <value>`, so
  `/design-lens:clone-reference https://x.com` still works with an argument-free body.
- The ONLY executable path a skill body may reference is `~/.design-lens/bin/design-lens` —
  no plugin-cache paths, `${CLAUDE_SKILL_DIR}`, repo-relative scripts, or npm/npx commands.
  Sole exception: the availability-check paragraph tells the agent to locate the installed
  plugin dir via `claude plugin list` / `codex plugin list` and run
  `bash <plugin-dir>/scripts/bootstrap.sh` (prose placeholder `<plugin-dir>`, no env var).
- Every SKILL.md body MUST open with the canonical CLI-availability-check paragraph given in
  Interfaces below, verbatim, before any numbered step.
- Descriptions MUST be written for auto-invocation matching in BOTH tools: what the skill does,
  explicit "Use when …" trigger phrasing, negative scope where it prevents misfires. Codex
  matches implicit invocation on `description` alone, so it MUST be self-contained.
- Skill bodies MUST NOT contain TODO/FIXME/stub markers (AC-04 covers `plugin/skills`).

### Per-skill content

- Each skill MUST follow its body outline in Interfaces below. In particular: `clone-reference`
  MUST include the literal closing rule "Never open the cloned index.html's full contents into
  context — it is large; use grep and targeted reads."; `inspect-elements` MUST state its output
  is a LIVE inventory, not a saved manifest, re-run after edits; `build-from-design` MUST require
  DESIGN.md, build in the USER'S stack, and copy zero assets/text/logo from the clone.
- `reverse-design` MUST ship three support files inside its folder: `LENSES.md`,
  `templates/DESIGN.template.md`, `templates/VARIATIONS.template.md`. Their contents, the 12
  required DESIGN headings (gate AC-13), and the analysis methodology are specified in spec 04
  (the `04-*.md` file in this directory); the body MUST direct the agent to read `LENSES.md` and
  fill the two templates from the skill's own folder.
- `customize-clone` MUST follow the edit rules of spec 06 (the `06-*.md` file in this directory);
  its body carries the condensed procedure only and MUST NOT restate spec 06 in full.
- `customize-clone/SKILL.md` and `build-from-design/SKILL.md` MUST each contain the brand
  checklist section from Interfaces below, with the literal heading
  `## Before you ship — brand checklist` (gate AC-14), identical text in both files.

## Interfaces & contracts

### Files

```
plugin/skills/{clone-reference,inspect-elements,customize-clone,build-from-design}/SKILL.md
plugin/skills/reverse-design/{SKILL.md, LENSES.md, templates/DESIGN.template.md, templates/VARIATIONS.template.md}
```

Invocation names: Claude `/design-lens:<name>`; Codex `$<name>`.

### Canonical CLI-availability-check paragraph (verbatim first paragraph of every body)

```
Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.
```

### Canonical brand-checklist section (verbatim in customize-clone AND build-from-design)

```
## Before you ship — brand checklist
Run through every line before the user deploys anything derived from a reference:
- Logo and all brand assets replaced
- All copy rewritten in the user's own voice
- Photography replaced or licensed (font/image source hosts are listed in REPORT.md)
- Fonts licensed for the user's use
- No trademarks, mascots, or brand names remain — finish with `grep -ri "<brand-name>"` over the output
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
```

### clone-reference — frontmatter `name: clone-reference`, `description:` "Clone a reference website into a self-contained local folder for design study. Use when the user gives a URL to clone, capture, mirror, save, or use as a design reference. Single pages only; not for whole-site crawls or pages behind logins."
Body (after the availability check): resolve URL and scope from context; capture one page with
appropriate requested options; use the CLI's returned `projectDir` rather than guessing a slug;
read manifest/REPORT and open all three source/clone images. Summarize localization, remaining
remote resources and fidelity limits. Preserve capture evidence. A clone-only request ends here;
requested analysis or new-product work continues through the corresponding skills without
repeated authorization. Closing rule (literal): "Never open the cloned index.html's full contents
into context — it is large; use grep and targeted reads."

### reverse-design — frontmatter `name: reverse-design`, `description:` "Reverse-engineer a reference site's design into evidence, reusable principles, and design directions in DESIGN.md and VARIATIONS.md. Use when the user asks to analyze a design, extract a style guide or design system from a site, asks why a site looks good, or needs design reasoning before building their own page. An analysis-only request ends with the analysis." Body outline: (1) if no clone
exists, run the clone-reference flow first; (2) look at original screenshots before reading
code, then read REPORT.md and manifest.json for capture geometry and limitations, gather tokens
and `inspect … --details --viewport WxH --pretty` evidence, using `--id` for parent containers;
(3) compare reference/clone evidence at the capture viewport and 390×844, using matching
dimensions/DSF and new filenames that preserve original captures; unavailable or later live
mobile evidence is labeled honestly, and inert clones do not prove JS-driven behavior;
(4) fill DESIGN.md's twelve sections using the observed/inferred/proposed/unavailable evidence
contract from LENSES.md; (5) fill VARIATIONS.md with three directions by default, separating
clone-compatible changes from new-product adaptations and identifying a recommendation.
An analysis-only request ends with a compact summary and artifact links. A prerequisite call
returns to the already-requested build flow without asking whether to continue. Full methodology
and template contracts: spec 04.

### inspect-elements — frontmatter `name: inspect-elements`, `description:` "Inspect a design-lens clone's live layout, typography, responsive reflow and customizable elements using stable IDs. Use when the user asks what can be changed, wants computed measurements or container relationships, or needs inspection before editing a clone. Measures the local clone, not original JavaScript behavior."
Body:
Resolve the project using conversation, returned paths and manifests; ask only when an
ambiguity remains. Read capture dimensions/limits, then use detailed inspection at that viewport
and 390×844 when responsive behavior matters. Use `--kind` for roles and `--id` for direct
light-DOM containers, including hidden elements; never combine those options. Present a compact
grouped inventory with relevant values and limitations, not raw JSON. Static token frequencies
are CSS occurrences; relative-unit estimates are not applied component measurements. This is a
LIVE inventory, not a saved manifest; re-run after edits. Continue an already-requested edit
without asking the user to select the same target again.

### customize-clone — frontmatter `name: customize-clone`, `description:` "Edit a design-lens clone conversationally — swap the logo, change nav text, replace the hero image, adjust colors or sizes. Use when the user asks to change, replace, or customize any element of a cloned page."
Body:
Follow spec 06: resolve context, inspect current detailed measurements at the relevant
viewport, locate IDs with targeted HTML reads, and capture/view the current clone before editing.
Preserve captured CSS, IDs, assets, manifest and REPORT; style changes append dated overrides,
text changes affect text nodes, and asset replacements live under `assets/custom/`. Preserve
original and earlier images, adding new unused names. Apply clone-compatible variation changes;
new-product structural adaptations belong to build-from-design. Each batch must pass structural
`verify`, fresh measurements and viewed matching before/after images at capture size plus mobile
when responsive appearance is affected. Exercise affected controls with available tools and
report unverified checks. Shipping intent triggers the canonical brand checklist.

### build-from-design — frontmatter `name: build-from-design`, `description:` "Build and verify a NEW page or interface from a reference's design principles, adapted to the user's product, content, and stack. Use when the user wants a site like a reference for their own product, or wants to apply DESIGN.md or VARIATIONS.md to a project. Continue through missing analysis, a recommended direction, implementation, and responsive verification; analysis-only requests belong to reverse-design."
Body:
Read conversation and project structure, framework, components, tokens, content and intended
tasks before asking for missing essentials. A new-page request authorizes necessary capture,
analysis, recommendation, implementation and verification. Require DESIGN.md and VARIATIONS.md,
creating or refreshing needed evidence via the other skills while preserving existing user
decisions. Use the user's chosen direction or the best-fit recommendation. Before coding, record
target brief, selected reusable principles, deliberate structural changes and planned acceptance
checks in VARIATIONS.md. Build in the USER'S existing stack/design system; default HTML/CSS in
an empty project with only necessary JavaScript. Adapt hierarchy and composition to the product's
content and tasks. Copy zero reference assets/text/logos and invent no customers/prices/results.
Implement semantic controls, meaningful destinations, relevant states and keyboard access.
Serve the result and capture AND VIEW 1440×900, 768×1024 and 390×844 at DSF 1 with new filenames.
Repair hierarchy, wrapping, density, overflow and interaction problems using available browser
tools and relevant project checks. Report unavailable checks honestly. Record actual checks and
evidence in VARIATIONS.md and return applied principles, changes, paths and limits. Keep the
result local unless publishing was explicitly requested. End with the canonical brand checklist.

## Out of scope

- LENSES.md and template file contents, and the DESIGN.md/VARIATIONS.md deliverable contract
  (spec 04). Detailed customization edit rules and dl-overrides.css semantics (spec 06).
- Claude-only skill features (`argument-hint`, `allowed-tools`, `context: fork`, skill-scoped
  hooks, `bin/` PATH, dynamic context injection); MCP servers, Claude subagents, Codex TOML
  agents (rejected as non-portable — ARCHITECTURE.md); per-tool skill copies; extra skills.

## Verified facts

- Codex has NO runtime placeholder expansion in skills; its Claude-import code
  (`codex-rs/external-agent-migration/src/lib.rs`, `has_unsupported_command_template_features()`)
  SKIPS anything containing `$ARGUMENTS`, `$<digit>`, `{{…}}`, backtick-command interpolation, or
  `@file` mentions — also confirmed via strings on the installed codex 0.139.0 binary.
  (research/codex-plugin.md §2; research/gaps.txt §2)
- Codex does NOT substitute `${CLAUDE_PLUGIN_ROOT}` in skill bodies; only hook processes receive
  `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`. (research/gaps.txt §2; ADR-004; ADR-007)
- Claude Code: if a skill body lacks `$ARGUMENTS`, invocation arguments are auto-appended as
  `ARGUMENTS: <value>` — argument-free bodies still receive the URL. (research/claude-plugin.md §2)
- `name` + `description` frontmatter is the agentskills.io common denominator; Codex invokes
  skills as flat `$name` (hence five distinct multiword names) or implicitly by `description`
  match with the in-context skill list capped at 2% of context / 8,000 chars; Claude namespaces
  them as `/design-lens:<name>`. (research/codex-plugin.md §2, §5; ADR-004)
- `~/.design-lens/bin/design-lens` is provisioned by the SessionStart bootstrap hook in both
  tools and is the only stable executable path across plugin-cache relocations. (ADR-007)
- Sealed-gate checks satisfied by this spec: AC-12 (five skills, frontmatter, forbidden-token
  grep), AC-13 (template headings, detailed in spec 04), AC-14 (brand-checklist heading).
  (ACCEPTANCE.md)
