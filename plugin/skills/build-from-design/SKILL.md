---
name: build-from-design
description: "Build a NEW page or site applying the design system extracted in DESIGN.md — the user's own content with the reference's design DNA. Use when the user wants a site like the reference for their own product, or to apply DESIGN.md or VARIATIONS.md to their project."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

1. **Require the analysis.** This skill builds from `.design-lens/<slug>/DESIGN.md`. If that file
   does not exist, run the reverse-design flow first and come back — do not improvise a design
   system from the clone markup.

2. **Ask for the user's brand basics** before writing a line of code:
   - the product or company name,
   - a one-line description of what it does,
   - the actual content for the page (headline, sections, calls to action),
   - which direction from `.design-lens/<slug>/VARIATIONS.md` they want, if that file exists.

   Their content, not the reference's. If they have not written copy yet, draft it in their voice
   and get it approved before building around it.

3. **Build in the USER'S stack.** Detect it from the project — look for a framework config, a
   `package.json`, an existing component directory — and follow the conventions already there. If
   there is no project yet, default to plain HTML and CSS. Apply DESIGN.md's `## 12. Reusable
   Principles` and its token values (color, type scale, spacing, motion), with the swaps the chosen
   variation specifies. Reproduce the reference's structural decisions — hierarchy, rhythm,
   density, where the eye lands first — not its surface.

4. **Copy ZERO assets, text, or logo files from the clone.** No images, no icons, no fonts, no
   sentences. The clone's markup may be consulted for structural ideas only. Honor DESIGN.md's
   `## 11. What NOT to Copy` section without exception; if the user asks for something it names,
   explain why and offer an original alternative.

5. **Verify by looking.** Serve the result, then photograph it:

   ```
   ~/.design-lens/bin/design-lens screenshot --url http://localhost:<port> --out build-check.png
   ```

   Compare the shot against DESIGN.md's hierarchy, spacing, and color rules — read the image, do not
   assume the CSS did what you meant. Fix what drifted and shoot again. Iterate until the page holds
   up against the analysis, then show the user.

## Before you ship — brand checklist
Run through every line before the user deploys anything derived from a reference:
- Logo and all brand assets replaced
- All copy rewritten in the user's own voice
- Photography replaced or licensed (font/image source hosts are listed in REPORT.md)
- Fonts licensed for the user's use
- No trademarks, mascots, or brand names remain — finish with `grep -ri "<brand-name>"` over the output
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
