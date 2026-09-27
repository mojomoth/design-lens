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

1. **Resolve the reference and outcome.** Use the reference, clone, and product context already
   supplied. If there is no capture, run clone-reference first, including its responsive repair
   checks. Ask only if the reference cannot be identified. An analysis-only request ends with the
   two documents; an already-requested build continues after them.

2. **Inspect source evidence first.** Read `manifest.json`, `REPORT.md`, `evidence.json`, and the
   latest `fidelity.json`. View the original viewport/full images for every captured viewport,
   then the corresponding clone and difference images named in fidelity. The standard capture
   set is 1440x900, 768x1024, and 390x844. Source snapshots, images, resource files, and observations
   under `evidence/` are immutable. Each observation ID belongs to its capture; the same dl-N at
   another width does not establish the same element.

   Record source/final URL, capture times, browser, viewport, device scale, media policy, font
   status, incomplete coverage, and unresolved differences. A legacy clone without source
   evidence remains usable as clone evidence. If recapture is needed and its URL is known, save
   a new project through clone-reference; never overwrite the old project or substitute later
   source observations into it. If capture is unavailable, label the affected conclusions
   Unavailable and continue the supported analysis.

3. **Measure and compare.** Source measurements in each capture's `observations` are the primary
   numerical evidence for the reference, even when the clone differs. The `body` member includes
   root-page content styles and geometry; element entries include their parent/children, layout,
   typography, backgrounds, image crop, pseudo-elements, and shadow-root context. Check font
   readiness, failed families and loaded faces; a family name alone does not establish the glyph
   face. Coverage excludes unmeasured iframe interiors and closed shadow roots.

   Run the following commands with the actual returned project path, repeating inspection at
   all recorded widths. Use repeated IDs to measure related components together.

   ```
   ~/.design-lens/bin/design-lens tokens <projectDir>
   ~/.design-lens/bin/design-lens inspect <projectDir> --viewport 1440x900 --all --details --pretty
   ~/.design-lens/bin/design-lens inspect <projectDir> --viewport 768x1024 --all --details --pretty
   ~/.design-lens/bin/design-lens inspect <projectDir> --viewport 390x844 --all --details --pretty
   ~/.design-lens/bin/design-lens inspect <projectDir> --viewport 390x844 --id <container-id> --id <child-id> --pretty
   ~/.design-lens/bin/design-lens fidelity <projectDir> --json
   ```

   Bare inspect preserves its visible-role inventory; `--all` includes stamped hidden elements
   and open shadow trees. Inspect is current clone evidence and writes no inventory file.
   Fidelity saves hash-bound clone observations. A nonzero fidelity result means fail or
   unverified, so read its diagnostics instead of treating it as a command transport failure.
   Do not transfer a missing mobile menu or wrong clone font into the reference's design rules.

   Read tokens schemaVersion 2 as a CSS declaration census. `provenance` records source hashes,
   relative-unit assumptions, unresolved values, and warnings. Color counts are CSS occurrences,
   not painted area. Preserve `alpha` or use the alpha-preserving `css`/`oklch` value. A nullable
   `spacing.base` is an unknown grid, not zero or an implicit 4/8px rhythm. Font usage `unknown`
   means the selector did not establish a text role. Prefer observed values over all guesses.
   Inspect relevant media queries and small HTML/CSS windows with targeted searches; never read
   the entire cloned index into context. Distinguish declared breakpoints from checked widths.

4. **Write an implementation blueprint.** Read `LENSES.md` and fill `templates/DESIGN.template.md`
   in the project. Preserve the evidence preface, `## Measured observations`, all twelve English
   heading prefixes, the six recipe tables, and the fenced CSS recipe. Write prose in the user's
   language. Label Observed-reference, Observed-clone, Inferred, Proposed, and Unavailable.

   Include concrete container constraints and grid/flex rules; heading/body/label type; spacing;
   foreground/surface/action colors including alpha; component markup order and parent/child
   relationships; responsive reflow and image crop. A developer must be able to build from these
   recipes without rediscovering the CSS. Cover meaningful body sections, cards, forms, tables,
   and web components actually present, rather than only the header and hero. If an item is
   absent, explain that with observed evidence; if it is inaccessible, mark it unavailable.

   The measured table uses exactly these columns:
   `Label | Capture | Viewport | Observation | Field | Value | Unit | Precision`.
   Use the exact capture ID, WxH, and capture-local dl-N, or `page` for document fields such as
   `rootFontSize` and `body.styles.backgroundColor`. Field examples are `rect.width`,
   `styles.fontSize`, `styles.rowGap`, and `pseudo.before.content`. Put only a finite number in
   Value for px/rem/unitless; Precision is 0–6 decimal places. For exact CSS strings use Unit css
   and Precision -; for equivalent RGBA colors use Unit color and Precision -. Convert px/rem
   only using the same capture's measured root size. Preserve alpha. Unsupported values stay
   exact CSS strings or are unavailable, never fabricated numbers.

   Include source measurements at every complete captured viewport and enough rows to support
   each recipe's numerical claims, covering at least layout, typography, and colors. Cite those
   rows from recipe tables and prose with capture, ID, and field. Observed-clone rows must match
   the latest fidelity report's current clone hash; rerun fidelity after an edit. Put interpretation
   and proposed changes outside the measured table. A failed comparison does not invalidate
   independent complete source observations. An incomplete source capture remains qualified.

5. **Derive three directions.** Fill `templates/VARIATIONS.template.md`: conservative, bold,
   and adapted to the supplied target. Tie each direction to verified rules in DESIGN. Record
   the target brief, selected direction, structural changes, and verification criteria. Use the
   user's existing preference, otherwise recommend the supported direction without another
   approval pause. When no target product exists, explicitly say not supplied, keep adaptations
   conditional, and do not invent audience, data, interactions, or commercial requirements.
   Separate clone-compatible token changes from new-build structures. Carry forward source
   assets and copy that must be replaced in new work.

6. **Validate, repair, and review meaning.** Run:

   ```
   ~/.design-lens/bin/design-lens validate-design <projectDir> --json
   ```

   It reads without editing and returns 1 for fail/unverified. Fix incorrect IDs, capture scopes,
   units, rounding, missing tables, and unsupported numerical claims, then rerun. Never modify
   source evidence to satisfy a document claim. Where evidence cannot be obtained, keep the
   unavailable explanation and report incomplete analysis; do not claim the blueprint fully
   verified. The validator checks structure and cited measurements, not the truth of design
   intent or the quality of a recipe. Independently review the blueprint against the source
   images: check representative containers, type roles, component spacing, and each responsive
   transition. If an independent reviewer is available, have them try to implement a representative
   component from the document alone and resolve the ambiguity they find.

7. **Hand off the result.** Summarize within ten lines: useful implementation rules, recommended
   direction, validation outcome and material limits, with links to DESIGN.md and VARIATIONS.md.
   Finish for analysis-only work. Continue build-from-design for an already-requested new build;
   apply only requested clone edits through customize-clone. Do not substitute a fluent design
   description for a validated, usable blueprint.
