# Design Analysis: {site} ({url}, captured {date})

## Evidence and capture context

- **Source and time:** {requested/final URL, capture times, source hash}
- **Capture conditions:** {each viewport, browser, DSF, media/removal policy}
- **Source coverage:** {capture completeness, missing assets, frame/shadow limits}
- **Comparison:** {fidelity status and current clone hash; unresolved differences}
- **Fonts:** {readiness, failed families and loaded faces for each capture}
- **Tone report:** {tone.json path and evidenceHash, or why `design-lens tone` could not run}
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
observation, and field, written `capture/dl-N/field` or `capture/page/field`; Signature priority
citations must match a row here, including a `styles.fontFamily` row (Unit css) for each ranked
typeface. Numeric Value contains no unit; use the separate Unit column. CSS strings
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

### Typeface forms

| Role | Source family and status | Form class | Form features | OFL substitutes |
|---|---|---|---|---|
| {display, heading, body or label role} | {computed family; loaded, failed or proprietary; cited as capture/dl-N/styles.fontFamily} | {form classes joined by /, e.g. techno/square-terminal} | {terminals, counters, width, case and weight seen in the original viewport crop} | {Family (class); Family (class/class)} |

{Classify Form class from the glyphs in the original viewport screenshot crop of the cited element,
not from the family name. Allowed classes: pixel, stencil, square-terminal, techno, geometric-sans,
grotesk, neo-grotesk, humanist, rounded, condensed, wide, slab, mono, display-serif, text-serif,
poster-heavy, script, handwritten, blackletter, other. A family name alone is not a form. Every OFL
substitute shares at least one class with its row; an openly licensed source family may list itself.
Add a row for every role the new build will set, so every family it loads is listed. No cell is empty or -.
At least one row's Role must match display, heading, headline, title or hero (case-insensitive), or the
Korean 디스플레이, 헤드라인, 제목, 타이틀 or 히어로.
Form features fails when, ignoring case, quotes and whitespace, it equals the row's source family or
one of its OFL substitute families, or when it names fewer than two distinct features from this
vocabulary (Latin terms match whole words with an optional plural s/es; Korean terms match anywhere):
terminals (terminal, 단자, 터미널, 맺음); counters (counter, 카운터, 속공간); aperture (aperture, 어퍼처, 개구부);
width (width, wide, narrow, condensed, extended, compressed, expanded, 폭, 너비, 넓은, 좁은, 압축, 장체, 평체);
case (case, uppercase, lowercase, caps, all-caps, small-caps, 대문자, 소문자); stroke (stroke, monoline,
contrast, 획, 대비); weight (weight, bold, heavy, thin, hairline, 굵기, 굵은, 가는, 두께); x-height (x-height,
xheight, 엑스하이트, x높이); corners (corner, square, rounded, angular, chamfered, 모서리, 각진, 둥근); pixel
(pixel, pixelated, bitmap, 픽셀, 비트맵, 도트); stencil (stencil, 스텐실); serif (slab, serif, 세리프, 슬랩);
geometric (geometric, 기하); mono (mono, monospaced, monospace, 고정폭); tracking (tracking, letter-spacing,
letterspacing, 자간); slant (slant, slanted, italic, oblique, 기울기, 기울어진, 이탤릭).
A role that sets text in the target's language lists a substitute covering that script (for example
Galmuri for pixel Hangul), or says no same-form face covers it and how the form is adapted.}

## 6. Color System — foregrounds, surfaces, actions, and alpha

### Color roles

| Role | Observed CSS color | Underlying surface / use | Evidence | Transfer rule |
|---|---|---|---|---|
| {foreground/surface/action/border} | {RGBA or equivalent including alpha} | {measured parent background or unavailable} | {capture/ID/field rows} | {conditional semantic role} |

### Tone budget

| Capture | Viewport | Metric | Value | Unit | Precision |
|---|---|---|---|---|---|
| {exact capture ID} | {WxH} | darkShare | {tone.json share, e.g. 0.0261} | ratio | {0–6, e.g. 4} |
| {exact capture ID} | {WxH} | fullBleedDarkShare | {tone.json share} | ratio | {0–6} |

{Copy values from tone.json (`design-lens tone`), which measures painted pixels of each source
full-page screenshot. Give darkShare and fullBleedDarkShare for every profiled capture; lightShare,
midShare, tileDarkShare (ratio), darkBandCount (unitless, Precision 0) and darkUsage (css, Precision -,
exactly none, tiles, bands or mixed) are optional rows. Describe how dark is used: none, small tiles, full-bleed bands or both.
CSS occurrence counts do not measure painted area. A contrast ratio needs an established composited
foreground/background pair.}

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

## 10. Signature Moves — ranked devices that make the reference recognizable

### Signature priority

| Rank | Device | Kind | Evidence | Transfer | Build check |
|---|---|---|---|---|---|
| 1 | {device described by its visible form} | {tone, typeface, grid, layout, component, ornament, imagery, motion, chrome or content-pattern} | {capture/dl-N/field or capture/page/field citing measured rows; tone/capture/metric citing Tone budget rows} | {keep, adapt or substitute} | {selector :: property op value, or the visual check} |

{Rank five to ten devices 1..N in row order, most identity-defining first. Include at least three
Kinds, a tone row citing Tone budget rows and a typeface row citing a measured styles.fontFamily row.
No cell is empty or -. After the table,
explain each device's evidence, inferred rationale, transfer conditions, and what is lost without it.}

## 11. What NOT to Copy — identity, assets, text, and unsuitable decisions

{List source identity/assets/copy to replace in new work and evidence-backed problems or checks. Do not invent a target product. A ranked signature is never silently removed here; name how it is adapted instead.}

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
