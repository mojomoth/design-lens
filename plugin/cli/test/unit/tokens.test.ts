import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { extractTokens, normalizeRole, RADIUS_PILL_SENTINEL } from '../../src/analyze/tokens.js';

const readFixture = (relative: string): string =>
  fs.readFileSync(fileURLToPath(new URL(`../fixtures/sites/basic/${relative}`, import.meta.url)), 'utf8');

/** The `basic` fixture's CSS as `tokens` will see it: style.css then its @import target. */
const basicCss = (): string => [readFixture('style.css'), readFixture('second.css')].join('\n');

const tokensOf = (css: string) => extractTokens(css).tokens;

describe('extractTokens — colors', () => {
  // why: THE T17 acceptance criterion, and the sealed A17 gate in the same shape. `tokens.json` is
  // the quantitative evidence the reverse-design skill cites; if the dominant brand color of a
  // page were not surfaced as the primary, every downstream design analysis would be citing the
  // wrong color. Runs on the real fixture bytes, so a regression in ANY stage (analyzer context
  // reading, hex normalization, clustering, neutral detection) fails here rather than in the
  // 90-second e2e.
  it('reports the basic fixture brand color as the dominant, non-neutral primary', () => {
    const tokens = tokensOf(basicCss());
    const dominant = [...tokens.colors].sort((a, b) => b.count - a.count)[0];

    expect(dominant.hex).toBe('#3347ff');
    // 7 uses in style.css (custom property, border, 3× color, background, outline) + 5 in second.css.
    expect(dominant.count).toBe(12);
    expect(tokens.palette.primaryGuess).toBe('#3347ff');
    expect(tokens.palette.accents).not.toContain('#3347ff');
    expect(dominant.oklch).toMatch(/^oklch\(\d+% \d+\.\d{2} \d+\)$/);
  });

  // why: clustering exists so `#635bff` and `#645cfe` — the same brand color, rounded differently
  // by two hand-written stylesheets — do not appear as two brand colors. The representative must be
  // the HIGHEST-COUNT member (spec 05), not whichever the analyzer happened to emit first;
  // customize-clone rewrites a site's brand by matching on `clusterOf`, so a wrong representative
  // means a find-and-replace that misses most of the page.
  it('merges near-duplicate colors, keeping the highest-count member as representative', () => {
    const tokens = tokensOf('.a{color:#3347fe}.b{color:#3347ff}.c{color:#3347ff}.d{color:#3347ff}');

    expect(tokens.colors).toHaveLength(1);
    expect(tokens.colors[0].hex).toBe('#3347ff');
    expect(tokens.colors[0].count).toBe(4);
    expect(tokens.colors[0].clusterOf).toEqual(['#3347ff', '#3347fe']);
  });

  // why: pins BOTH sides of the OKLab deltaE < 0.02 threshold with real values that bracket it
  // (white↔#f7f9fc is 0.019, white↔#f4f6fa is 0.028). Without this, a culori upgrade that changed
  // the deltaE formula, or a stray edit to CLUSTER_DELTA_E, would silently collapse a page's whole
  // neutral ramp into one swatch — or shatter one brand color into five — and no other test notices.
  it('clusters just under the deltaE threshold and separates just over it', () => {
    expect(tokensOf('.a{color:#ffffff}.b{color:#f7f9fc}').colors).toHaveLength(1);

    const apart = tokensOf('.a{color:#ffffff}.b{color:#f4f6fa}');
    expect(apart).toBeDefined();
    expect(apart.colors.map((c) => c.hex)).toEqual(['#ffffff', '#f4f6fa']);
  });

  // why: culori PARSES `transparent` as rgba(0,0,0,0), which formatHex flattens to `#000000`. A
  // single `color: transparent` would therefore invent a pure-black brand color that appears
  // nowhere on the page. `currentColor`/`inherit` are unparseable and must not crash the run.
  it('drops transparent/currentColor/inherit instead of resolving them to black', () => {
    const tokens = tokensOf('.a{color:transparent}.b{color:currentColor}.c{color:inherit}');

    expect(tokens.colors).toEqual([]);
    expect(tokens.palette.primaryGuess).toBeNull();
  });

  // why: `roles` tells the agent WHERE a color is used (text vs background vs border). The mapping
  // has three traps: `color` must match exactly (so `caret-color` is not text), `outline*` folds
  // into `border`, and `*shadow` is matched by suffix. A custom property is `other`, never dropped.
  it('normalizes every color context onto the closed role vocabulary', () => {
    expect(normalizeRole('color')).toBe('text');
    expect(normalizeRole('caret-color')).toBe('other');
    expect(normalizeRole('background-image')).toBe('background');
    expect(normalizeRole('border-top-color')).toBe('border');
    expect(normalizeRole('outline-color')).toBe('border');
    expect(normalizeRole('box-shadow')).toBe('shadow');
    expect(normalizeRole('text-shadow')).toBe('shadow');
    expect(normalizeRole('stroke')).toBe('fill');

    const tokens = tokensOf(
      ':root{--x:#111111}.a{color:#111111}.b{background-color:#111111}' +
        '.c{border-top-color:#111111}.d{outline-color:#111111}' +
        '.e{box-shadow:0 0 0 1px #111111}.f{fill:#111111}.g{stroke:#111111}',
    );
    expect(tokens.colors).toHaveLength(1);
    // Canonical order, never Object.keys() order — otherwise tokens.json churns between runs.
    expect(tokens.colors[0].roles).toEqual([
      'text',
      'background',
      'border',
      'shadow',
      'fill',
      'other',
    ]);
  });

  // why: spec 05 sorts clusters by OKLCH lightness descending, NOT by count — the array reads as a
  // light-to-dark ramp. This fixture makes the two orders disagree (black is used 3×, white once),
  // so a lazy `sort by count` cannot pass.
  it('orders clusters by OKLCH lightness descending, not by usage count', () => {
    const tokens = tokensOf('.a{color:#000000}.b{color:#000000}.c{color:#000000}.d{color:#ffffff}');
    expect(tokens.colors.map((c) => c.hex)).toEqual(['#ffffff', '#000000']);
  });

  // why: `primaryGuess` drives the whole reverse-design brand story, and a page is mostly greys —
  // so the guess must skip neutrals (OKLCH chroma < 0.03) no matter how often they appear. White is
  // used 3× here and must still lose to a brand color used twice. `accents` excludes the primary
  // and caps at 6 so a gradient-heavy page cannot flood the palette.
  it('splits the palette into neutrals, a chromatic primary, and capped accents', () => {
    const tokens = tokensOf(
      '.a{color:#3347ff}.b{color:#3347ff}.c{color:#ff0000}' +
        '.d{color:#ffffff}.e{color:#ffffff}.f{color:#ffffff}',
    );
    expect(tokens.palette.primaryGuess).toBe('#3347ff');
    expect(tokens.palette.neutrals).toEqual(['#ffffff']);
    expect(tokens.palette.accents).toEqual(['#ff0000']);

    const hues = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8000', '#8000ff'];
    // Give each hue a distinct, descending count so `accents` order is fully determined.
    const css = hues.map((hex, i) => `.h${i}{color:${hex}}`.repeat(hues.length - i)).join('');
    const many = tokensOf(css);
    expect(many.palette.primaryGuess).toBe('#ff0000');
    expect(many.palette.accents).toHaveLength(6);
    expect(many.palette.accents[0]).toBe('#00ff00');
  });
});

