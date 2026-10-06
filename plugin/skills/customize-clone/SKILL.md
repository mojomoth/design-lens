---
name: customize-clone
description: "Edit a design-lens clone conversationally — swap the logo, change nav text, replace the hero image, adjust colors or sizes. Use when the user asks to change, replace, or customize any element of a cloned page."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

## Locate the element

Resolve the clone and target from the current request, prior returned project path, and manifest
source/capture context. Substitute that actual path for `.design-lens/<slug>/` below. Read the
capture viewports and immutable source paths from `evidence.json`, falling back to the manifest
viewport for a legacy clone. Then run fresh detailed inspection:

```
~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --all --details --pretty
```

Match the request to roles, text and measured context. Use `--id <dl-id>` at the same viewport to
inspect a precise element or follow its direct parent when a container is relevant; this includes
hidden elements and open Shadow DOM and implies details. Repeat `--id <dl-id>` to inspect several
related elements at the same viewport. Consult body/root measurements and font warnings.
Ask which candidate the user means only if their request and these facts cannot resolve it; give
its role, text and ID. An already-specified target does not require another selection pause.

Locate the element with a targeted read:

```
rg -n 'data-dl-id="dl-N"' .design-lens/<slug>/clone/index.html
```

Read only a window around the match. Never load the full index.html into context. Inspect output
is ephemeral stdout; do not save it or trust stale geometry after edits. When applying a direction
from VARIATIONS.md, apply only its clone-compatible token changes here. A new product's structural
adaptations belong to build-from-design; continue that requested flow instead of restructuring the
reference clone through these edit rules.

A clone-base build (build-from-design) applies the same text, override and asset mechanics to its
copy of `clone/` inside the target project, in every sampled variant. The study clone under
`.design-lens/<slug>/clone/` stays untouched. The bans below on editing captured CSS and deleting
captured assets protect the study clone; on the clone-base copy, captured images, fonts, icons
and media are deleted and captured stylesheets may be rewritten, as that build records. The copy
may also change `href`, `alt`, `title` and `aria-label` values and gain the attributes or script a
retained control needs; `data-dl-id` values are never removed or renumbered, and new elements carry
none. The verify, fidelity and screenshot steps below check the study clone only: for the copy,
`qa --mode clone-base` is the check.

## Establish the comparison

Before each edit batch, record the current clone's hashes and the original evidence hash. Save
an editable-clone backup outside `clone/` and all evidence paths. Read the current fidelity result:

```
~/.design-lens/bin/design-lens fidelity .design-lens/<slug> --json
```

A customized clone may already differ intentionally from its source. Keep those changes and use
current-clone before/after images to attribute this batch's effects. Treat original `evidence.json`
and its listed files, capture images, `manifest.json` and `REPORT.md` as immutable.

