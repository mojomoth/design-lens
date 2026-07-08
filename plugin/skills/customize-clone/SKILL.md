---
name: customize-clone
description: "Edit a design-lens clone conversationally — swap the logo, change nav text, replace the hero image, adjust colors or sizes. Use when the user asks to change, replace, or customize any element of a cloned page."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry.

## Locate the element

Run `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty` and match the user's
request against each element's role and text. If two or more candidates plausibly match, ask the
user which they mean, quoting each candidate's role, text, and `dl-id`. Never guess.

Then find it in the file:

```
grep -n 'data-dl-id="dl-N"' .design-lens/<slug>/clone/index.html
```

The clone is pretty-printed, so ids land on stable lines. Read only a window around the match.
Never load the full index.html into context. Inspect output is ephemeral — it lives on stdout, is
never written into the clone, and goes stale the moment you edit. Re-run it; do not trust a list
from earlier in the conversation.

## Edit rules

**Style** (color, size, spacing, font, radius, shadow) — never edit captured CSS: not the files
under `clone/assets/<host>/…`, not `<style>` blocks in `index.html`. Append a rule to
`clone/assets/dl-overrides.css` targeting the element's id, preceded by a one-line dated comment:

```css
/* 2026-07-08 user request: make the hero heading brand-blue */
[data-dl-id="dl-17"] {
  color: #3347ff;
}
```

One blank line between entries. That file is linked last in `<head>`, so its rules win the cascade
at equal specificity. It is append-only: never reorder or rewrite earlier entries. Undoing an edit
means deleting exactly that comment-plus-rule block, verbatim. If a captured rule still wins on
specificity, raise yours by repeating the attribute selector
(`[data-dl-id="dl-17"][data-dl-id]`); reach for `!important` only as a last resort, and say so in
the entry's comment.

**Text** (nav labels, headings, copy) — edit the HTML text node directly in `clone/index.html`,
leaving the surrounding markup and every attribute untouched.

**Assets** (logo, hero image, icons) — copy the replacement into `clone/assets/custom/` (create it
on demand) and point the element's `src`, `srcset`, or inline `url()` at the relative path
`assets/custom/<file>`. If the user supplied no file, either generate a placeholder SVG into
`assets/custom/` or ask them for one — never hotlink a remote URL. Never delete captured assets:
they are provenance, and `manifest.json` maps them.

**Site-wide color changes** — read `.design-lens/<slug>/tokens.json` (run
`~/.design-lens/bin/design-lens tokens .design-lens/<slug>` first if it is absent) and use the
color's cluster so every near-duplicate usage is covered. When the site defines a CSS custom
property for that color, override the property once on `:root` in `dl-overrides.css` rather than
emitting a rule per element.

**Never** remove, rename, renumber, or duplicate a `data-dl-id` — it is the addressing system.
Elements you insert get no `data-dl-id` (ids are capture-time only); address them by their own
class or id. Never edit `manifest.json`, `REPORT.md`, or `screenshots/`.

## Verify, then show

After every batch of edits:

```
~/.design-lens/bin/design-lens verify .design-lens/<slug>
```

It must exit 0 before you report the edit as done. If it fails, fix or revert the batch — do not
report success over a failing verify. Then offer a before/after:

```
~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --out .design-lens/<slug>/screenshots/after-1.png
```

Increment the number for each subsequent shot, and compare against the original
`screenshots/clone-full.png`.

## Ship intent

When the user signals they are shipping — "ship it", "deploy", "publish", "go live" — stop and walk
every line of the checklist below, then report which items still contain original brand material.

## Before you ship — brand checklist
Run through every line before the user deploys anything derived from a reference:
- Logo and all brand assets replaced
- All copy rewritten in the user's own voice
- Photography replaced or licensed (font/image source hosts are listed in REPORT.md)
- Fonts licensed for the user's use
- No trademarks, mascots, or brand names remain — finish with `grep -ri "<brand-name>"` over the output
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
