# Design Variations: {site}

## How to use this file

These directions transfer supported principles from DESIGN.md to a different brand or product.
Clone customization applies only the clone-compatible token changes. New work may also change
structure to serve its target task. Proposed design-role names are labels for the new design,
not literal paths in tokens.json; cite real token keys or computed fields separately.

Write explanations in the user's language. Use known conversation/project context before asking
for essentials. A sufficient brief does not require another approval pause. If this is analysis
only and no target was supplied, state that and make the recommendation conditional.

## Target brief

- **Product and audience:** {known context, or not supplied}
- **Primary user task and success:** {what the intended user needs to accomplish}
- **Content, data, and required interactions:** {supplied content and functional needs}
- **Existing stack/components and constraints:** {known project context, or not yet inspected}

## Selected direction

- **Direction:** {letter and name; user-selected or recommended default}
- **Why it fits:** {target need and supported principles behind the choice}
- **Principles carried forward:** {references to DESIGN.md section 12}
- **Choice status:** {use an existing preference; otherwise select a recommendation without a mandatory pause}

## Structural changes

Summarize the selected direction's adaptations for new work. For clone customization, state that
only the token-change table applies. If no structural change is needed, say why.

| Reference decision and evidence | Target decision | Reason for adapting | Build check |
|---|---|---|---|
| {source component, hierarchy, or layout} | {proposed target structure} | {target task and principle} | {observable acceptance} |

## Verification criteria

Record what the build will check, then let build-from-design add actual evidence/results. Planned
checks are not completed checks. Use the project's existing checks and available browser tools;
report any unavailable verification honestly.

| Check | Expected behavior | Evidence or result |
|---|---|---|
| Desktop, 1440x900 | {selected hierarchy, spacing, and primary task} | Planned; not run during analysis |
| Tablet, 768x1024 | {appropriate layout and usable controls} | Planned; not run during analysis |
| Mobile, 390x844 | {appropriate reflow, long content, and no document overflow} | Planned; not run during analysis |
| Interaction and content stress | {relevant CTA/navigation, keyboard focus, and long/empty content behavior} | Planned; not run during analysis |

## Variation A: {name}

**Concept:** {one sentence describing the change and whom it serves}

**Keep:** {supported principles and component decisions retained, with DESIGN.md references}

**Clone-compatible token changes**

| Proposed design role | Reference value and evidence | Proposed value | Apply to |
|---|---|---|---|
| {semantic role, not a tokens.json path} | {observed old value with real key, ID, and viewport} | {concrete color, type, spacing, radius, or duration} | {existing CSS property or addressed elements} |

**New-build structural adaptations**

| Reference pattern and evidence | Proposed structure | Target need and retained principle |
|---|---|---|
| {layout, hierarchy, component, or content pattern} | {concrete new arrangement or behavior} | {why it serves this product} |

These structural changes apply to new work, not a token-only edit of the clone. If none are
needed, replace the table with a short explanation.

**Best for:** {product, audience, and task situations that fit this direction}

**Tradeoff:** {what this direction sacrifices or needs to verify}

**Verification:** {specific visual or functional checks for this direction}

---

## Filling this template

Remove this guidance section from the finished document.

- Default to three named variations; three to five are allowed when they add a meaningful choice.
  Include a conservative direction, a bold direction, and a direction adapted to the target task.
  When no target exists, name the kind of task the adapted direction would serve without inventing
  a user brief. Repeat the variation block as B, C, and further letters when needed.
- Give every measured value swap a real old value and source plus a concrete proposed new value.
  When a needed value has no reference evidence, label it a proposed addition and do not invent
  an old value. Do not use a CSS occurrence percentage as a visible-area measurement.
- A conservative direction can preserve structure. A bold or product-adapted direction may change
  hierarchy, density, navigation, and component composition for new work; justify the changes from
  the target need and the reusable principles. A management UI need not inherit a marketing hero.
- Select the user's chosen direction when available; otherwise recommend the best fit, populate
  the selected-direction fields, and continue an already-requested build. For an analysis-only
  request, finish with the documents and recommendation.
- Carry DESIGN.md section 11 forward. New work uses original content/assets and must not copy
  source logos, mascots, proprietary font files, photography, icon artwork, or distinctive copy.