describe('extractTokens — typography', () => {
  // why: the other half of the T17 acceptance criterion and of sealed A17 ("Fixture Sans"). Proves
  // the whole family path end to end: the stack's first non-generic entry becomes the name, the
  // `body` selector sets usage, and the `@font-face` `src` is matched back to it by family name.
  it('captures the basic fixture primary family with its usage and face', () => {
    const tokens = tokensOf(basicCss());
    expect(tokens.typography.families).toEqual([
      { name: 'Brand Sans', usage: 'body', faces: ['fonts/brand.woff2'] },
    ]);
  });

  // why: `font-family: sans-serif` names a fallback category, not a typeface. Without the
  // generic-stack filter every site on earth would report "sans-serif" as a design token, and
  // `var(--font)` would surface a family literally named "var(--font)".
  it('ignores generic-only stacks and unresolvable var() families', () => {
    const tokens = tokensOf(
      '.a{font-family:sans-serif}.b{font-family:var(--f), sans-serif}.c{font-family:"Real Font", serif}',
    );
    expect(tokens.typography.families.map((f) => f.name)).toEqual(['Real Font']);
  });

  // why: usage is what tells the agent "this is the display face, that is the body face". `both`
  // must appear when one family does double duty, and a heading-only family must NOT be relabelled
  // `body` just because it is not the dominant one.
  it('classifies usage as heading, body, or both from the declaring selectors', () => {
    const tokens = tokensOf(
      'h1{font-family:Display, serif}' +
        'body{font-family:Inter, sans-serif}p{font-family:Inter, sans-serif}',
    );
    const byName = Object.fromEntries(tokens.typography.families.map((f) => [f.name, f.usage]));
    expect(byName).toEqual({ Inter: 'body', Display: 'heading' });

    const both = tokensOf('body{font-family:Inter, sans-serif}h2{font-family:Inter, sans-serif}');
    expect(both.typography.families[0].usage).toBe('both');
  });

  // why: inside `@font-face`, `font-family` NAMES the face being defined — it is a declaration, not
  // a use. Counting it would make every declared-but-never-rendered webfont (a very common thing on
  // real sites, and exactly what T16's css-fetch stage goes out of its way to capture) look like a
  // deliberate typography choice, and could even make it the "most-used" family.
  it('does not treat an @font-face descriptor as a usage of that family', () => {
    const tokens = tokensOf(
      '@font-face{font-family:"Unused Face";src:url(unused.woff2)}body{font-family:"Used Face", sans-serif}',
    );
    expect(tokens.typography.families).toEqual([{ name: 'Used Face', usage: 'body', faces: [] }]);
  });

  // why: a family is served by several faces (woff2 + woff fallback); `faces` must list every
  // `url()` in `src`, in order, so build-from-design can copy them all. Quoted and bare url()
  // forms both occur in real CSS.
  it('collects every url() of a matching @font-face src', () => {
    const tokens = tokensOf(
      '@font-face{font-family:Brand;src:url("a.woff2") format("woff2"), url(a.woff) format("woff")}' +
        'body{font-family:Brand, sans-serif}',
    );
    expect(tokens.typography.families[0].faces).toEqual(['a.woff2', 'a.woff']);
  });

  // why: rem/em must resolve at the 16 px root or the type scale is nonsense; `%` and keywords have
  // no px value and must be excluded rather than coerced to NaN (which would poison the sort and
  // the ratio median).
  it('converts font sizes to px at the 16px root and excludes %/keywords', () => {
    const tokens = tokensOf(
      'body{font-size:1rem}h1{font-size:48px}h2{font-size:2em}.x{font-size:120%}.y{font-size:larger}',
    );
    expect(tokens.typography.sizesPx).toEqual([16, 32, 48]);
  });

  // why: `scaleRatioGuess` is the "this is a 1.25 modular scale" claim the reverse-design report
  // makes. It is the MEDIAN of adjacent ratios (robust to one outlier size), and it must be null
  // below three sizes — two sizes give one ratio, which is a coincidence, not a scale.
  it('guesses the scale ratio as the median of adjacent ratios, null below three sizes', () => {
    // sizes [16, 32, 48] ⇒ ratios [2, 1.5] ⇒ median 1.75.
    expect(tokensOf('a{font-size:16px}b{font-size:32px}c{font-size:48px}').typography.scaleRatioGuess).toBe(1.75);
    expect(tokensOf('a{font-size:16px}b{font-size:32px}').typography.scaleRatioGuess).toBeNull();
  });

  // why: `normal`/`bold` are the same design decision as 400/700 and must not split the weight
  // ramp in two. `lighter`/`bolder` are relative to an inherited value — there is no absolute
  // number to record, and inventing one would be a lie.
  it('normalizes normal/bold to 400/700 and skips relative keywords', () => {
    const tokens = tokensOf(
      'body{font-weight:normal}h1{font-weight:bold}.a{font-weight:600}.b{font-weight:lighter}',
    );
    expect(tokens.typography.weights).toEqual([400, 600, 700]);
  });

  // why: only unitless line-heights are a reusable token (`1.5` scales with font-size, `24px` does
  // not). Keeping `24px` would put a value two orders of magnitude off into the same array.
  it('keeps only unitless line-heights', () => {
    const tokens = tokensOf('body{line-height:1.5}h1{line-height:1.2}.a{line-height:24px}.b{line-height:normal}');
    expect(tokens.typography.lineHeights).toEqual([1.2, 1.5]);
  });
});

