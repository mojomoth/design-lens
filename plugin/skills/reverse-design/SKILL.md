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
   two documents; an already-requested build continues after them. One agent writes DESIGN.md and
   VARIATIONS.md; helpers return findings as text and prefix CLI calls with
   `DESIGN_LENS_AGENT=<role>`. Before rewriting either file, compare its validate-design
   `documents.*.sha256` with your last read and re-read when it changed. Mark the phase with
   `~/.design-lens/bin/design-lens runlog <projectDir> --mark reverse-design --event start`, and
   with `--event end` at the hand-off.

2. **Inspect source evidence first.** Read `REPORT.md` and `manifest.json`. Query `evidence.json`
   and the latest `fidelity.json` with targeted reads (status, warnings, `captures[].complete`,
   disclosures, file paths); never load them whole. View the original viewport/full images for
   every captured viewport, then the corresponding clone and difference images named in fidelity.
   The standard capture set is 1440x900, 768x1024, and 390x844. Source snapshots, images, resource
   files, and observations under `evidence/` are immutable. Each observation ID belongs to its capture; the same dl-N at
   another width does not establish the same element.

   Record source/final URL, capture times, browser, viewport, device scale, media policy, font
   status, disclosures, incomplete coverage, and unresolved differences. A legacy clone without
   source evidence remains usable as clone evidence. If recapture is needed and its URL is known,
   save a new project through clone-reference; never overwrite the old project or substitute later
   source observations into it. If capture is unavailable, label the affected conclusions
   Unavailable and continue the supported analysis.

3. **Measure and compare.** Source measurements in each capture's `observations` are the primary
   numerical evidence for the reference, even when the clone differs. Element entries include
   parent/children, layout, typography, backgrounds, image crop, pseudo-elements, and shadow-root
   context. A family name alone does not establish the glyph face. Run, with the returned project
   path and the captured viewports:

   ```
   ~/.design-lens/bin/design-lens tokens <projectDir>
   ~/.design-lens/bin/design-lens tone <projectDir>
   ~/.design-lens/bin/design-lens inspect <projectDir> --lite --viewports 1440x900,768x1024,390x844
   ~/.design-lens/bin/design-lens inspect <projectDir> --lite --viewports 1440x900,768x1024,390x844 --id <dl-id> --selector "<css>"
   ~/.design-lens/bin/design-lens fidelity <projectDir> --json
   ```

   The first lite call is the role inventory; target signature elements and their containers with
   repeated `--id` and `--selector`. Use `--all --details --viewport <WxH>` only to close a specific
   recipe gap. Inspect measures the current clone and writes nothing into the project. In a
   composed clone its IDs are canonical clone IDs: DESIGN.md cites the capture's own IDs, which
   lite elements carry as `src` (`<captureId>/<dl-N>`, from `data-dl-source-capture` and
   `data-dl-source-id`); cite `src`, not `id`. A nonzero fidelity result means fail or
   unverified; read its diagnostics. Do not transfer a missing mobile
   menu or wrong clone font into the reference's design rules.

   `tone.json` measures painted light, mid and dark pixels of each source full-page screenshot,
   including full-bleed dark bands; it is the only basis for visible area. Tokens schemaVersion 2
   is a CSS declaration census: color counts are occurrences, not painted area. Preserve `alpha`;
   a null `spacing.base` is an unknown grid. Inspect relevant media queries and small HTML/CSS
   windows with targeted searches; never read the entire cloned index into context.

