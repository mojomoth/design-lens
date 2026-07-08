# LENSES.md — how a senior designer reads a page

Twelve lenses, one per heading of `templates/DESIGN.template.md`. Work them in order: the early
lenses are made of eyes, the later ones of data, and a designer who reads `tokens.json` before
looking at the page will describe a stylesheet instead of a design.

## The persona contract

Three rules govern every line you write. They are what separates a design analysis from a CSS dump.

1. **Decision + reason.** Never state a decision without the hypothesized intent behind it. Not
   "the h1 is 64px" but "the h1 jumps to 64px — 4× body — because the value proposition has to be
   read before the eye finds anything else." You are reverse-briefing the designer: recover the
   brief they were working from.
2. **Quantify.** px, ratios, percentages, hex/OKLCH, ms. "Generous whitespace" is worthless;
   "96px between sections, 1.5× the 64px rhythm inside them" is a spec someone can build from.
3. **Cite.** Every claim names its evidence: a `tokens.json` key (`typography.scaleRatioGuess`), a
   `data-dl-id` from inspect (`dl-42`), a screenshot region ("hero, upper third of
   `original-viewport.png`"), or a grepped CSS rule. A claim with no citation is taste, and taste
   does not survive review.

Evidence lives in four places, all inside `.design-lens/<slug>/`: `screenshots/` (the eyes),
`tokens.json` (the quantities — run `~/.design-lens/bin/design-lens tokens .design-lens/<slug>`),
`inspect --pretty` on stdout (the structure), and `manifest.json` at the project root (what was
captured, and from where). Read `clone/index.html` and the captured CSS only through greps and
small line windows around the matches — never open them whole.

---

## 1. First Impression

**Look at:** `screenshots/original-full.png` for five seconds, then `original-viewport.png`. Nothing
else. No tokens, no markup — this is the only lens that is spoiled by data.

**Answer:** Three mood adjectives. Who this page thinks you are. What your eye hits 1st, 2nd, 3rd —
and for each hop, which mechanism caused it: size, contrast, position, or isolation. Write it down
now; you will never be this naive about the page again, and the first impression is the only
evidence you have of how a real visitor meets it.

## 2. Design Intent

**Look at:** `original-viewport.png` plus the hero copy — grep `clone/index.html` for `<h1` and
`<h2` and read the window around each match.

**Answer:** Who it is for (and how the design says so). The feeling it sells — trust, energy,
luxury, calm, urgency, competence. The one business problem the design exists to solve: a signup, a
download, a sales call, a reassurance. Everything downstream is that problem's fingerprint.

## 3. Layout & Grid

**Look at:** `inspect .design-lens/<slug> --pretty --kind section` rects (x/y/width/height in CSS px
at a 1440×900 viewport), greps for `@media` in the captured CSS, and `original-full.png` for the
page's vertical shape.

**Answer:** Container max-width in px (read it off the widest section rect, or grep `max-width`).
The column system and its gutters. The breakpoints, in ascending px, and what each one changes.
Vertical rhythm: the px gaps between section rects, and whether they form a scale (`spacing.scalePx`
in tokens.json, `spacing.base` of 8 or 4). Density: where whitespace is spent lavishly and where it
is withheld — and what that spending buys.

## 4. Visual Hierarchy

**Look at:** `original-viewport.png` alongside `inspect --pretty`: `styles.fontSize` and `rect` for
every element, `role` for the ones that matter (`hero-heading`, `hero-image`, `cta`).

**Answer:** The ordered eye path, first fixation to last. For each focal point, the engineering:
size (ratio to body text), contrast (OKLCH lightness gap against its background), position (rect
x/y against the fold), isolation (px of clear space around it). Then count focal points per
viewport-height of scroll — one strong focus per screen is a designed page, four is a bazaar.

## 5. Typography

**Look at:** `tokens.json` → `typography.families[]` (`name`, `usage` of body/heading/both, `faces`
paths), `typography.sizesPx`, `typography.scaleRatioGuess`, `typography.weights`,
`typography.lineHeights`. Then the screenshots, for what the pairing *feels* like.

**Answer:** The families and why they were paired (contrast of form? shared skeleton? a display face
carrying all the personality while a workhorse carries the reading?). The scale: `sizesPx` and the
`scaleRatioGuess` — is it a named ratio (1.25 major third, 1.333 perfect fourth, 1.5 perfect fifth)
or hand-tuned? The job of each weight. Body line-height versus heading line-height, and why they
differ. Casing habits (all-caps eyebrows? sentence-case headings?). Finally: which single
typographic decision carries the brand's personality — usually one, rarely two.

## 6. Color System

**Look at:** `tokens.json` → `colors[]` (each cluster's `hex`, `oklch`, `count`, `roles`,
`clusterOf`) and `palette` (`primaryGuess`, `neutrals`, `accents`).

**Answer:** A palette table: OKLCH + hex, role (text/background/border/shadow/fill), and usage share
— compute each cluster's `count` as a percentage of the summed counts. Does the distribution follow
60-30-10, or something else (a two-tone system, a rainbow of accents)? The contrast strategy: which
pairs carry text, and do they clear 4.5:1? Semantic colors, if any (success/warn/error), and whether
they were designed or inherited from a framework. Note that `clusterOf` reveals near-duplicates —
several hexes collapsing into one cluster usually means a design system that leaked.

## 7. Imagery & Iconography

**Look at:** `manifest.json` → `resources[]` entries whose `contentType` is an image type (their
`bytes` and `localPath`), the `clone/assets/` tree, and the screenshots for how the images are
actually used. `inspect --kind hero-image` gives you the hero's `src` and rect.

**Answer:** Photography or illustration, and what that choice claims about the product. The
treatment: duotone, grain, gradient overlay, mask, drop shadow, no treatment at all. The icon
system: stroke or filled, stroke weight, corner style, whether icons match the type's weight.
The image-to-text ratio down the page — an image-heavy page sells a feeling, a text-heavy page
sells a case.

## 8. Motion & Interaction

**Look at:** `tokens.json` → `motion.durationsMs`, `motion.easings`, `motion.keyframes`; then grep
the captured CSS for `transition`, `animation`, `@keyframes`, `:hover`, `:focus-visible`,
`prefers-reduced-motion`.

**Answer:** The duration ladder in ms — micro (hover, ~150ms), medium (reveals, ~300ms), macro
(page transitions, 600ms+) — and whether it is a ladder or a single value used everywhere. The
easing family, and whether entrances and exits differ. What animates, and WHY: attention (a pulsing
badge), affordance (a hover lift that says *clickable*), or delight (a flourish that pays nothing
but is worth it anyway). Scroll behavior and hover language.

**Motion honesty:** the clone is inert by design — no scripts, no event handlers, a photograph and
not a program. So JS-driven motion left no trace here. Anything you cannot point at in captured CSS
is an inference, and must be written as one: *"the hero copy likely fades up on load (inferred from
the `fadeUp` keyframes in tokens.json `motion.keyframes`; no bound trigger survives in the clone)."*
Never launder an inference into a fact.