describe('extractTokens — spacing, radii, shadows, motion', () => {
  // why: `base` is the claim "this design is on an 8px grid". It must be count-weighted over
  // OCCURRENCES (a value used 10× counts 10×), and use a finer 4px grid only with alignment
  // evidence — otherwise arbitrary dimensions get reported as a grid.
  it('picks the 8px base only when most spacing occurrences land on it', () => {
    expect(tokensOf('.a{padding:8px}.b{margin:16px}.c{gap:24px}.d{padding:8px}').spacing.base).toBe(8);
    expect(tokensOf('.a{padding:4px}.b{padding:12px}.c{padding:20px}.d{padding:4px}').spacing.base).toBe(4);
  });

  // why: three separate traps. (1) `margin: 0 auto` is centering, not spacing — zero and keyword
  // values must never enter the histogram. (2) A value seen once is noise, not a scale step.
  // (3) Repeated 1px hairlines provide neither a spacing grid nor a reusable spacing step.
  it('builds the spacing scale from repeated, positive, snapped values only', () => {
    const tokens = tokensOf('.a{padding:1rem}.b{padding:1rem}.c{margin:0 auto}.d{gap:24px}');
    expect(tokens.spacing.scalePx).toEqual([16]);

    // 14px snaps to 16 on the 8px grid, joining the two literal 16px uses.
    const snapped = tokensOf('.a{padding:16px}.b{padding:16px}.c{padding:14px}.d{margin:32px}');
    expect(snapped.spacing.scalePx).toEqual([16]);

    const hairline = tokensOf('.a{padding:1px}.b{padding:1px}');
    expect(hairline.spacing.base).toBeNull();
    expect(hairline.spacing.scalePx).toEqual([]);
  });

  // why: `border-radius: 50%` and `border-radius: 9999px` are the same design decision ("pill/
  // circle") expressed two ways; collapsing both onto one sentinel is what lets a consumer say
  // "this design uses pills" without unit maths. Multi-value shorthands carry several real radii.
  it('splits multi-value radii and collapses pill radii onto the sentinel', () => {
    const tokens = tokensOf(
      '.a{border-radius:4px 8px}.b{border-radius:50%}.c{border-radius:9999px}.d{border-radius:0}.e{border-radius:30%}',
    );
    expect(tokens.radii).toEqual([0, 4, 8, RADIUS_PILL_SENTINEL]);
  });

  // why: shadows are ranked by usage so the first entry is the design's default elevation, not
  // whichever rule the parser reached first.
  it('ranks box-shadows by usage count', () => {
    const tokens = tokensOf('.a{box-shadow:0 2px 4px #111}.b{box-shadow:0 1px 2px #000}.c{box-shadow:0 1px 2px #000}');
    expect(tokens.shadows[0]).toContain('0 1px 2px');
    expect(tokens.shadows).toHaveLength(2);
  });

  // why: durations arrive as `.3s` and `150ms` and must land in ONE comparable unit, or the
  // motion story ("everything is 150–300ms") cannot be told. `@keyframes` names stay in document
  // order because that is the order a reader of the stylesheet meets them.
  it('normalizes durations to integer ms and lists keyframes in document order', () => {
    const tokens = tokensOf(
      '.a{transition:all 150ms ease-in-out}.b{animation:fadeUp .3s linear}' +
        '@keyframes fadeUp{from{opacity:0}}@keyframes other{from{opacity:0}}',
    );
    expect(tokens.motion.durationsMs).toEqual([150, 300]);
    expect(tokens.motion.easings).toContain('ease-in-out');
    expect(tokens.motion.keyframes).toEqual(['fadeUp', 'other']);
  });
});

