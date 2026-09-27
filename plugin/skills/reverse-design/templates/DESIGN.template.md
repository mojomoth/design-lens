# Design Analysis: {site} ({url}, captured {date})

## Evidence and capture context

- **Source and time:** {requested/final URL, capture times, source hash}
- **Capture conditions:** {each viewport, browser, DSF, media/removal policy}
- **Source coverage:** {capture completeness, missing assets, frame/shadow limits}
- **Comparison:** {fidelity status and current clone hash; unresolved differences}
- **Fonts:** {readiness, failed families and loaded faces for each capture}
- **Target:** {supplied product and constraints, or not supplied}

Use Observed-reference, Observed-clone, Inferred, Proposed, and Unavailable throughout. Write
explanations in the user's language and retain the required English headings. Source observations
come from evidence.json; current clone observations come from its hash-matching fidelity report.
IDs are local to one capture. Token declarations and designer-intent hypotheses are separate.

## Measured observations

| Label | Capture | Viewport | Observation | Field | Value | Unit | Precision |
|---|---|---|---|---|---|---|---|
| {observed-reference or observed-clone} | {exact capture ID} | {WxH} | {dl-N or page} | {rect.width or styles.fontSize or body.styles.color} | {measured value} | {px/rem/unitless/css/color} | {0–6 for numbers, otherwise -} |

Replace the guide row with actual measurements. Include every complete source viewport, layout,
typography, colors, and the values supporting the recipes below. Cite a row by its capture,
observation, and field. Numeric Value contains no unit; use the separate Unit column. CSS strings
are exact; colors retain alpha. A rem conversion uses that capture's measured rootFontSize.
An unavailable row uses Label unavailable and explains the missing fact in Value; it does not
certify a measurement. Keep inferences and proposals in prose or recipe columns, not this table.

## 1. First Impression — perceived mood, audience, and attention

{Inferred screenshot reading with a named region/viewport and the visible mechanism; no invented visitor behavior.}

## 2. Design Intent — supported purpose and conditional transfer

{Separate explicit source copy from inferred intent. Describe fit to the supplied target, or keep it conditional.}

## 3. Layout & Grid — containers, density, and responsive constraints

### Layout recipe

| Container / markup | Constraint and active layout | Viewport | Measured evidence | Implementation check |
|---|---|---|---|---|
| {container and direct children} | {width/max-width, gutters, box sizing, columns, gap, alignment} | {WxH} | {capture/ID/field rows} | {expected rendered geometry} |

### Spacing recipe

| Relationship | Observed gap / padding / margin | Viewport | Evidence | Reusable rule and limitation |
|---|---|---|---|---|
| {section or component relationship} | {actual value and unit} | {WxH} | {measurement rows} | {supported rhythm, or unknown base} |

### Responsive rules

| Component | Declared CSS condition | Observed layouts | Evidence | Reproduction check |
|---|---|---|---|---|
| {component} | {exact captured query or unknown} | {desktop/tablet/mobile structure and dimensions} | {rows plus source images and targeted CSS} | {wrapping/order/visibility/overflow at tested sizes} |

Do not infer an exact breakpoint from two sampled widths. Cite declaration and rendered evidence
separately. When a viewport differs through JavaScript, describe its observed static structure;
menu behavior remains unavailable unless separately established.

## 4. Visual Hierarchy — focal point, supporting information, and action

{Explain hierarchy using measured scale, alignment, contrast, and whitespace. Mark a proposed target hierarchy as Proposed.}

## 5. Typography — rendered roles and font limits

### Typography recipe

| Role / element | Family and font status | Size / weight / line height / tracking | Viewport | Evidence |
|---|---|---|---|---|
| {heading/body/label} | {computed stack; loaded-face evidence or limitation} | {values with units} | {WxH} | {capture/ID/field rows} |

{Explain pairing and scale as inference. Distinguish static 16px token assumptions from observed root and element sizes.}

## 6. Color System — foregrounds, surfaces, actions, and alpha

### Color roles

| Role | Observed CSS color | Underlying surface / use | Evidence | Transfer rule |
|---|---|---|---|---|
| {foreground/surface/action/border} | {RGBA or equivalent including alpha} | {measured parent background or unavailable} | {capture/ID/field rows} | {conditional semantic role} |

{CSS occurrence counts do not measure painted area. A contrast ratio needs an established composited foreground/background pair.}

## 7. Imagery & Iconography — selected asset, crop, and treatment

{Cite image observations: rect, natural dimensions, currentSrc, objectFit/objectPosition, or background sizing/position. Explain transferable composition separately from source identity.}

## 8. Motion & Interaction — frozen state, CSS evidence, and proposals

{Describe the captured static state and bound CSS rules. Label original JavaScript logic, unobserved triggers, and proposed focus/loading/error states distinctly.}

## 9. Component Patterns — implementable structure and state

### Component recipes

| Component purpose | Markup order and relationships | Measured type / spacing / visual values | Responsive and state rules | Evidence and build check |
|---|---|---|---|---|
| {actual component} | {parent, children, semantic tags, shadow boundary if any} | {row-backed dimensions and styles} | {observed static states; proposed behaviors labeled} | {capture rows and observable acceptance} |

{Cover body content, cards, forms, tables, containers, and open web components when present. Explain absence or unavailable evidence.}

## 10. Signature Moves — distinctive supported techniques

{Two or three techniques with evidence, inferred rationale, transfer conditions, and implementation consequences.}

## 11. What NOT to Copy — identity, assets, text, and unsuitable decisions

{List source identity/assets/copy to replace in new work and evidence-backed problems or checks. Do not invent a target product.}

## 12. Reusable Principles — conditional rules and implementation

| Evidence | Possible why | Conditions for reuse | Concrete implementation | Check |
|---|---|---|---|---|
| {cited observation} | {Inferred rationale} | {when to retain/adapt} | {rule or Proposed target decision} | {rendered acceptance} |

### CSS recipe

```css
/* Replace this guidance with usable container, typography, spacing, component, and responsive CSS.
   Cite measured rows in nearby prose; mark new values and behavior as Proposed. */
```

{Explain how each CSS rule maps to the measurements and which assumptions remain. The example
must contain actual CSS declarations and media rules where observed; a comment alone is not an implementation recipe.}
