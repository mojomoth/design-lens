# 07-skills — the five SKILL.md files

## Purpose

Skills are the agent-facing surface of Design Lens: thin prose procedures that both Claude Code
and Codex load verbatim from `plugin/skills/`. All deterministic logic lives in the CLI; a skill
only says which launcher commands to run and how to present results. This spec fixes the
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

### clone-reference — frontmatter `name: clone-reference`, `description:` "Clone a reference
website into a self-contained local folder for design study. Use when the user gives a URL to
clone, capture, mirror, save, or use as a design reference. Single pages only; not for
whole-site crawls or pages behind logins." Body (after the availability check):
1. The target URL is in the user's request; if none was given, ask for one.
2. From the project root run `~/.design-lens/bin/design-lens clone <URL>` (add `--project <name>`
   if the user named the project; add `--remove-selector <css>` for elements to exclude).
3. Read `.design-lens/<slug>/REPORT.md`. Summarize: what was localized, what stayed remote and
   why, any fidelity warnings. Show `clone-full.png` vs `original-full.png` if asked.
4. Remind the user in one sentence: the clone is for design study; brand assets must be replaced
   before shipping anything derived.
5. Offer next steps: reverse-design (design analysis → DESIGN.md), inspect-elements,
   customize-clone.
Closing rule (literal): "Never open the cloned index.html's full contents into context — it is
large; use grep and targeted reads."

### reverse-design — frontmatter `name: reverse-design`, `description:` "Reverse-engineer a
reference site's design like a senior designer — WHY it was designed this way — producing
DESIGN.md and VARIATIONS.md. Use when the user asks to analyze a design, extract a style guide
or design system from a site, or asks why a site looks good." Body outline: (1) if no clone
exists, run the clone-reference flow first; (2) gather evidence in order — screenshots first
(vision before code), then the `tokens` command, then `inspect … --pretty`, then grep the clone
HTML for landmarks, optionally a mobile view via
`~/.design-lens/bin/design-lens screenshot --url <URL> --width 390 --height 844`; (3) adopt the
senior designer persona per `LENSES.md` in this skill's folder, fill
`templates/DESIGN.template.md` → `.design-lens/<slug>/DESIGN.md`; (4) fill
`templates/VARIATIONS.template.md` → `VARIATIONS.md`; (5) present a 10-line executive summary
in chat, don't dump the files. Full methodology and template contracts: spec 04.

### inspect-elements — frontmatter `name: inspect-elements`, `description:` "List the
customizable elements of a design-lens clone (logo, nav, hero, CTAs, colors, fonts) with their
stable ids. Use when the user asks what can be changed or customized in a clone, or before
making edits." Body: run `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty`;
present a compact grouped list (role → short description → dl-id); point at `tokens.json` for
colors/fonts (run the `tokens` command if missing); state that this is a live inventory, not a
saved manifest — re-run it after edits; invite the user to pick elements and hand off to
customize-clone.

### customize-clone — frontmatter `name: customize-clone`, `description:` "Edit a design-lens
clone conversationally — swap the logo, change nav text, replace the hero image, adjust colors
or sizes. Use when the user asks to change, replace, or customize any element of a cloned page."
Body: locate the element via inspect (ask if ambiguous, quoting candidates); find it with
`grep -n 'data-dl-id="dl-N"' .design-lens/<slug>/clone/index.html` and read only a window around
the match; apply the spec-06 edit rules (styles append `[data-dl-id="…"]` rules to
`clone/assets/dl-overrides.css` with a dated comment — never edit captured CSS; text edits go
directly in the HTML; asset swaps go to `clone/assets/custom/`; never remove or change a
`data-dl-id`); after every batch run `~/.design-lens/bin/design-lens verify .design-lens/<slug>`
and offer a before/after via the `screenshot` command; on "ship it"/"deploy", walk the canonical
brand-checklist section, which ends the file.

### build-from-design — frontmatter `name: build-from-design`, `description:` "Build a NEW page
or site applying the design system extracted in DESIGN.md — the user's own content with the
reference's design DNA. Use when the user wants a site like the reference for their own product,
or to apply DESIGN.md or VARIATIONS.md to their project." Body: (1) requires
`.design-lens/<slug>/DESIGN.md` — run the reverse-design flow first if missing; (2) ask for the
user's brand basics: name, one-liner, actual content, preferred variation from VARIATIONS.md;
(3) build in the USER'S stack (detect it; default plain HTML/CSS), applying DESIGN.md's
Reusable Principles and tokens with the chosen variation's swaps; (4) copy ZERO assets, text, or
logo files from the clone — clone markup may be consulted for structural ideas only — and honor
DESIGN.md's "What NOT to Copy" section; (5) verify by screenshotting the result
(`~/.design-lens/bin/design-lens screenshot --url http://localhost:<port> --out <file>`) and
checking it against DESIGN.md's hierarchy, spacing, and color rules; iterate. Ends with the
canonical brand-checklist section.

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
