# Design Analysis: {site} ({url}, captured {date})

## Evidence and capture context

- **Source:** {requested URL and final URL from manifest}
- **Captured at:** {source.capturedAt}
- **Capture viewport:** {source.viewport in CSS pixels; image scale where established}
- **Analysis viewports:** {capture dimensions and 390x844; new screenshots use DSF 1}
- **Later source observations:** {mobile screenshot names, observation times, or unavailable}
- **Capture/clone differences:** {visible differences and relevant REPORT fidelity notes}
- **Font status:** {page.fonts status and failedFamilies at each inspected viewport}
- **Missing evidence:** {missing assets, unmatched image scale, inaccessible source, or interaction limits}

Use **Observed-reference**, **Observed-clone**, **Inferred**, **Proposed**, and **Unavailable** labels
where a claim's basis matters. Cite screenshot region and viewport, measured ID/field, token key,
or captured CSS rule. Write explanations in the user's language; preserve the numbered English
heading prefixes. CSS occurrence counts and static token guesses are not rendered area or measured
intent. Measurements below describe the clone unless corroborated by reference evidence.

## 1. First Impression — perceived mood, audience, and first three points of attention

Record the initial screenshot reading as an interpretation, with the visible mechanism behind each
point of attention. Do not present it as measured visitor behavior.

## 2. Design Intent — likely task, feeling, supporting evidence, and target fit

Separate explicit source copy from hypotheses about intent. Explain where the reference's task
matches or differs from the target product; leave target fit conditional when no brief exists.

## 3. Layout & Grid — measured containers, active layout, responsive changes, and density

| Container and evidence | Capture viewport | 390x844 | Possible reason and transfer limit |
|---|---|---|---|
| {ID and box/layout field or screenshot region} | {measured geometry} | {measured geometry or unavailable} | {hypothesis and conditions} |

Distinguish a declared CSS breakpoint from behavior checked at a particular viewport.

## 4. Visual Hierarchy — focal point, supporting information, and next action

Explain the visible hierarchy with supported size, spacing, alignment, and contrast evidence.
Identify any hierarchy change the target task needs as a proposal.

## 5. Typography — rendered roles, scale, weights, line-height, and font limits

| Type role | Measured values and viewport | Evidence | Pairing rationale or limitation |
|---|---|---|---|
| {heading, body, or label} | {size, weight, line-height, tracking} | {ID and computed field} | {hypothesis, fallback, or unavailable evidence} |

Compare static token guesses with root/body and rendered measurements; do not assume a 16px root
or a successfully rendered font merely from its CSS family name.

## 6. Color System — palette roles, declaration statistics, and observed contrast evidence

| Value | Role | Evidence | CSS occurrence count, if useful | Visual use or limitation |
|---|---|---|---|---|
| {hex or OKLCH candidate} | {text, surface, action, or other role} | {token key and corroborating render} | {count; not painted share} | {screenshot observation or uncertainty} |

State contrast ratios only for established foreground/background pairs; otherwise record the
missing evidence and a proposed check. Token counts cannot establish a 60-30-10 distribution.

## 7. Imagery & Iconography — role, crop, treatment, selected resource, and original alternatives

Explain what the imagery contributes, cite its visible use and selected resource when relevant,
and separate transferable composition from source assets that new work must replace.

## 8. Motion & Interaction — CSS evidence, inferred triggers, unavailable logic, and proposed states

| Pattern | Evidence and status | Possible purpose | Proposed implementation or check |
|---|---|---|---|
| {motion or state} | {bound CSS rule, inference, or unavailable behavior} | {hypothesis} | {target behavior and observable check} |

The inert clone cannot establish JavaScript interaction or the source's complete mobile behavior.

## 9. Component Patterns — purpose, structure, responsive recipes, and states

For each useful component, record its role in the task and the following recipe.

| Structure and evidence | Measured values | Responsive behavior | Observed versus proposed states | Build check |
|---|---|---|---|---|
| {IDs, parent/children, or targeted markup} | {type, spacing, box, and layout} | {capture/mobile evidence or unavailable} | {explicit evidence labels} | {visible or functional acceptance} |

## 10. Signature Moves — two or three distinctive, supported techniques

Name each technique, cite its evidence, explain why it might work, and identify when the target
should adapt it. Distinctive brand assets are not reusable design principles.

## 11. What NOT to Copy — source identity, assets, copy, mistakes, and unsuitable structures

Identify original assets and text to replace. Separate observed problems from checks still needed,
and reject reference structures that do not serve the target's task.

## 12. Reusable Principles — five to ten rules with conditions, implementation, and checks

| Evidence | Possible why | Conditions for reuse | Implementation for the target | Check |
|---|---|---|---|---|
| {cited observation from sections 1–11} | {hypothesized reason} | {where it helps and when to adapt} | {concrete proposed decision} | {observable result at relevant widths/states} |

Use these principles to select a direction in VARIATIONS.md. When no target exists, make the
implementation conditional rather than inventing a product.
