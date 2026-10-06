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
Visible area comes only from `tone.json`, which classifies the painted pixels of each source
full-page screenshot as light, mid or dark and finds full-bleed dark bands.
`palette.primaryGuess`, `typography.scaleRatioGuess`, and `spacing.base` are guesses; a null base is unknown. Token schema 2 preserves alpha in css/oklch and records declaration provenance, unresolved values, and unit assumptions. Static
relative-unit conversions use a 16px basis, which may differ from measured root/body sizes.
Clustering can merge intentional variants; it is not proof of a broken design system. Prefer
rendered measurements for a stated viewport, retaining CSS statistics as context.

Use source observations first, then `inspect --lite --viewports` at the captured sizes (normally
1440x900, 768x1024 and 390x844) for the role inventory, and `--lite` with repeated `--id` and
`--selector` for signature elements and their containers. Lite elements report a compact font
string, color, box, layout, effects and pseudo content; `v: 0` marks a match in an inactive sampled
variant. Use `--all --details` at one viewport only for a specific recipe gap. Do not combine `--id`
or `--selector` with `--kind`, or `--all` with any selection. A null role or parent ID is valid;
role confidence describes a heuristic match only. Iframe internals and closed roots are
unavailable. Inspect output is ephemeral clone evidence, so re-run it after edits. Use fidelity to persist observations bound to the current clone hash. IDs must always be paired with their capture ID. Access HTML and captured CSS through greps and short line
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

**Look at:** the original viewport screenshot crop of each display, heading, body and label
element, then `tokens.json` typography candidates, captured font-face rules, measured
`styles.fontSize`, `styles.fontFamily`, and page root/body font information.

**Answer:** The roles of heading/body/label type, measured size and line-height relationships,
weights, tracking, casing, and likely pairing rationale. Compare static guesses with actual
rendered values, especially for rem, em, variables, and fluid sizes. A guessed modular ratio is
not an observed intentional scale. Note failed or unavailable fonts before attributing the
reference's personality to a face. The clone's font files are evidence, not assets to copy.

Fill `### Typeface forms` from the glyphs, not the family name. Form features name terminals
(square, rounded, flared, cut), counters (rectangular, round, open), width, case and weight.
validate-design enforces two rules. First, at least one row's Role must match display, heading,
headline, title or hero, or Korean 디스플레이, 헤드라인, 제목, 타이틀 or 히어로 (case-insensitive): the headline
face is always classified. Second, each
Form features cell must describe letterforms: it fails when, ignoring case, quotes and
whitespace, it equals the row's source family or one of its OFL substitute families, or when it
names fewer than two distinct features from this vocabulary (English or Korean; Latin terms match
whole words with an optional plural s/es, Korean terms match anywhere):

| Feature | Accepted terms |
|---|---|
| terminals | terminal, 단자, 터미널, 맺음 |
| counters | counter, 카운터, 속공간 |
| aperture | aperture, 어퍼처, 개구부 |
| width | width, wide, narrow, condensed, extended, compressed, expanded, 폭, 너비, 넓은, 좁은, 압축, 장체, 평체 |
| case | case, uppercase, lowercase, caps, all-caps, small-caps, 대문자, 소문자 |
| stroke | stroke, monoline, contrast, 획, 대비 |
| weight | weight, bold, heavy, thin, hairline, 굵기, 굵은, 가는, 두께 |
| x-height | x-height, xheight, 엑스하이트, x높이 |
| corners | corner, square, rounded, angular, chamfered, 모서리, 각진, 둥근 |
| pixel | pixel, pixelated, bitmap, 픽셀, 비트맵, 도트 |
| stencil | stencil, 스텐실 |
| serif | slab, serif, 세리프, 슬랩 |
| geometric | geometric, 기하 |
| mono | mono, monospaced, monospace, 고정폭 |
| tracking | tracking, letter-spacing, letterspacing, 자간 |
| slant | slant, slanted, italic, oblique, 기울기, 기울어진, 이탤릭 |

For example `"LabsAmiga"` fails, while `pixel grid, square terminals, uppercase only` or
`픽셀 격자, 각진 모서리, 대문자 위주` passes.

Every role that sets text in the target's language needs an OFL substitute that covers that
script (Hangul text needs a Hangul-covering face such as Galmuri for pixel forms). When no
same-form substitute covers the script, say so in the row and state how the form is adapted. qa
measures which fonts actually paint each display heading's glyphs; a heading whose glyphs fall
back to a platform font fails `font-drift`.

Form classes: pixel (built on a visible pixel grid), stencil (bridged stroke breaks),
square-terminal (flat cut ends on rectilinear strokes), techno (wide, squared geometric sci-fi
shapes), geometric-sans, grotesk, neo-grotesk, humanist, rounded, condensed, wide, slab, mono,
display-serif, text-serif, poster-heavy, script, handwritten, blackletter, other. Combine classes
with `/`. Choose OFL substitutes of the same class and verify each license before listing it;
common candidates are Silkscreen or Pixelify Sans (pixel), Galmuri (pixel Hangul), Orbitron,
Tektur, Chakra Petch or Oxanium (techno/square-terminal), Big Shoulders Stencil (stencil), IBM
Plex Mono or Space Mono (mono), Space Grotesk (grotesk), Inter or Pretendard (neo-grotesk),
Barlow Condensed (condensed) and Anton or Black Han Sans (poster-heavy). A substitute of another
class changes the reference's identity: say so instead of listing it.

