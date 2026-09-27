# LENSES.md — reason from a reference, design for a different product

Use the twelve lenses in order after gathering the evidence described in SKILL.md. The aim is
an explanation a developer can apply: what was observed, why it might work, when it transfers,
and how to check the new implementation. Write explanations in the user's language while keeping
the twelve required English heading prefixes.

## The evidence contract

Use these labels in prose or table columns wherever the distinction affects a decision:

- **Observed-reference:** measured in a complete evidence.json capture or visible in its named original screenshot. Later source shots are separate observations.
  State the region and viewport. An impression about mood or eye order is your reading of it.
- **Observed-clone:** measured in the local render or found in captured CSS/HTML. Cite the ID,
  viewport, computed field, token key, or CSS rule. State whether it is rendered evidence or a
  declaration; neither proves that a visibly different original behaved the same way.
- **Inferred:** a possible design reason, audience, behavior, or missing value. Give the supporting
  evidence and its limitation. A plausible explanation is not a recovered designer's brief.
- **Proposed:** a decision for the new product, including values and states the reference does not
  establish. Explain the target need it serves and how the build will verify it.
- **Unavailable:** the capture or available tools cannot establish the claim. Say what is missing
  instead of filling the gap with invented precision.

Keep citations close to the claim. Quantify where the evidence supports a number; do not invent
measurements for mood, attention, or intent. One label can cover a clearly scoped paragraph or
table row; there is no need to repeat it on every sentence.

Read `REPORT.md` and `manifest.json` before trusting the clone. Record capture date, viewport,
missing assets, source/clone differences, and the time of later source screenshots in DESIGN's
preface. A font status of `ready` means readiness settled; check `failedFamilies` too. A computed
font-family stack does not by itself prove which face rendered.

`tokens.json` describes captured stylesheets, including rules that may be inactive or unused.
Color `count` is CSS occurrence frequency, not visible area, element count, or a 60-30-10 ratio.
`palette.primaryGuess`, `typography.scaleRatioGuess`, and `spacing.base` are guesses; a null base is unknown. Token schema 2 preserves alpha in css/oklch and records declaration provenance, unresolved values, and unit assumptions. Static
relative-unit conversions use a 16px basis, which may differ from measured root/body sizes.
Clustering can merge intentional variants; it is not proof of a broken design system. Prefer
rendered measurements for a stated viewport, retaining CSS statistics as context.

Use source observations first, then `inspect --all --details` at 1440x900, 768x1024, and 390x844 (or the explicitly requested capture widths). Its `page` gives root/body geometry
and font status; element `details` gives typography, box, layout, direct parent/child IDs, and the
selected `currentSrc`. Use `--id` for a container or hidden alternative; do not combine it with
`--kind`. A null role or parent ID is valid. Role confidence describes a heuristic match only.
Repeat `--id` to measure related elements together; open shadow descendants are covered. `--all` excludes `--id` and `--kind`. Iframe internals and closed roots are unavailable. Inspect output
is ephemeral clone evidence, so re-run it after edits. Use fidelity to persist observations bound to the current clone hash. IDs must always be paired with their capture ID. Access HTML and captured CSS through greps and short line
windows, never the whole cloned document.

## 1. First Impression

**Look at:** `original-full.png`, then `original-viewport.png`, before tokens or markup.

**Answer:** Three mood words, the perceived audience, and the first three things you notice. For
each, name the visible mechanism: scale, contrast, position, grouping, or isolation. Phrase the
sequence as your impression; it is not eye-tracking data. Cite the screenshot region and keep
these early impressions even if later evidence qualifies them.

## 2. Design Intent

**Look at:** the original first screen and small HTML windows around its heading and main action;
then the target product context already available in the conversation or project.

**Answer:** The likely audience, feeling, and primary task the reference supports. Separate what
the copy explicitly promises from your hypothesis about why the design supports it. Identify any
mismatch with the target: a signup page, reading experience, and management workspace can share
visual principles while requiring different structures. If no target was supplied, leave target
fit conditional. Do not invent conversion results or a business brief.