Inspect and capture a baseline at every viewport in `evidence.json`. For legacy clones without
evidence, use 1440x900, 768x1024 and 390x844 plus any different manifest capture size; do not claim
source fidelity. Use each captured device scale factor, and use 1 for a legacy baseline. For
each viewport and batch, choose an unused screenshot filename:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width <width> --height <height> --dsf <scale> --full-page --out .design-lens/<slug>/screenshots/customize-before-<width>-<height>-<batch>.png
```

View every baseline and record existing clipping, wrapping and font issues before editing. Keep
all earlier screenshots. If baseline evidence is unavailable, identify that viewport as unverified.
Fresh source capture, when needed for the request, goes into a new project and never replaces
an existing customized clone.

## Edit rules

**Style** (color, size, spacing, font, radius, shadow) — never edit captured CSS: not the files
under `clone/assets/<host>/…`, not `<style>` blocks in `index.html`. Append a rule to
`clone/assets/dl-overrides.css` targeting the element's ID, preceded by a one-line dated comment:

```css
/* 2026-07-08 user request: make the hero heading brand-blue */
[data-dl-id="dl-17"] {
  color: #3347ff;
}
```

Leave one blank line between entries. The file is linked last in `<head>`, so its rules win at
equal specificity. It is append-only: never reorder or rewrite earlier entries. Undo deletes
exactly that comment-plus-rule block, verbatim. If a captured rule wins on specificity, repeat
the attribute selector (`[data-dl-id="dl-17"][data-dl-id]`) to raise yours; use `!important` only
as a last resort and explain it in the entry's comment.

For an open shadow descendant, a document stylesheet cannot cross its root. Prefer a measured
exposed host custom property or part when it exists. Otherwise append a new, dated override
`<style data-dl-overrides>` inside its owning declarative shadow template, targeting the existing
ID. Preserve captured style blocks and host/descendant IDs. Record the exact new block for undo;
never claim a global ID rule affected an isolated shadow tree without measuring the result.

**Text** (nav labels, headings, copy) — edit only the HTML text node in `clone/index.html`,
leaving surrounding markup and every attribute untouched.

**Assets** (logo, hero image, icons) — put replacements in `clone/assets/custom/`, creating it
on demand, and point the element's `src`, `srcset`, or inline `url()` to `assets/custom/<file>`.
Never hotlink a remote URL or delete captured assets: they remain provenance in the manifest.
If no replacement was supplied, use a clearly identified neutral SVG for a study-only sample
when sufficient, or ask for the missing asset when it is essential to the requested change.

**Site-wide colors** — read `tokens.json`, generating it if absent with:

```
~/.design-lens/bin/design-lens tokens .design-lens/<slug>
```

Use `clusterOf` to find near-duplicate values, then confirm their actual roles with targeted CSS
and rendered measurements. Schema 2 counts are CSS declaration occurrences, not rendered or visible-area shares. Preserve
color alpha (`css` or `hex` plus `alpha`), and treat a null spacing base as unknown. Read the token
provenance, unresolved declarations and relative-unit assumptions before applying a value. Apply changes
through `dl-overrides.css`; when the site defines the relevant custom property on `:root`,
override it there once instead of emitting a rule for each element. Do not change an unrelated
semantic color just because it is numerically close.

**Immutable evidence** — never remove, rename, renumber or duplicate existing `data-dl-id` values.
If an authorized edit requires inserted elements, use unused numeric IDs above the highest ID in
the clone and source captures, and record them as clone-only additions. They do not acquire a
source identity. Never edit `evidence.json`, its listed source files, `manifest.json` or `REPORT.md`.
Never overwrite source images, `original-viewport.png`, `original-full.png`, `clone-full.png` or
prior screenshots. New screenshots use unused names. Re-generated `fidelity.json` describes the
current clone; its source evidence hash must match the baseline.

## Verify and inspect the result

After every batch, run:

```
~/.design-lens/bin/design-lens verify .design-lens/<slug>
```

It must exit 0 before reporting the edit as done. Fix a structural error introduced by the batch;
if correction is impossible, restore that batch's backup and report the unfinished request. The
format check does not measure visual fidelity.

Re-run detailed inspection at every baseline viewport. Capture and view an after image using
exactly the matching viewport, device scale factor and full-page setting:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width <width> --height <height> --dsf <scale> --full-page --out .design-lens/<slug>/screenshots/customize-after-<width>-<height>-<batch>.png
~/.design-lens/bin/design-lens fidelity .design-lens/<slug> --json
```

Check requested changes, text wrapping, alignment, clipping, overflow, replacement image selection
and fonts across the complete viewport set. Fix unintended regressions, then repeat all viewport
checks. Confirm that the source evidence hash and every source file hash remain unchanged.

Intentional edits are expected to fail source-fidelity checks where their pixels or geometry
changed. Identify those differences by viewport and element, separate them from unintended
regressions, and preserve the user's authorized result. Do not run a source-matching repair loop
that undoes requested copy, branding or layout changes, and do not alter the source evidence to
make the comparison pass. An unverified report still means some comparison could not be made;
it does not mean the requested edit failed or that the source match was established.

Use available browser tools to check affected link destinations, controls and keyboard focus.
Screenshots alone do not validate interactions. Report the changes, structural outcome, all
inspected viewports, expected source differences and unavailable checks in the user's language;
link the new images. Viewing the result is required, not an optional follow-up.

## Ship intent

When the user requests shipping, deployment or publication, run every line of the checklist
below before that action and report any remaining source brand material. Completing a local
customization alone is not a request to publish it.

## Before you ship — brand checklist
Run through every line before the user deploys anything derived from a reference:
- Logo and all brand assets replaced
- All copy rewritten in the user's own voice
- Photography replaced or licensed (font/image source hosts are listed in REPORT.md)
- Fonts licensed for the user's use
- No trademarks, mascots, or brand names remain — finish with `grep -ri "<brand-name>"` over the output
- Clone-base builds: before deploying, rewrite the retained captured markup and stylesheets or confirm the right to reuse them (they are the reference's code); local comparison builds may keep them
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