## 6. Color System

**Look at:** token color clusters and their CSS roles, the screenshots, and computed foreground
and background colors on relevant elements and parents.

**Answer:** A palette table with value, role, evidence, and CSS occurrence count where useful.
Describe visual prominence from the screenshot and the `### Tone budget` copied from `tone.json`;
never convert declaration counts into painted percentages. State how dark is used: absent, small
inverse tiles, full-bleed bands, or both. A reference with no full-bleed dark band keeps its tone
only if new work adds none. Treat a guessed primary color as a candidate until the visible actions and surfaces
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

**Look at:** the original full-page and viewport screenshots at every captured size, then the
supporting observations from sections 1–9.

**Answer:** A `### Signature priority` table of five to ten devices ranked by how much each makes
the page recognizable. Describe each device by its visible form, not by a measurement alone:
tone and dark usage, the display typeface's form, frame and grid lines, ornaments such as corner
marks or brackets, component chrome such as clipped corners and carousel arrows, hero and motion
devices such as a cropped marquee word, and closing bands. Cite measured or tone rows, choose a
transfer (keep, adapt, substitute) and a build check, preferably a computed-style assertion
usable as a `check:<rank>` contract row. Explain what is lost if a device disappears and where it
would be inappropriate. A principle such as reserving an accent for the primary action should
survive a change of brand color; a copied logo should not.

## 11. What NOT to Copy

**Look at:** source identity and assets, distinctive copy, observed usability problems, and the
limits recorded above.

**Answer:** Identify original logos, marks, mascots, proprietary font files, photography,
illustrations, icon artwork, and source copy that must be replaced in new work. Name observable
mistakes and propose checks for suspected ones; do not call a design inaccessible from an
unmeasured ratio or an assumed target-size threshold. Also reject structural choices that do not
serve the target, such as forcing a repeated-use management screen into a promotional hero layout.
Never remove a ranked signature silently here: name the device's adapted form instead (for
example, a carousel shown as a peeking scroll track rather than a static grid). Keep this
practical and specific to the evidence.

## 12. Reusable Principles

**Look at:** supported observations and target needs from sections 1–11.

**Answer:** Five to ten transferable rules. Each rule contains:

| Evidence | Possible why | Conditions for reuse | Implementation for the target | Check |
|---|---|---|---|---|
| A cited observation above | A clearly identified hypothesis | Where it helps, and when to adapt it | A concrete proposed decision | What to inspect in the rendered result |

Use these rules to choose a direction in VARIATIONS.md. They should change implementation choices,
not just rename colors. Where no target exists, state a conditional implementation and check.
Area shares come only from the measured Tone budget; do not claim the reference's business outcomes.

## Writing and handoff

- Preserve all twelve numbered heading prefixes. A section with no evidence still explains what
  is unavailable; it is never silently omitted.
- Write connected prose for reasoning and compact tables for values, recipes, and checks. Use the
  user's language for explanations. Keep hypotheses and proposed design decisions visibly separate
  from measured facts; do not force every impression into a number.
- Write DESIGN.md before VARIATIONS.md and select no direction until validate-design reports
  `documents.design.status` other than `fail`. Default to three useful named directions, allowing
  three to five when warranted: one conservative, one bold, and one adapted to the target product.
- Record each direction's decision for every ranked signature in `## Signature retention`. Let the
  directions differ in retention; at least one keeps the top signatures (score 0.75 or more).
  Dropping a rank 1–3 device needs a verbatim brief or content quote.
- The selected or recommended direction always records the `**Design basis:**` hash and a
  `### Build contract` (fonts from
  Typeface forms substitutes, dark maxima from tone.json, check rows for the top signatures).
  Changing Typeface forms, Tone budget or Signature priority later invalidates that selection.
- One agent writes both documents; helpers return findings and never overwrite them.
- Clone customization uses the token-change table while retaining its layout. New work can change
  structure to serve its brief, with each change tied to a transferable principle and a check.
- Populate the selected direction and recommendation from available context. Preserve a user-chosen
  direction; otherwise choose the highest retention score when the brief prioritizes the
  reference's design language, else the best fit, and continue an already-requested build. An analysis-only
  request ends with the two documents, not an unrequested implementation.
- Keep the chat summary within ten lines and link to the documents. State material evidence limits
  once, and carry the selected principles and verification criteria into the next requested flow.

## Blueprint completion check

Retain all recipe headings, the measured observation table and the Typeface forms, Tone budget and
Signature priority tables from the template. Layout recipes state container constraints, box
sizing, columns, gaps, and tested reflow; type recipes state family availability and actual roles;
components state semantic markup order, parent/child relationships, padding, crop, borders,
surfaces, and observed states. Cover meaningful content below the hero. Provide actual CSS a
developer can apply, with numerical evidence beside it.

Run validate-design after writing both documents and after correcting a claim. It checks required
structure, capture-local references, units, alpha, decimal rounding, current clone and tone
hashes, signature citations, retention scores and the build contract. It does not establish that
an interpretation is persuasive or that a CSS recipe reproduces the page; inspect the source
images and independently review those conclusions. Missing evidence is qualified, not replaced by
proposed values in the measured table.