## 3. Layout & Grid

**Look at:** full-page screenshots, section/container IDs from inspect, `details.box`,
`details.layout`, `page.body`, and targeted media-query rules. Query the actual parent container
with `--id` when a heading or card does not explain the grid.

**Answer:** Measured content width, container constraints, columns, gaps, padding, and section
rhythm at each inspected viewport. Preserve units such as `auto` when they are what the browser
reports. Separate a declared breakpoint from behavior actually observed at a tested width; two
screenshots do not establish the exact breakpoint. Explain what the density appears to support.
Do not turn an outer section width into a claimed container max-width without checking its box
and parent. If source and clone reflow differ, name that limit before transferring the layout.

## 4. Visual Hierarchy

**Look at:** original first screen, clone comparison, and measured heading/action sizes and rects
at matching viewports.

**Answer:** The main focal point, supporting information, and next action. Explain which size
ratios, alignment, contrast, or clear space support your reading. Distinguish the reference's
visible hierarchy from the clone's measured geometry. Propose a hierarchy appropriate to the
target task; a large marketing headline may become a compact workspace title. Do not treat a
fixed number of focal points per screen as a universal design rule.

## 5. Typography

**Look at:** `tokens.json` typography candidates and captured font-face rules, then measured
`styles.fontSize`, `styles.fontFamily`, `details.typography`, and page root/body font information.

**Answer:** The roles of heading/body/label type, measured size and line-height relationships,
weights, tracking, casing, and likely pairing rationale. Compare static guesses with actual
rendered values, especially for rem, em, variables, and fluid sizes. A guessed modular ratio is
not an observed intentional scale. Note failed or unavailable fonts before attributing the
reference's personality to a face. Define original or appropriately available font alternatives
for new work; the clone's font files are evidence, not assets to copy.

## 6. Color System

**Look at:** token color clusters and their CSS roles, the screenshots, and computed foreground
and background colors on relevant elements and parents.

**Answer:** A palette table with value, role, evidence, and CSS occurrence count where useful.
Describe visual prominence from the screenshot without converting declaration counts into painted
percentages. Treat a guessed primary color as a candidate until the visible actions and surfaces
support it. For contrast claims, identify the actual foreground/background pair, including
transparency and underlying surfaces, and state the measured ratio only when established. An
OKLCH lightness difference is not a contrast ratio. Mark unmeasured contrast unavailable and
propose a check for the build; do not declare compliance from a token dump.

## 7. Imagery & Iconography

**Look at:** original and clone screenshots, manifest image resources, asset sizes/paths, and the
hero image's `src`, selected `details.currentSrc`, and rect at both widths.

**Answer:** The image's role, crop, treatment, and relationship with the text; icon shape and
weight where visible. Distinguish the stored source attribute from the responsive resource that
actually rendered. Explain what can transfer as a composition rule while the original image,
logo, icon artwork, or distinctive source copy is replaced. Missing images or font icons limit
what can be concluded about the reference.

## 8. Motion & Interaction

**Look at:** token motion candidates and captured CSS around transitions, animation bindings,
keyframes, hover, focus-visible, and reduced-motion rules.

**Answer:** Which CSS rules exist, where they are bound, their durations/easings, and possible
purposes. A named keyframe does not prove it ran. The clone is inert: source scripts, event
handlers, menu logic, and JavaScript-driven responsive changes are unavailable here. A later
mobile screenshot shows a state, not a tested interaction. Distinguish an observed CSS state
rule, an inferred trigger, and a proposed implementation state. Specify keyboard focus, relevant
loading/empty/error states, and reduced-motion behavior as proposals when the target needs them.

## 9. Component Patterns

