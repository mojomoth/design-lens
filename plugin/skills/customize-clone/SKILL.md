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
capture viewport from `manifest.json`, then run fresh detailed inspection:

```
~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --details --pretty
```

Match the request to roles, text and measured context. Use `--id <dl-id>` at the same viewport to
inspect a precise element or follow its direct parent when a container is relevant; this includes
hidden light-DOM elements and implies details. Consult body/root measurements and font warnings.
Ask which candidate the user means only if their request and these facts cannot resolve it; give
its role, text and ID. An already-specified target does not require another selection pause.

Locate the element with a targeted read:

```
grep -n 'data-dl-id="dl-N"' .design-lens/<slug>/clone/index.html
```

Read only a window around the match. Never load the full index.html into context. Inspect output
is ephemeral stdout; do not save it or trust stale geometry after edits. When applying a direction
from VARIATIONS.md, apply only its clone-compatible token changes here. A new product's structural
adaptations belong to build-from-design; continue that requested flow instead of restructuring the
reference clone through these edit rules.

## Establish the comparison

Before each edit batch, capture and look at the current clone at the capture viewport. Use an
unused filename, incrementing the suffix for every batch:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width <width> --height <height> --dsf 1 --full-page --out .design-lens/<slug>/screenshots/customize-before-capture-1.png
```

For style, layout, text or asset changes that can affect responsive appearance, also inspect
with `--viewport 390x844` and capture the mobile baseline:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width 390 --height 844 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/customize-before-mobile-1.png
```

If the capture viewport is already 390x844, one pair covers it. These current-clone baselines
avoid attributing older customizations to the new batch. Preserve the three capture images and
all prior analysis/customization images. If comparison evidence cannot be obtained, record the
specific limit and do not later claim the edit was visually verified.

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
and rendered measurements. Counts are CSS occurrences, not visible-area shares. Apply changes
through `dl-overrides.css`; when the site defines the relevant custom property on `:root`,
override it there once instead of emitting a rule for each element. Do not change an unrelated
semantic color just because it is numerically close.

**Immutable evidence** — never remove, rename, renumber or duplicate a `data-dl-id`. Any inserted
elements receive no capture ID; address them by their own class or ID. Never edit `manifest.json`
or `REPORT.md`. Never overwrite `original-viewport.png`, `original-full.png`, `clone-full.png`
or previous screenshots; new screenshots with unused names are allowed under `screenshots/`.

## Verify and inspect the result

After every batch, run:

```
~/.design-lens/bin/design-lens verify .design-lens/<slug>
```

It must exit 0 before reporting the edit as done. On failure, fix or revert the batch. This checks
clone-format structure, not visual quality. Re-run relevant detailed inspection, then capture
the after view with exactly the baseline's viewport, DSF 1 and full-page mode:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width <width> --height <height> --dsf 1 --full-page --out .design-lens/<slug>/screenshots/customize-after-capture-1.png
```

For each responsive baseline, also capture its matched mobile result:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width 390 --height 844 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/customize-after-mobile-1.png
```

Look at every before/after pair. Check the requested change, text wrapping, alignment, clipping,
overflow, replaced-image choice and font fallback at the relevant viewports. Fix regressions and
repeat the affected checks. Use available browser tools to check affected links and controls,
including their destinations and keyboard focus. A screenshot does not validate an interaction;
report any check you cannot perform as unverified. Do not compare a viewport-only after image
with a full-page baseline, or assume a saved capture PNG's scale matches a new image. Viewing the result is required, not
an optional offer. Report what changed, the evidence inspected, format-check outcome and any
unavailable visual check in the user's language; link the new images.

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
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
