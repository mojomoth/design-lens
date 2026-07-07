# 04-design-analysis — designer reverse-engineering

## Purpose

Defines the `reverse-design` skill: how the agent turns a clone (`.design-lens/<slug>/`, see
specs/03-clone-format.md) into `DESIGN.md` + `VARIATIONS.md` through a senior-designer persona.
The CLI supplies evidence (screenshots, tokens.json, inspect JSON); ALL analysis prose is written
by the agent following this spec's methodology, templates, and LENSES.md. The sealed gate AC-13
greps the template files shipped with the skill.

## Requirements

### Files
- The skill MUST ship exactly these four files:
  `plugin/skills/reverse-design/SKILL.md`, `plugin/skills/reverse-design/LENSES.md`,
  `plugin/skills/reverse-design/templates/DESIGN.template.md`,
  `plugin/skills/reverse-design/templates/VARIATIONS.template.md`.
- SKILL.md frontmatter MUST contain only `name: reverse-design` and `description`; the
  description MUST cover triggers: "analyze a design", "extract a style guide / design system
  from a site", "why does this site look good".
- The skill body MUST NOT contain `$ARGUMENTS`, `$<digit>`, `{{`, backtick-command
  interpolation, or `CLAUDE_PLUGIN_ROOT` (AC-12). The only executable path referenced MUST be
  `~/.design-lens/bin/design-lens`. The body MUST begin with the canonical CLI-availability-check
  paragraph (verbatim — defined once in specs/07-skills.md).

### Procedure (the SKILL.md body encodes exactly this)
- The target site/clone comes from the user's message. If no clone exists for it, the skill
  MUST run the clone-reference flow first.
- Evidence MUST be gathered in this order — vision before code:
  1. View `screenshots/original-full.png` and `screenshots/original-viewport.png` (image read)
     and form the first impression BEFORE reading any tokens or markup.
  2. Run `~/.design-lens/bin/design-lens tokens .design-lens/<slug>`, then read `tokens.json`.
  3. Run `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty` for structure
     (roles, dl-ids, rects, key computed styles).
  4. Targeted greps of `clone/index.html` and captured CSS only (landmarks, headings, `@media`,
     `transition`/`animation` rules) — read small windows around matches.
  5. OPTIONAL mobile view: `~/.design-lens/bin/design-lens screenshot --url <URL> --width 390
     --height 844 --out .design-lens/<slug>/screenshots/mobile.png`.
- The agent MUST NOT open the full `clone/index.html` into context (it is large); access is
  grep + targeted line-window reads only. SKILL.md MUST state this rule explicitly.