**Look at:** role IDs, parent/container details, direct children, small HTML windows, and relevant
CSS state and media-query rules. Include components that serve the target, not a fixed list of
marketing sections regardless of the page being studied.

**Answer:** For each useful component, record its purpose, structure, measured spacing/type/box,
responsive behavior, and states. Cite IDs and viewport for measured values. Distinguish observed
CSS states from proposed hover/focus/disabled or application states. Record absent evidence as
unavailable rather than claiming a complete interaction specification. Explain what the new
product keeps, changes, or replaces and give an observable build check. An unstamped parent or
unclassified wrapper can still be a relevant container; a hidden element can explain an
alternative layout, but is not evidence of a visible component at that width.

## 10. Signature Moves

**Look at:** the strongest supported observations from sections 1–9.

**Answer:** Two or three techniques that distinguish the reference, each with evidence and a
possible reason it works. Quantify the implementation where supported. Explain what is lost if
the technique disappears and where it would be inappropriate. A named principle such as reserving
an accent for the primary action should survive a change of brand color; a copied logo should not.

## 11. What NOT to Copy

**Look at:** source identity and assets, distinctive copy, observed usability problems, and the
limits recorded above.

**Answer:** Identify original logos, marks, mascots, proprietary font files, photography,
illustrations, icon artwork, and source copy that must be replaced in new work. Name observable
mistakes and propose checks for suspected ones; do not call a design inaccessible from an
unmeasured ratio or an assumed target-size threshold. Also reject structural choices that do not
serve the target, such as forcing a repeated-use management screen into a promotional hero layout.
Keep this practical and specific to the evidence.

## 12. Reusable Principles

**Look at:** supported observations and target needs from sections 1–11.

**Answer:** Five to ten transferable rules. Each rule contains:

| Evidence | Possible why | Conditions for reuse | Implementation for the target | Check |
|---|---|---|---|---|
| A cited observation above | A clearly identified hypothesis | Where it helps, and when to adapt it | A concrete proposed decision | What to inspect in the rendered result |

Use these rules to choose a direction in VARIATIONS.md. They should change implementation choices,
not just rename colors. Where no target exists, state a conditional implementation and check.
Do not prescribe unsupported pixel percentages or claim the reference's business outcomes.

## Writing and handoff

- Preserve all twelve numbered heading prefixes. A section with no evidence still explains what
  is unavailable; it is never silently omitted.
- Write connected prose for reasoning and compact tables for values, recipes, and checks. Use the
  user's language for explanations. Keep hypotheses and proposed design decisions visibly separate
  from measured facts; do not force every impression into a number.
- Write DESIGN.md before VARIATIONS.md. Default to three useful named directions, allowing three
  to five when warranted: one conservative, one bold, and one adapted to the target product.
- Clone customization uses the token-change table while retaining its layout. New work can change
  structure to serve its brief, with each change tied to a transferable principle and a check.
- Populate the selected direction and recommendation from available context. Preserve a user-chosen
  direction; otherwise choose the best fit and continue an already-requested build. An analysis-only
  request ends with the two documents, not an unrequested implementation.
- Keep the chat summary within ten lines and link to the documents. State material evidence limits
  once, and carry the selected principles and verification criteria into the next requested flow.

## Blueprint completion check

Retain all recipe headings and the measured observation table from the template. Layout recipes
state container constraints, box sizing, columns, gaps, and tested reflow; type recipes state
family availability and actual roles; components state semantic markup order, parent/child
relationships, padding, crop, borders, surfaces, and observed states. Cover meaningful content
below the hero. Provide actual CSS a developer can apply, with numerical evidence beside it.

Run validate-design after writing both documents and after correcting a claim. It checks required
structure, capture-local references, units, alpha, decimal rounding, and current clone hashes.
It does not establish that an interpretation is persuasive or that a CSS recipe reproduces the
page; inspect the source images and independently review those conclusions. Missing evidence is
qualified, not replaced by proposed values in the measured table.
