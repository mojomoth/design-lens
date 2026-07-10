---
name: reverse-design
description: "Reverse-engineer a reference site's design like a senior designer — WHY it was designed this way — producing DESIGN.md and VARIATIONS.md. Use when the user asks to analyze a design, extract a style guide or design system from a site, or asks why a site looks good."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

1. Work from a clone. If `.design-lens/<slug>/` does not exist for the site the user named, run the
   clone-reference flow first, then continue here.

2. Gather evidence in this order. The order matters: look before you read code, or you will
   describe the markup instead of the design.

   a. **Screenshots first — vision before code.** Look at `.design-lens/<slug>/screenshots/`:
      `original-full.png` (the whole live page), `original-viewport.png` (what lands above the
      fold), `clone-full.png` (the capture's fidelity). Form your first impression here, and write
      it down before you know anything about the CSS.

   b. **Tokens.** Run `~/.design-lens/bin/design-lens tokens .design-lens/<slug>` and read
      `tokens.json`: clustered colors with usage counts, type families and sizes, the spacing
      scale, motion durations and easings.

   c. **Elements.** Run `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty` for
      the logo, nav, hero, and CTAs with their positions and computed styles.

   d. **Landmarks.** Grep the clone HTML for structure — headings, `<section>`, `<nav>`, `<footer>`,
      grid and flex containers. Read only windows around the matches. Never open the cloned
      index.html's full contents into context.

   e. **Mobile, if the responsive story matters.** One live shot at phone width:

      ```
      ~/.design-lens/bin/design-lens screenshot --url <URL> --width 390 --height 844 --out .design-lens/<slug>/screenshots/original-mobile.png
      ```

3. Adopt the senior-designer persona and run the analysis lenses described in `LENSES.md`, in this
   skill's own folder. Read that file now — it defines the lenses, the depth expected of each, and
   the standing rule that every observation must answer WHY, not merely WHAT. Then fill
   `templates/DESIGN.template.md` (also in this folder) and write the result to
   `.design-lens/<slug>/DESIGN.md`. Keep every one of its twelve numbered headings, in order,
   including `## 11. What NOT to Copy` — trademarked marks, licensed photography, brand voice.
   Cite the evidence you gathered (a token value, a screenshot region, a dl-id) rather than
   asserting taste.

4. Fill `templates/VARIATIONS.template.md` and write it to `.design-lens/<slug>/VARIATIONS.md`:
   three to five named directions that keep the reference's structural DNA while replacing its
   surface — each with the concrete swaps (color, type, density, motion) that produce it, and the
   kind of product it suits.

5. Present a ten-line executive summary in the chat: the design's intent, the two or three moves
   that make it work, the biggest risk in copying it, and where the two files were written. Do not
   paste the files into the conversation — point at them.