- Persona: the agent is a senior product/brand designer reverse-briefing the site. Every
  observation MUST pair the *decision* with a *hypothesized reason* ("Type scale jumps 1.5× at
  the hero — the designer wants the value prop read before anything else"). Every claim MUST be
  quantified (px, ratios, hex/OKLCH, ms) and MUST cite its evidence (a `tokens.json` key, a
  `data-dl-id`, a screenshot region, or a grepped CSS rule).
- Motion honesty: the clone is inert (no JS, ADR-001), so motion evidence is CSS-only
  (transitions, `@keyframes`, tokens.json `motion`). Anything not backed by captured CSS MUST be
  labeled as inference, never stated as fact.
- The agent MUST read LENSES.md before writing, then fill `templates/DESIGN.template.md` and
  write the result to `.design-lens/<slug>/DESIGN.md`. All 12 numbered headings MUST appear in
  DESIGN.md in order; a section with no evidence gets one line saying so — headings are never
  dropped.
- Then fill `templates/VARIATIONS.template.md` → `.design-lens/<slug>/VARIATIONS.md`:
  3–5 named variations; every variation keeps the layout skeleton and changes tokens/mood; at
  least one MUST be conservative (safe, close to reference) and one bold (strong departure);
  every **Change** row MUST be a concrete old → new token value pair — no vague directions.
- Executive summary: after writing both files, the agent MUST present at most 10 lines in chat
  (signature moves, palette + type one-liners, recommended variation, one risk), MUST NOT dump
  the file contents into the conversation, and SHOULD offer next steps: customize-clone (apply
  a variation to the clone) or build-from-design (new page from DESIGN.md).

### Templates (gate-relevant)
- DESIGN.template.md MUST contain the 12 heading lines exactly as given in Interfaces below —
  each line begins with the exact string the sealed gate greps (`## 1. First Impression` …
  `## 12. Reusable Principles`) and carries its guidance after an em dash (AC-13).
- VARIATIONS.template.md MUST contain the literal string `## Variation` (AC-13).

## Interfaces & contracts

### `templates/DESIGN.template.md` (exact content)

```markdown
# Design Analysis: {site} ({url}, captured {date})

## 1. First Impression — 5-second read: mood words, perceived audience, what your eye hits 1st/2nd/3rd
## 2. Design Intent — who it's for, what feeling it sells, the one problem the design solves
## 3. Layout & Grid — container width, column system, breakpoints, section rhythm, density, whitespace strategy
## 4. Visual Hierarchy — the eye path and HOW it's engineered (size/contrast/position/isolation), focal points per viewport
## 5. Typography — families + pairing rationale, scale (sizes + ratio), weights, line-height, casing, where the personality lives
## 6. Color System — palette table (OKLCH+hex, role, usage %), 60-30-10 or not, contrast strategy, semantic colors
## 7. Imagery & Iconography — photo/illustration style, treatment (duotone? grain?), icon system, image-to-text ratio
## 8. Motion & Interaction — durations, easings, what animates and WHY, scroll behavior, hover language
## 9. Component Patterns — recipes for nav, hero, cards, CTAs, footer (structure + spacing + states), reusable as specs
## 10. Signature Moves — the 2-3 identifiable techniques that make this design THIS design
## 11. What NOT to Copy — brand-identity elements (logo, mascots, proprietary type, photography, copy voice), dated/inaccessible choices
## 12. Reusable Principles — 5-10 transferable rules, phrased so they can be applied to a different product
```

The agent writes each section's content on the lines below its heading; heading lines are copied
verbatim (the guidance after the em dash MAY be trimmed in DESIGN.md, the `## N. Name` prefix
MUST be kept exactly).

### `templates/VARIATIONS.template.md` (exact structure)

```markdown
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
```

The filled VARIATIONS.md repeats the `## Variation {letter}: {name}` block 3–5 times (A, B, C…).

### `LENSES.md` (required content — per-section methodology)

LENSES.md MUST open with the persona contract (3 rules: decision + hypothesized reason;
quantify with px/ratios/OKLCH/ms; cite evidence), then one `## N. <section name>` per DESIGN
section, each with a `Look at:` line (evidence sources) and an `Answer:` line (questions):

1. **First Impression** — Look at: original-full.png for 5 seconds, before any data. Answer: 3 mood adjectives; perceived audience; what the eye hits 1st/2nd/3rd and which mechanism (size? contrast? position?) causes each hop.
2. **Design Intent** — Look at: viewport screenshot + hero copy (grep `<h1`/`<h2`). Answer: who it's for; the feeling being sold (trust/energy/luxury/calm); the one business problem this design solves.
3. **Layout & Grid** — Look at: inspect rects (sections, container), `@media` greps, full-page screenshot. Answer: container max-width px; column system + gutters; breakpoints; vertical rhythm between sections in px; density — where whitespace is spent and why.
4. **Visual Hierarchy** — Look at: viewport screenshot + inspect font-size/rect data. Answer: the ordered eye path; the engineering of each focal point (size/contrast/position/isolation); focal points per viewport-height of scroll.
5. **Typography** — Look at: tokens.json `typography` (families, sizesPx, scaleRatioGuess, weights, lineHeights) + screenshots for pairing feel. Answer: families and pairing rationale; scale + ratio; weight jobs; body vs heading line-height; casing habits; where the personality lives.
6. **Color System** — Look at: tokens.json `colors`/`palette` (OKLCH, counts, roles). Answer: palette table with role and usage share; 60-30-10 or another distribution; contrast strategy; semantic colors if present.
7. **Imagery & Iconography** — Look at: manifest.json image entries + `clone/assets/` listing + screenshots. Answer: photo vs illustration; treatment (duotone, grain, gradient overlays, masks); icon style (stroke/filled, weight); image-to-text ratio.
8. **Motion & Interaction** — Look at: tokens.json `motion` + greps for `transition`/`animation`/`@keyframes`/`:hover`. Answer: duration ladder in ms; easing family; what animates and WHY (attention, affordance, delight); scroll and hover language. Label CSS-unbacked claims as inference.
9. **Component Patterns** — Look at: inspect roles (logo/nav-link/hero-*/cta/footer/section) + grep windows around their dl-ids. Answer: a rebuild-ready recipe per component: structure, spacing values, states — phrased as specs.
10. **Signature Moves** — Look at: everything above. Answer: the 2-3 techniques that make this design THIS design, each named, quantified, and cited.
11. **What NOT to Copy** — Look at: logo/brand assets in manifest + copy voice. Answer: brand-identity elements (logo, mascots, proprietary type, photography, voice) that must never be reused; plus dated or inaccessible choices (contrast failures, tiny targets).
12. **Reusable Principles** — Look at: sections 1–11. Answer: 5–10 transferable rules phrased for a different product, each traceable to an observation above.

### Command lines used by this skill
- `~/.design-lens/bin/design-lens tokens .design-lens/<slug>` → writes `tokens.json`
- `~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty` → JSON on stdout (ephemeral)
- `~/.design-lens/bin/design-lens screenshot --url <URL> --width 390 --height 844 --out <file>`

## Out of scope

- The CLI never writes DESIGN.md or VARIATIONS.md — they are agent-written artifacts.
- No multi-page analysis (one clone = one page), no automated design scoring, no persistent
  analysis state beyond the two output files, no live-web browsing during analysis (evidence
  comes from the clone directory; the optional mobile screenshot is the single live exception).
- Applying variations (editing the clone, building new pages) belongs to the customize-clone
  and build-from-design skills, not this one.

## Verified facts

- Codex skills have NO runtime placeholder expansion (importer skips bodies with `$ARGUMENTS`,
  `$1-$9`, `{{}}`, backtick-command, `@file`) and do NOT substitute `${CLAUDE_PLUGIN_ROOT}`
  (hooks only) — hence argument-free shared bodies whose only runnable path is
  `~/.design-lens/bin/design-lens` (research/codex-plugin.md; ADR-004, ADR-007).
- Skill frontmatter common denominator across both tools is `name` + `description`
  (research/codex-plugin.md, research/claude-plugin.md; ADR-004).
- `@projectwallace/css-analyzer` 9.x extracts 150+ metrics incl. per-property color context,
  font families/sizes, shadows, animation durations; `culori` 4.x does OKLCH conversion +
  deltaE clustering — tokens.json is trustworthy quantitative evidence (research/clone-tech.md).
- The clone is deliberately inert — "a photograph, not a program" — so JS-driven motion cannot
  be observed, only inferred from captured CSS (ADR-001).
- `inspect` output is ephemeral stdout JSON, never written into the clone; re-run it rather
  than caching (ADR-002).
- The sealed gate greps DESIGN.template.md for the 12 numbered heading strings and
  VARIATIONS.template.md for `## Variation`; missing strings fail `--strict` (ACCEPTANCE.md
  AC-13; enforcement sealed in `.harness/`).
- Invocation names: Claude `/design-lens:reverse-design`, Codex `$reverse-design`; the target
  URL/slug arrives in the user's message text, not as an argument (ADR-004).
