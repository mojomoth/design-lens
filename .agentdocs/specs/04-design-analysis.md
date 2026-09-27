# 04-design-analysis — designer reverse-engineering

## Purpose

Defines how `reverse-design` turns a reference clone (`.design-lens/<slug>/`, spec 03) into an
evidence-based `DESIGN.md` and adaptable `VARIATIONS.md`. These artifacts support clone
customization and new work for the user's product. The CLI supplies screenshots, CSS statistics
and live measurements; the agent explains design choices, separates observation from inference,
and records the target design and verification brief. The sealed AC-13 gate checks template anchors.

## Requirements

### Files and portability

- Ship exactly four files: `plugin/skills/reverse-design/SKILL.md`, `LENSES.md`,
  `templates/DESIGN.template.md` and `templates/VARIATIONS.template.md` inside that skill folder.
- SKILL.md frontmatter contains only `name: reverse-design` and `description`. The description
  covers analyzing a design, extracting a style guide/design system from a site, and explaining
  why a site looks good; it also describes the two resulting artifacts.
- Follow the argument-free, executable-path and canonical availability-paragraph contracts in
  spec 07. Target URLs, clone paths and product intent come from the conversation, not runtime
  argument interpolation. The canonical launcher is `~/.design-lens/bin/design-lens`.

### Procedure (required behavior; prose and step numbering may vary)

1. Resolve the reference and existing clone from context. Run clone-reference if needed. Carry
   forward the user's target product, content, stack and build intent from the conversation and
   repository. Ask only for missing essentials that cannot be discovered. Known information and
   a request to build must not trigger a compulsory questionnaire or variation-selection pause.
2. Gather evidence in this order, preserving vision before code:
   - First view `screenshots/original-full.png`, `original-viewport.png` and `clone-full.png`.
     Form the initial impression before reading tokens or markup, and identify capture differences.
   - Read `manifest.json` and `REPORT.md` for source, capture time, viewport, remote resources
     and warnings. Preserve all three capture PNGs and previous analysis images. Any new screenshot
     uses an unused descriptive filename with an increasing suffix.
   - Run `tokens` and read `tokens.json` as statistics over captured CSS.
   - Run `inspect --details --viewport <capture-width>x<capture-height> --pretty` and
     `inspect --details --viewport 390x844 --pretty` through the canonical launcher. Use roles
     to locate elements, then `--id dl-N` for relevant containers outside the role vocabulary.
     Follow direct `parentDlId` values to measure grid/flex parents; consult `childDlIds`,
     `page.rootFontSize`, `page.body` and `page.fonts`. Body itself has no stamped ID.
   - Read small grep windows around IDs, landmarks, headings, named CSS variables, media/container
     conditions and transition/animation rules. Confirm applicable declarations with the computed
     measurements rather than treating every captured rule as active.
   - Gather reference and clone screenshot evidence at the capture desktop viewport and at
     390×844. Compare matching reference/clone views and record discrepancies. Fresh pairs use
     the same viewport, full-page/viewport mode and explicit `--dsf 1`; never overwrite capture PNGs.
     The saved original/clone capture pair is historical evidence. Do not assume an original PNG's
     DSF from the manifest, which records only CSS viewport dimensions. If matching scale cannot
     be established, mark comparison limits or take a separately named and dated fresh desktop
     reference/clone pair. Do not claim an unmatched image proves fidelity.
3. Read the skill's `LENSES.md`, fill `templates/DESIGN.template.md`, and write `DESIGN.md` in the
   clone project root. Keep all 12 numbered prefixes in order, including sections without evidence.
4. Fill `templates/VARIATIONS.template.md` and write `VARIATIONS.md` in the same root. Produce
   three named directions by default; 3–5 are allowed when useful. Include conservative and bold
   options. Separate clone-compatible token changes from structural adaptations for a new product.
5. Present at most ten lines in chat with signature moves, palette/type, recommended direction,
   the largest limitation and artifact paths. Do not paste the full documents. For an already
   requested build, continue into build-from-design and verification without a mandatory pause.
   For analysis-only requests, deliver the artifacts and identify the appropriate next step.

Never open the full cloned `index.html` into context; use grep and targeted reads. Inspection
JSON remains ephemeral stdout, not a saved inventory. Direct ID inspection can measure hidden
elements but only in light DOM; missing shadow-root evidence is not proof that a component is absent.

Desktop and mobile evidence are required, or the corresponding facts must be marked unknown with
the reason they could not be obtained. A clone-only mobile screenshot demonstrates the clone's
response, not the source's. A live mobile image taken later may show changed content, consent UI
or another state; record its time and these differences. Structural `verify` passing does not
establish visual fidelity. Missing evidence alone does not require abandoning an authorized build;
record the limit and choose explicitly proposed behavior where the target requirements allow it.

### Evidence and interpretation