describe('extractTokens — contract', () => {
  // why: `tokens.json` is a committed-looking artifact users diff between runs. Every list is
  // sorted with an explicit tiebreak precisely so Set/Map iteration order can never leak into the
  // output. If someone drops a tiebreak, the same CSS starts producing different bytes.
  it('is deterministic: identical CSS yields byte-identical JSON', () => {
    const css = basicCss();
    expect(JSON.stringify(tokensOf(css))).toBe(JSON.stringify(tokensOf(css)));
  });

  // why: real captured CSS contains vendor hacks and truncated rules. css-tree recovers by parking
  // them in Raw nodes; that recovery must be REPORTED (CONVENTIONS.md forbids bare
  // catch-and-continue), not swallowed — a user whose tokens look wrong deserves to know a rule
  // failed to parse.
  it('reports css-tree parse recoveries as warnings instead of swallowing them', () => {
    const clean = extractTokens('.a{color:red}');
    expect(clean.warnings).toEqual([]);

    const broken = extractTokens('.a{ : red }');
    expect(broken.warnings).toHaveLength(1);
    expect(broken.warnings[0]).toMatch(/css parse:/);
  });

  // why: the tokens.json schema promises every key is present with an array/object value, never
  // absent — consumers index into `typography.families` and `motion.keyframes` without guards.
  // Empty CSS is the degenerate case that would otherwise return undefineds.
  it('always emits the full schema, even for empty CSS', () => {
    const tokens = tokensOf('');
    expect(Object.keys(tokens)).toEqual([
      'schemaVersion',
      'colors',
      'palette',
      'typography',
      'spacing',
      'radii',
      'shadows',
      'motion',
      'provenance',
    ]);
    expect(tokens.schemaVersion).toBe(2);
    expect(tokens.spacing).toEqual({ base: null, scalePx: [] });
    expect(tokens.provenance).toEqual({
      kind: 'css-declaration-census', source: 'clone', rendered: false,
      sources: [], assumptions: [], unresolved: [], warnings: [],
    });
    expect(tokens.colors).toEqual([]);
    expect(tokens.palette).toEqual({ primaryGuess: null, neutrals: [], accents: [] });
    expect(tokens.typography.families).toEqual([]);
    expect(tokens.typography.scaleRatioGuess).toBeNull();
    expect(tokens.motion.keyframes).toEqual([]);
  });
});