4. **Write an implementation blueprint.** Read `LENSES.md` and fill `templates/DESIGN.template.md`
   in the project. Preserve the evidence preface, `## Measured observations`, all twelve English
   heading prefixes, the six recipe tables, the fenced CSS recipe, and the Typeface forms, Tone
   budget and Signature priority tables. Write prose in the user's language. Label
   Observed-reference, Observed-clone, Inferred, Proposed, and Unavailable.

   Include container constraints and grid/flex rules; heading/body/label type; spacing; colors
   with alpha; component markup order and parent/child relationships; responsive reflow and image
   crop, covering meaningful body sections, not only the header and hero. The measured table uses
   exactly `Label | Capture | Viewport | Observation | Field | Value | Unit | Precision`, with the
   exact capture ID, WxH, capture-local dl-N or `page`, finite numbers for px/rem/unitless
   (Precision 0–6), and Unit css or color with Precision - for exact strings and colors. Cite rows
   as `capture/dl-N/field`. Unsupported values stay exact CSS strings or are unavailable.

   - **Typeface forms:** view the cited element's region in the original viewport screenshot (its
     lite `r` box locates it; no crop command is needed) and classify its glyphs (terminals,
     counters, width, case, weight) into the template's form classes; list OFL substitutes as
     `Family (class)` sharing a class with the row. Include every role the build will set. At
     least one row's Role must match display, heading, headline, title or hero (in Korean:
     디스플레이, 헤드라인, 제목, 타이틀 or 히어로). Form features must describe letterforms:
     validate-design fails a cell that equals, ignoring case, quotes and whitespace, the row's
     source family or one of its substitute families, and a cell that names fewer than two
     distinct features from the English and Korean vocabulary in `LENSES.md`.
     A role that sets text in the target's language lists a substitute that covers that script,
     or says none of the same form does and how the form is adapted.
   - **Tone budget:** copy darkShare and fullBleedDarkShare for every profiled capture from
     `tone.json`, with Unit ratio and a Precision the value rounds to.
   - **Signature priority:** rank five to ten devices by how much they make the page recognizable,
     described by form: tone and dark usage, display typeface form, frame and grid lines, ornaments
     such as corner marks, component chrome such as clipped corners and carousel controls, hero and
     motion devices, closing bands. Cite measured or tone rows. What NOT to Copy never silently
     removes a ranked signature; it states how the device is adapted.

5. **Derive three directions.** Run validate-design and continue only when
   `documents.design.status` is not `fail`. Fill `templates/VARIATIONS.template.md`: conservative,
   bold, and adapted to the supplied target, each tied to verified DESIGN rules. Fill the
   `## Signature retention` matrix so the variations differ in what they retain and at least one
   scores 0.75 or more. Record the target brief, selected direction, structural changes and
   verification criteria. Use the user's existing preference, otherwise recommend the supported
   direction without another approval pause; when the brief prioritizes the reference's design
   language, recommend the highest retention score. For the selected or recommended direction,
   always record the `**Design basis:**` from `documents.design.basisSha256`, the
   `### Build contract` and planned `## Reference fidelity` rows; validate-design requires the
   first two even for analysis-only work. Copy every quoted clause into the Target brief. When no
   target product exists, say so, keep adaptations conditional, and invent no audience, data,
   interactions or commercial requirements. Carry forward source assets and copy to replace.

6. **Validate, repair, and review meaning.** Run:

   ```
   ~/.design-lens/bin/design-lens validate-design <projectDir> --json
   ```

   It reads without editing and returns 1 for fail/unverified. Fix incorrect IDs, capture scopes,
   units, rounding, missing tables, unmatched citations, retention and contract problems, then
   rerun. A `tone-report` that is unverified means `tone.json` is missing or stale: run `tone`
   again. Never modify source evidence to satisfy a document claim. Where evidence cannot be
   obtained, keep the unavailable explanation and report incomplete analysis. The validator checks
   structure and cited measurements, not design intent or recipe quality. Independently review
   the blueprint against the source images: representative containers, type roles, component
   spacing, each ranked signature and each responsive transition. If an independent reviewer is
   available, have them implement a representative component from the document alone.

7. **Hand off the result.** Summarize within ten lines: top signatures, useful implementation
   rules, recommended direction with its retention score, validation outcome and material limits,
   with links to DESIGN.md and VARIATIONS.md. Finish for analysis-only work. Continue
   build-from-design for an already-requested new build; apply only requested clone edits through
   customize-clone. Do not substitute a fluent design description for a validated, usable blueprint.