Use these five explicit labels throughout both artifacts:

| Label | Meaning |
| --- | --- |
| `observed-reference` | Directly seen reference screenshots, with capture time and viewport. |
| `observed-clone` | Current clone render, computed measurement, DOM or inspected captured CSS declaration. |
| `inferred` | A hypothesized reason, design intent or generalization beyond the observation. |
| `proposed` | A new choice for the user's product, including intended behavior and verification criteria. |
| `unavailable` | Missing evidence or an unknown fact; state what was unavailable and why. |

- Pair an observed design choice with a hypothesized reason, labeling the reason as inference.
  Quantify measurable claims in px, ratios, hex/OKLCH or ms and cite their viewport and evidence
  location: screenshot filename/region, token key, stamped ID or targeted CSS rule. Qualitative
  impressions may remain qualitative; never invent a measurement to satisfy a template.
- CSS color counts are declaration occurrences, not painted-area percentages, semantic importance
  or proof of a 60–30–10 distribution. Keep CSS occurrence share distinct from visual estimates.
- Token font sizes, spacing bases and scale ratios are heuristics over captured CSS. Their 16px
  rem/em conversion is not an actual root or inherited font metric. Variables, inactive conditions,
  unused rules, inline styling and current edits can make statistics differ from rendered values.
  Prefer computed measurements for the actual component and keep unresolved values unknown.
- Record font readiness and failed families from `page.fonts`, together with REPORT warnings.
  A ready font set or computed family stack does not prove which face painted every glyph.
  Timeout, failed or unavailable font evidence must remain visible as a fallback/metric limitation.
- The clone is inert (ADR-001). Captured transitions, keyframes and hover rules establish declared
  CSS, not original JS triggers, scroll behavior, menus or interactive states. Unobserved behavior
  remains unknown; rationale may be inferred and the new product's intended behavior proposed.
- Source-specific logos, mascots, proprietary imagery, copy and brand assets remain excluded
  from new work. Do not present an unmeasured contrast ratio, inaccessible choice or unresolved
  font license as verified merely because it appears in a reference.

## Interfaces & contracts

### DESIGN template and output

Before the numbered sections, include `## Evidence and capture context` with Source, Captured at,
Capture viewport, Analysis viewports, Capture/clone differences, Font status and Missing evidence.
Explain the five evidence labels here. Keep capture-time differences, unverified responsiveness
and font fallback visible in this preface. Field wording may vary while these facts remain explicit.

The following 12 numbered prefixes are exact anchors in the template and completed DESIGN.md.
Guidance after each prefix may change; no large template body is an exact-text contract.

```markdown
## 1. First Impression
## 2. Design Intent
## 3. Layout & Grid
## 4. Visual Hierarchy
## 5. Typography
## 6. Color System
## 7. Imagery & Iconography
## 8. Motion & Interaction
## 9. Component Patterns
## 10. Signature Moves
## 11. What NOT to Copy
## 12. Reusable Principles
```

Each section contains its evidence and interpretation below the heading. When evidence is absent,
retain the heading and say `unavailable` with a reason. Reusable Principles contains 5–10 rules
that can transfer to another product and are traceable to earlier observations.

### VARIATIONS template and output

Include `## Target brief`, `## Selected direction`, `## Structural changes` and
`## Verification criteria`. Record the product/audience/content/stack known from context, selected
or recommended direction and reason, target-specific structural choices, measurable checks and
unresolved essentials. Preserve an explicit user choice; otherwise recommend the direction best
supported by the brief and record the assumptions. If the target is not yet known, mark it as
unavailable rather than inventing product facts. These fields are the implementation handoff and
verification notes in the existing artifact; no additional persistent state file is needed.

Repeat `## Variation {letter}: {name}` three times by default, or 3–5 when appropriate. The literal
`## Variation` is a gate anchor. Every direction provides a concept, transferable principles to
keep, best-fit product situations and two distinct tables:

- `Clone-compatible token changes`: concrete reference-value → proposed-value pairs with cited
  reference evidence and a reason for the proposal. If the old value is unavailable, state that
  and identify the new value as proposed instead of fabricating the old half of the comparison.
- `New-build structural adaptations`: what changes, which target need it serves, and the intended
  outcome. New work need not retain the reference's section order, layout skeleton, component set
  or hierarchy. This table does not authorize structural edits to the inert clone's edit contract.

Verification criteria describe the selected product's responsive hierarchy, layout, typography,
component behavior and relevant accessibility checks. Evaluate new work against these principles
and requirements, not identical reference pixels or copied content. Analysis-only use does not
itself authorize implementation; when a build was requested, these notes support immediate handoff.

### LENSES.md (required per-section methodology)

Open with the persona contract: observed decision plus inferred reason; quantify what can be
measured; cite and label evidence. Include one `## N. <section name>` per DESIGN section, each
with a `Look at:` evidence line and an `Answer:` line addressing the following questions:

1. **First Impression** — Original screenshots before data: mood, perceived audience, first/second/third focal points and their apparent mechanisms. Identify impressions as interpretations.
2. **Design Intent** — Viewport and targeted hero copy: apparent audience, feeling and business problem, with reasons labeled as inference rather than knowledge of the designer's intent.
3. **Layout & Grid** — Desktop/mobile details, parent IDs, body/root metadata, targeted conditional CSS and matched screenshots: actual containers, grid/flex, gaps, section rhythm and responsive changes; distinguish tested widths from inferred rules.
4. **Visual Hierarchy** — Screenshots and computed font/rect data: eye path, size/contrast/position/isolation mechanisms and focal points at each observed viewport.
5. **Typography** — CSS token estimates, actual per-viewport typography, root font size and font status: measured values, observed roles, inferred pairing rationale and any fallback limitations.
6. **Color System** — CSS color statistics, computed component colors and screenshots: declaration counts separately from visual role, measured contrast where claimed, and unknown semantic roles.
7. **Imagery & Iconography** — Manifest, asset listings and screenshots: image treatment, icon style and image/text balance, while distinguishing transferable techniques from source-specific assets.
8. **Motion & Interaction** — CSS motion evidence and available state observations: declared timings, observed states, inferred rationale and proposed behavior. JS triggers and unobserved states remain unknown.
9. **Component Patterns** — Roles, direct IDs, parent/child details, responsive images and small markup windows: reusable recipes with structure, measured spacing, responsive behavior, proposed states and unresolved implementation needs.
10. **Signature Moves** — Earlier evidence: two or three distinctive techniques, quantified where measurable, cited and explained.
11. **What NOT to Copy** — Brand/asset provenance and observed usability limits: identity, imagery, proprietary type and copy to exclude; inaccessible choices only claimed with supporting evidence.
12. **Reusable Principles** — Sections 1–11: 5–10 transferable rules for a different product, each traceable to an observation and explicit about assumptions.

### Launcher commands

- `~/.design-lens/bin/design-lens tokens .design-lens/<slug>` writes `tokens.json`.
- `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --details --viewport <width>x<height> --pretty` prints ephemeral measurements.
- `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --id dl-N --viewport <width>x<height> --pretty` measures a light-DOM target.
- `~/.design-lens/bin/design-lens screenshot --url <URL> --width <width> --height <height> --dsf 1 --out <unused-file>` captures a fresh reference image.
- `~/.design-lens/bin/design-lens screenshot .design-lens/<slug> --width <width> --height <height> --dsf 1 --out <unused-file>` captures the current clone.

Use `--full-page` on both sides for full-page comparisons. Desktop dimensions come from the
capture; mobile evidence uses 390×844. If either side is unavailable, mark the comparison unknown.

## Out of scope

- The CLI does not author DESIGN.md or VARIATIONS.md; the agent does.
- No multi-page analysis, automated design score, persistent inventory JSON or extra analysis-state
  files beyond the two artifacts and existing clone evidence/screenshot directories.
- Fresh source screenshots are allowed for viewport comparisons; this is not an interactive
  live-site crawler, and clone inspection cannot recover the source's original application behavior.
- Applying directions belongs to customize-clone or build-from-design. An authorized end-to-end
  request continues into those flows; an analysis-only request stops after delivering the artifacts.

## Verified constraints

- Argument-free shared skill bodies and the canonical launcher are the portable Claude/Codex
  contract (ADR-004, ADR-007, spec 07). Frontmatter uses only name and description.
- CSS analyzer metrics and culori clustering describe captured declarations; they do not establish
  painted-area distribution or guaranteed applied values (spec 05).
- The clone is deliberately inert (ADR-001); inspect measurements are ephemeral stdout (ADR-002).
- The sealed gate checks the 12 DESIGN section names and the `## Variation` marker (AC-13);
  the exact numbered prefixes remain this spec's product contract. Guidance and semantic fields
  may evolve while these requirements remain intact.
- Invocation names are Claude `/design-lens:reverse-design` and Codex `$reverse-design`; the
  reference arrives in message text rather than runtime argument expansion.

### Implementation blueprint and validation (ADR-023)
DESIGN.md retains all twelve sections and includes layout/grid, typography, semantic color,
spacing, imagery, component anatomy, responsive rules and CSS implementation recipes. Prefer
source measurements over clone measurements; label source/clone/inferred/proposed/unavailable.
An observation table records viewport, observation ID, field, value, unit and rounding precision.
`validate-design <dir> --json` reads the two analysis documents without modifying them and checks
required sections/tables, resolvable references, measured values, units and declared rounding.
Conversions require supporting root/font evidence. Interpretation remains independently reviewed;
a valid citation alone does not prove rationale. Missing source evidence is explicit.
