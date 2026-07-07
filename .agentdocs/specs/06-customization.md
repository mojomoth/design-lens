# 06-customization — conversational clone editing rules

## Purpose
Defines how an agent edits a clone when the user asks to change something (logo, nav text, hero
image, colors, sizes). This layer is deliberately THIN (ADR-002): there are NO op-layer scripts,
NO apply-edit tooling, and NO persistent edit manifest — the agent edits the clone files directly,
anchored by `data-dl-id`, with `verify` as the only safety net. The `customize-clone` skill body
MUST encode every MUST in this file; the CLI ships no customization-specific code beyond the
existing `inspect`, `verify`, and `screenshot` commands.

## Requirements

### Locating elements
- The agent MUST identify the target element from a fresh (or same-conversation) run of
  `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty`, matching the user's
  request against role and text. If two or more candidates plausibly match, the agent MUST ask
  the user, quoting each candidate's role, text, and `dl-id`.
- The agent MUST locate the element in the file with
  `grep -n 'data-dl-id="dl-N"' .design-lens/<slug>/clone/index.html`. The clone is pretty-printed
  (a hard requirement of the clone pipeline), so ids land on stable lines. The agent MUST read
  only a window around the match and MUST NOT load the full `index.html` into context.
- Inspect output is ephemeral (stdout only). The agent MUST NOT write it into the clone dir and
  MUST re-run `inspect` rather than trust a stale inventory after edits.

### Edit rules (hard)
- **Style changes** (color, size, spacing, font, radius, shadow): the agent MUST NOT edit
  captured CSS — neither files under `clone/assets/<host>/…` nor `<style>` blocks in
  `index.html`. Instead it MUST append a rule to `clone/assets/dl-overrides.css` targeting
  `[data-dl-id="dl-N"]`, preceded by a one-line dated comment (template below). This file is the
  entire edit history — readable, diffable, reversible — and is linked LAST in `<head>` at clone
  time (specs/03-clone-format.md), so its rules win the cascade at equal specificity.
- `dl-overrides.css` is append-only: the agent MUST NOT reorder or rewrite earlier entries.
  Reverting an edit = deleting exactly the previously appended comment+rule block (the agent
  SHOULD do this verbatim when the user asks to undo).
- If a captured rule still wins on specificity, the agent SHOULD raise specificity by repeating
  the attribute selector (`[data-dl-id="dl-N"][data-dl-id]`) and MUST use `!important` only as a
  last resort, noting it in the entry's comment.
- **Text changes** (nav labels, headings, copy): the agent MUST edit the HTML text node directly
  in `clone/index.html`, leaving the surrounding markup and all attributes untouched.
- **Asset swaps** (logo, hero image, icons): the agent MUST copy the replacement file into
  `clone/assets/custom/` (creating it on demand) and update the element's `src`/`srcset`/inline
  `url()` reference to the relative path `assets/custom/<file>`. If the user supplied no file,
  the agent MUST either generate a placeholder SVG into `assets/custom/` or ask — never hotlink
  a remote URL. Original captured assets MUST NOT be deleted (they are provenance, mapped in
  `manifest.json`).
- **`data-dl-id` attributes are IMMUTABLE**: the agent MUST NOT remove, rename, renumber, or
  duplicate them — they are the addressing system. Elements the agent inserts MUST NOT be given
  a `data-dl-id` (ids are capture-time only); address new elements via their own class/id.
- **Site-wide color changes**: the agent MUST consult `tokens.json` (running
  `~/.design-lens/bin/design-lens tokens .design-lens/<slug>` first if absent) to find the
  color's cluster (`clusterOf`) so every near-duplicate usage is covered, then override via
  `dl-overrides.css`. When the site defines CSS custom properties for that color, the agent
  SHOULD override the custom property on `:root` in `dl-overrides.css` instead of emitting
  per-element rules.
- `manifest.json`, `REPORT.md`, and `screenshots/` MUST NOT be edited by the customization flow.

### Verification loop
- After every batch of edits the agent MUST run
  `~/.design-lens/bin/design-lens verify .design-lens/<slug>` and it MUST exit 0 before the agent
  reports the edit as done; on failure the agent MUST fix or revert the batch.
- After a passing verify the agent MUST offer a before/after comparison:
  `~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --out .design-lens/<slug>/screenshots/after-<n>.png`
  (monotonically increasing `<n>`), compared against the existing `screenshots/clone-full.png`.

### Ship intent
- If the user signals shipping intent ("ship it", "deploy", "publish", "go live"), the agent MUST
  run the pre-ship brand checklist (exact heading `## Before you ship — brand checklist`, defined
  in specs/10-ethics.md; its presence in `customize-clone/SKILL.md` is gate AC-14) and report
  which items still contain original brand material.

## Interfaces & contracts
- Commands used (the launcher is the ONLY executable path, per ADR-004):
  - `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty`
  - `~/.design-lens/bin/design-lens tokens .design-lens/<slug>`
  - `~/.design-lens/bin/design-lens verify .design-lens/<slug>`
  - `~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --out <file>`
  - `grep -n 'data-dl-id="dl-N"' .design-lens/<slug>/clone/index.html`
- `clone/assets/dl-overrides.css` entry template (one blank line between entries):

  ```css
  /* 2026-07-08 user request: make the hero heading brand-blue */
  [data-dl-id="dl-17"] {
    color: #3347ff;
  }
  ```

- Paths owned by this flow: `clone/assets/dl-overrides.css` (created EMPTY at clone time, linked
  last in `<head>` — see specs/03-clone-format.md), `clone/assets/custom/` (created on demand).

## Out of scope
- Op-layer scripts, apply-edit commands, or any CLI subcommand dedicated to editing (ADR-002).
- Persistent edit manifests (properties.yaml or similar — explicitly rejected by the user).
- Editing captured CSS, re-capturing the page, or multi-page edits.
- Building new pages from the design system (that is the `build-from-design` skill).
- Undo tooling beyond deleting appended `dl-overrides.css` blocks / reverting text edits.

## Verified facts
- The user explicitly rejected a properties.yaml write-back system; inventory is ephemeral stdout
  JSON; edits anchor on `data-dl-id`; style edits append to `dl-overrides.css`; asset swaps go to
  `clone/assets/custom/`; no op-layer scripts. (DECISIONS.md ADR-002)
- Codex skills have NO runtime placeholder expansion (`$ARGUMENTS`, `$1-$9`, `{{}}`, backtick
  interpolation are skipped by its importer) and `${CLAUDE_PLUGIN_ROOT}` is not substituted in
  skill bodies — so the skill encoding these rules is argument-free and references only
  `~/.design-lens/bin/design-lens`. (research/codex-plugin.facts.txt; DECISIONS.md ADR-004)
- `clone/index.html` links `assets/dl-overrides.css` LAST in `<head>` so override rules win the
  cascade at equal specificity; the file is written empty by the clone pipeline.
  (design/plugin-design.md §4; specs/03-clone-format.md)
- Pretty-printed output is a hard clone-pipeline requirement precisely because it makes
  line-anchored agent edits (grep -n + windowed reads) reliable. (design/plugin-design.md §5.2
  stage 10)
- Agent-edit safety is e2e-tested: appending a `[data-dl-id]` rule to `dl-overrides.css` plus one
  text-node edit must leave `verify` exiting 0. (design/plugin-design.md §10 AC5)
- `customize-clone/SKILL.md` must contain the exact heading
  `## Before you ship — brand checklist`. (ACCEPTANCE.md AC-14)