## 9. Component Patterns

**Look at:** `inspect --pretty` roles — `logo`, `nav-link`, `hero-heading`, `hero-image`, `cta`,
`footer`, `section` — and grep `clone/index.html` for each element's `data-dl-id`, reading a small
window around the match. `styles` on each element gives you `color`, `background`, `fontSize`,
`fontFamily`; `rect` gives you the geometry.

**Answer:** A rebuild-ready recipe per component — nav, hero, card, CTA, footer. Each recipe is a
spec, not a description: structure (what contains what), spacing (px padding, px gaps), and states
(rest, hover, focus, disabled — from the CSS greps, since the clone cannot show you a hover). Write
them so a developer who never saw the reference could build the component and land within a few px.

## 10. Signature Moves

**Look at:** everything above, at once. This lens has no new evidence — it has synthesis.

**Answer:** The two or three techniques that make this design THIS design, and not a competent
generic page. Name each one ("the 4× hero jump", "the single accent hue rationed to CTAs only",
"the 1px hairline grid that never breaks"). Quantify it. Cite it. If you removed the move, would
the page still be recognizable? If yes, it was not a signature — keep hunting.

## 11. What NOT to Copy

**Look at:** the brand assets in `manifest.json` `resources[]` (logo files, photography), the copy
voice in the grepped headings, and the contrast/target-size numbers you gathered in lenses 4 and 6.

**Answer:** Two lists. First, the brand identity — logo and wordmark, mascots, proprietary or
licensed typefaces, commissioned photography and illustration, the copy voice itself. These are the
company, not the design; reusing them is passing off, and no variation may carry them forward.
Second, the mistakes: contrast failures (below 4.5:1 for body text), touch targets under 44px, text
baked into images, dated ornament. A reverse-brief that copies the flaws was not a brief, it was a
tracing.

## 12. Reusable Principles

**Look at:** your own sections 1–11.

**Answer:** Five to ten transferable rules, each traceable to an observation above, each phrased so
it can be applied to a *different* product with a different brand. "Ration the accent hue: one hue,
CTAs only, under 5% of painted pixels" travels. "Use `#3347ff`" does not. This section is the reason
the analysis exists — everything before it is evidence for it.

---

## Writing rules

- **Every heading, every time.** All twelve numbered headings appear in `DESIGN.md`, in order,
  copied from the template. A section with no evidence gets exactly one line saying so ("No
  `@keyframes` or `transition` rules survived the capture; motion is unanalyzable here"). Headings
  are never dropped — an absent section is itself a finding.
- **Prose, not bullets, where the reasoning matters.** Lenses 1, 2, and 10 are arguments. Lenses 3,
  5, 6, and 9 are specs, and specs may be tables.
- **The em-dash test.** If a sentence has a number but no "because", it is not finished.
- **VARIATIONS.md** comes after DESIGN.md, never before: you cannot vary a design you have not yet
  understood. Fill `templates/VARIATIONS.template.md` — 3 to 5 named directions, at least one
  conservative and one bold, every **Change** row a concrete old → new token value.
- **The chat summary is ten lines, maximum.** Signature moves, palette in one line, type in one
  line, the recommended variation, the one risk. Point at the two files; never paste them into the
  conversation. Then offer the next step: customize-clone to apply a variation to the clone, or
  build-from-design to start new work from `DESIGN.md`.
