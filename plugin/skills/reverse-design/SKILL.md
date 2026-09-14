---
name: reverse-design
description: "Reverse-engineer a reference site's design into evidence, reusable principles, and design directions in DESIGN.md and VARIATIONS.md. Use when the user asks to analyze a design, extract a style guide or design system from a site, asks why a site looks good, or needs design reasoning before building their own page. An analysis-only request ends with the analysis."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

1. **Find the reference and the requested outcome.** Use the clone and target-product context
   already named in the conversation or project. If `.design-lens/<slug>/` does not exist, run
   clone-reference first. Ask only when the reference cannot be identified. An analysis-only
   request does not authorize building a page; if this analysis is a prerequisite of a build the
   user already requested, return to that flow when the two documents are ready.

2. **Look before reading code.** View `screenshots/original-full.png` and
   `screenshots/original-viewport.png`. Write a short first impression: perceived mood, audience,
   and the first three things you notice. These are your impressions, not measured visitor
   behavior. Then view `screenshots/clone-full.png` and note visible differences from the original.

3. **Establish capture context.** Read `REPORT.md` and `manifest.json`: source/final URL,
   `source.capturedAt`, `source.viewport`, fidelity notes, missing resources, and font warnings.
   Record these limits before treating clone measurements as evidence of the reference. Saved
   original/clone images are capture-time evidence; compare matching viewport and image scale.
   Do not assume their scale is 1 merely because that is the capture default.

4. **Measure the rendered clone.** Substitute the manifest's width and height for the capture
   viewport below; inspect otherwise defaults to 1440x900, even for a differently sized capture.

   ```
   ~/.design-lens/bin/design-lens tokens .design-lens/<slug>
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --details --pretty
   ```

   Read `tokens.json` as stylesheet statistics and candidate values. Color counts count CSS
   occurrences, not painted area. Static relative-unit conversions assume 16px; palette, spacing,
   and type-scale guesses need corroboration from rendered evidence. Prefer measured styles at
   the stated viewport when values disagree; explain the difference rather than hiding it.

   Inspect supplies root/body measurements, font readiness and failed families, and each selected
   element's typography, box, and grid/flex details. Role confidence is a heuristic classification
   score, not confidence in a design explanation. Follow `parentDlId` or a targeted HTML match to
   inspect the actual container:

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --id <dl-id> --pretty
   ```

   This includes hidden elements and containers with no assigned role. Relationships are direct;
   a null parent ID means no stamped direct parent. Lookup is light DOM only, so a missing shadow
   descendant is unavailable evidence, not proof that the component does not exist. Re-run after
   edits; inspect writes no inventory file. Grep HTML/CSS for headings, landmarks, media queries,
   and state rules, reading small windows only. Never open the cloned index.html's full contents
   into context.

5. **Check responsive evidence at 390x844.** Inspect the clone at that viewport and capture both
   its first screen and whole page. Capture the source at the same viewport and scale when it is
   available. All paths below are new evidence files: increment the suffix if a name already
   exists, and never overwrite the capture's original images.

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport 390x844 --details --pretty
   ~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width <width> --height <height> --dsf 1 --out .design-lens/<slug>/screenshots/analysis-clone-capture-1.png
   ~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width 390 --height 844 --dsf 1 --out .design-lens/<slug>/screenshots/analysis-clone-mobile-viewport-1.png
   ~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width 390 --height 844 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/analysis-clone-mobile-full-1.png
   ~/.design-lens/bin/design-lens screenshot --url <URL> --width 390 --height 844 --dsf 1 --out .design-lens/<slug>/screenshots/analysis-reference-mobile-viewport-1.png
   ~/.design-lens/bin/design-lens screenshot --url <URL> --width 390 --height 844 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/analysis-reference-mobile-full-1.png
   ```

   View the images. Record the source shots as later captures with their observation time; the
   live page may have changed. New comparisons use matched viewports and explicit DSF 1. If the
   saved original's scale cannot be matched, state that limit rather than claiming pixel equality.
   If a mobile source fetch fails, continue with labeled clone evidence and mark source behavior
   unavailable. The inert clone can demonstrate retained CSS reflow, not missing JavaScript menu
   behavior or a complete responsive state. Keep `manifest.json`, `REPORT.md`, and capture
   snapshots intact throughout analysis.

6. **Turn evidence into design decisions.** Read `LENSES.md` in this skill's folder, then fill
   `templates/DESIGN.template.md` into `.design-lens/<slug>/DESIGN.md`. Include its evidence preface
   and all twelve numbered English heading prefixes. Write explanations in the user's language.
   Distinguish observed-reference, observed-clone, inferred,
   proposed, and unavailable evidence. Explain possible reasons without inventing designer intent.

   Fill `templates/VARIATIONS.template.md` into `.design-lens/<slug>/VARIATIONS.md`. Default to
   three named directions: conservative, bold, and adapted to the target product; three to five
   are allowed when useful. Separate clone-compatible token swaps from structural adaptations for
   new work. Record the target brief, selected direction, structural changes, and verification
   criteria. Respect a direction already chosen by the user; otherwise recommend one and continue
   without a mandatory choice pause. When no target product was provided, say so and make a
   conditional recommendation instead of inventing a brief. Carry forward what must be replaced:
   original assets, logos, proprietary fonts, photography, and source copy.

7. **Hand off clearly.** Summarize in at most ten lines: the most useful principles, recommended
   direction, material evidence limits, and links to the two documents. Do not paste their full
   contents. Finish here for analysis-only requests. For an already-requested build, return to
   build-from-design with the selected direction and continue; applying a token-only variation to
   the clone belongs to customize-clone.