describe('schema 2 — truthful declaration evidence', () => {
  // Why: every zero-alpha spelling is invisible; treating it as opaque invents a dominant brand color.
  it('excludes fully transparent hex and functional colors from palette candidates', () => {
    const tokens = tokensOf('.a{color:#ff000000;background:rgba(255,0,0,0);border-color:rgb(255 0 0 / 0%)}.b{color:#3347ff}');
    expect(tokens.colors).toHaveLength(1);
    expect(tokens.palette.primaryGuess).toBe('#3347ff');
    expect(tokens.colors[0]).toMatchObject({ hex: '#3347ff', alpha: 1, css: '#3347ff' });
  });

  // Why: opacity changes compositing; clusters and palette strings must not flatten it away.
  it('separates opacity variants and preserves alpha in palette values and members', () => {
    const tokens = tokensOf('.a{color:rgb(51 71 255 / 0.5);background:rgb(51 71 255 / 0.5)}.b{color:#3347ff}.c{color:rgb(51 71 255 / 0.25)}');
    expect(tokens.colors).toHaveLength(3);
    expect(tokens.colors.map((color) => color.alpha).sort()).toEqual([0.25, 0.5, 1]);
    const translucent = tokens.colors.find((color) => color.alpha === 0.5)!;
    expect(translucent.count).toBe(2);
    expect(translucent.css).toBe('rgb(51 71 255 / 0.5)');
    expect(translucent.oklch).toMatch(/^oklch\(\d+% \d+\.\d{2} \d+ \/ 0\.5\)$/);
    expect(translucent.clusterOf).toEqual(['rgb(51 71 255 / 0.5)']);
    expect(tokens.palette.primaryGuess).toBe(translucent.css);
  });

  // Why: font shorthand carries the chosen family and weight, while its line-height is not a weight.
  it('extracts semantic font shorthand components including implicit normal weight', () => {
    const tokens = tokensOf('h1{font:italic small-caps 650 24px/1.4 "A B",serif}body{font:16px/1.5 Body,sans-serif}');
    expect(tokens.typography.families).toEqual([
      { name: 'A B', usage: 'heading', faces: [] },
      { name: 'Body', usage: 'body', faces: [] },
    ]);
    expect(tokens.typography.weights).toEqual([400, 650]);
    expect(tokens.typography.sizesPx).toEqual([16, 24]);
    expect(tokens.typography.lineHeights).toEqual([1.4, 1.5]);
  });

  // Why: ancestors and :has/:not arguments describe relationships, not the element receiving the font.
  it('classifies the selector subject without inventing body usage from declaration popularity', () => {
    const tokens = tokensOf('body h1{font-family:Display}h1 .child{font-family:Child}' +
      '.container:has(h1){font-family:Container}:not(h1){font-family:Excluded}' +
      'body :is(h2,h3){font-family:Subheading}:where(body,p){font-family:Reading}');
    expect(Object.fromEntries(tokens.typography.families.map((family) => [family.name, family.usage]))).toEqual({
      Display: 'heading', Child: 'unknown', Container: 'unknown', Excluded: 'unknown',
      Subheading: 'heading', Reading: 'body',
    });
  });

  // Why: values inside calc/clamp/var are inputs, not the resulting spacing or radius on screen.
  it('never emits arithmetic operands as spacing/radius steps and returns null without evidence', () => {
    const functions = tokensOf('.a{padding:calc(100% - 16px);margin:clamp(8px,2vw,32px);gap:var(--space);border-radius:calc(4px + 8px + 12px)}');
    expect(functions.spacing).toEqual({ base: null, scalePx: [] });
    expect(functions.radii).toEqual([]);
    expect(functions.provenance.unresolved.map((entry) => entry.property)).toEqual([
      'padding', 'margin', 'gap', 'border-radius',
    ]);
    const mixed = tokensOf('.a{padding:calc(100% - 8px) 24px}.b{margin:24px}');
    expect(mixed.spacing).toEqual({ base: 8, scalePx: [24] });
  });

  // Why: odd-only distances support no 4px/8px grid; preserve repeated measured values instead of snapping them.
  it('returns no spacing base for unsupported odd steps and keeps their actual repeated lengths', () => {
    expect(tokensOf('.a{padding:7px}.b{margin:7px}.c{gap:11px}.d{padding:11px}').spacing)
      .toEqual({ base: null, scalePx: [7, 11] });
    expect(tokensOf('.a{padding:7px}.b{margin:11px}').spacing).toEqual({ base: null, scalePx: [] });
  });

  // Why: static em/rem conversion is an estimate, and percentages/functions cannot be measured from CSS alone.
  it('records relative-unit assumptions and unresolved declaration context', () => {
    const tokens = tokensOf('html{font-size:10px}.card{padding:1rem 2em;width:calc(100% - 1rem);font-size:120%}');
    expect(tokens.provenance.rendered).toBe(false);
    expect(tokens.provenance.assumptions).toEqual([
      'em lengths estimated using 16px; actual root/element font size was not measured',
      'rem lengths estimated using 16px; actual root/element font size was not measured',
    ]);
    expect(tokens.provenance.unresolved).toContainEqual({
      selector: '.card', property: 'font-size', value: '120%',
      reason: 'percentage requires a rendered reference size',
    });
    expect(tokens.provenance.unresolved).toContainEqual({
      selector: '.card', property: 'width', value: 'calc(100% - 1rem)',
      reason: 'function requires rendered measurements or variable resolution',
    });
  });

  // Why: system fonts and variable shorthands cannot name a concrete family without a browser.
  it('reports unresolved font shorthands without inventing families or numeric weights', () => {
    const tokens = tokensOf('.a{font:menu}.b{font:var(--font)}.c{font-weight:calc(100 + 200)}.d{font-family:var(--family),"Fallback"}');
    expect(tokens.typography.families).toEqual([]);
    expect(tokens.typography.weights).toEqual([]);
    expect(tokens.provenance.unresolved).toHaveLength(4);
  });
});
