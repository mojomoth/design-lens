# Design Variations: {site}

## How to use this file
Each variation keeps the reference's layout skeleton and swaps tokens/mood. Pick one (or mix
rows), then apply the Change table via customize-clone (edits the clone) or build-from-design
(new work). Every row is a concrete old → new value — directly actionable, nothing vague.

## Variation A: {name}
**Concept** — one sentence: the mood shift and who it serves.
**Keep** — layout skeleton, hierarchy, component recipes retained from the reference.
**Change**

| Token | Reference value | New value |
|---|---|---|
| color.primary | {old} | {new} |
| font.heading | {old} | {new} |

**Best for** — the product/brand situations this direction fits.

---

## Filling this template
Delete this section from the file you write. It is guidance for the agent, not for the reader.

- Repeat the `## Variation {letter}: {name}` block 3–5 times (A, B, C…). Name each direction —
  "Editorial Calm", not "Variation 2".
- At least one variation MUST be conservative: safe, close to the reference, shippable without a
  brand debate. At least one MUST be bold: a strong departure that still fits the skeleton.
- Every **Change** row is a concrete old → new value pair sourced from `tokens.json` (a hex or
  OKLCH, a family name, a px step, an ms duration). "Warmer palette" is not a row;
  `#3347ff → #c2410c` is. Add rows beyond the two shown — spacing, radii, motion, weight — wherever
  the direction actually moves a token.
- Never change the layout skeleton, the eye path, or the component recipes: those are what the
  reference earned, and they are what customize-clone keeps intact while the surface swaps.
- Carry `## 11. What NOT to Copy` forward. No variation may reuse the reference's logo, mascots,
  licensed photography, proprietary typefaces, or copy voice.
