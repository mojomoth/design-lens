/**
 * Unit tests for `analyze/inspect.ts#classify` — spec 05's role heuristics replayed over synthetic
 * probes, with no browser and no server (spec 08: unit tests are browser-free).
 *
 * WHY this file exists: `classify` is the whole judgement of `inspect`. The e2e can only prove that
 * SOME logo/nav/hero/cta came back from one fixture; it cannot reach the rules that decide WHICH
 * element wins a contested role — pattern precedence, the confidence ladder, role exclusivity, the
 * "else" fallbacks, the caps, the transparent-background trap, the un-stamped-candidate skip. Each
 * of those is a way the inventory can be quietly wrong on a real site while every fixture stays
 * green. The seam that makes this testable (probe in the page, decide in Node) exists for this file.
 */

import { describe, expect, it } from 'vitest';

import { SELECTORS, VIEWPORT_HEIGHT } from '../../src/analyze/heuristics.js';
import {
  classify,
  filterByRole,
  type ElementProbe,
  type PageProbe,
} from '../../src/analyze/inspect.js';

const ORIGIN = 'http://127.0.0.1:53124';
const WHITE = 'rgb(255, 255, 255)';
/** The default paint of an unstyled `<a>`/`<button>` background — culori reads it as BLACK. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** The `basic` fixture's brand color: far from white in OKLab, so it clears CTA_MIN_DELTA_E. */
const BRAND = 'rgb(51, 71, 255)';

/** Selector slots, mirrored from `SELECTORS` so a reorder there fails `heuristics.test.ts` first. */
const SEL = {
  headerImg: 0,
  logoClass: 1,
  homeLinkMedia: 2,
  bannerMedia: 3,
  navAnchor: 4,
  navRoleAnchor: 5,
  h1: 6,
  btnOrCtaClass: 7,
  footer: 8,
  contentinfo: 9,
  anchorOrButton: 10,
} as const;

interface ProbeSpec {
  docIndex: number;
  dlId?: string | null;
  tag?: string;
  matches?: number[];
  rawText?: string;
  y?: number;
  width?: number;
  height?: number;
  fontSizePx?: number;
  visible?: boolean;
  hasDirectText?: boolean;
  hasBackgroundImage?: boolean;
  directChildOfBodyOrMain?: boolean;
  src?: string | null;
  background?: string;
}

function probe(spec: ProbeSpec): ElementProbe {
  const matches = SELECTORS.map((_, index) => (spec.matches ?? []).includes(index));
  return {
    dlId: spec.dlId === undefined ? `dl-${spec.docIndex + 1}` : spec.dlId,
    tag: spec.tag ?? 'div',
    rawText: spec.rawText ?? '',
    hasDirectText: spec.hasDirectText ?? (spec.rawText ?? '') !== '',
    src: spec.src ?? null,
    rect: { x: 0, y: spec.y ?? 0, width: spec.width ?? 100, height: spec.height ?? 20 },
    styles: {
      color: 'rgb(16, 24, 40)',
      background: spec.background ?? TRANSPARENT,
      fontSize: `${spec.fontSizePx ?? 16}px`,
      fontFamily: 'Brand Sans',
    },
    fontSizePx: spec.fontSizePx ?? 16,
    visible: spec.visible ?? true,
    hasBackgroundImage: spec.hasBackgroundImage ?? false,
    directChildOfBodyOrMain: spec.directChildOfBodyOrMain ?? false,
    docIndex: spec.docIndex,
    matches,
  };
}

function run(probes: ElementProbe[], bodyBackground = WHITE) {
  const page: PageProbe = { probes, bodyBackground };
  return classify(page, { origin: ORIGIN, viewportHeight: VIEWPORT_HEIGHT });
}

const roleOf = (result: ReturnType<typeof run>, role: string) =>
  result.document.elements.filter((element) => element.role === role);

describe('classify — pattern precedence and confidence', () => {
  // why: spec 05 gives `logo` four patterns and says single-element roles take the "best pattern,
  // then document order". A `[class*="logo"]` element EARLIER in the document must still lose to a
  // `header img` later in it — precedence is by pattern, not by position. Confidence 0.9 records
  // which pattern fired; if the classifier ever scanned document-first, this flips to 0.8.
  it('prefers an earlier pattern over an earlier element, and records the pattern in confidence', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'div', matches: [SEL.logoClass] }),
      probe({ docIndex: 1, tag: 'img', matches: [SEL.headerImg], src: 'img/logo.svg' }),
    ]);

    const logo = roleOf(result, 'logo');
    expect(logo).toHaveLength(1);
    expect(logo[0].dlId).toBe('dl-2');
    expect(logo[0].tag).toBe('img');
    expect(logo[0].confidence).toBe(0.9);
    expect(logo[0].src).toBe('img/logo.svg');
  });

  // why: the sealed fixture's logo is an `<svg>` inside `a.logo` — pattern 1 (`header img`) finds
  // nothing, so pattern 2 must fire at confidence 0.8, choosing the FIRST `[class*="logo"]` in
  // document order (the anchor) over the `.logo-text` span beside it. This is exactly assertion A18.
  it('falls to the next pattern at 0.8 and takes document order within it', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'a', matches: [SEL.logoClass, SEL.anchorOrButton] }),
      probe({ docIndex: 1, tag: 'span', matches: [SEL.logoClass], rawText: 'Fixture Studio' }),
    ]);

    const logo = roleOf(result, 'logo');
    expect(logo).toHaveLength(1);
    expect(logo[0].dlId).toBe('dl-1');
    expect(logo[0].tag).toBe('a');
    expect(logo[0].confidence).toBe(0.8);
  });

  // why: a single-element role stops at its best pattern. Without the early break, `logo` would
  // also collect the pattern-4 `header svg` match and report two logos.
  it('never emits more than one element for a single-element role', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'img', matches: [SEL.headerImg, SEL.bannerMedia] }),
      probe({ docIndex: 1, tag: 'svg', matches: [SEL.bannerMedia] }),
    ]);
    expect(roleOf(result, 'logo')).toHaveLength(1);
  });

  // why: multi-match roles union their patterns, and an element matched by BOTH `nav a` and
  // `[role=navigation] a` must keep the earlier (higher) confidence rather than being downgraded by
  // the later pattern that also happens to match it.
  it('unions multi-match patterns and keeps the highest confidence per element', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'a', matches: [SEL.navAnchor, SEL.navRoleAnchor], rawText: 'Home' }),
      probe({ docIndex: 1, tag: 'a', matches: [SEL.navRoleAnchor], rawText: 'About' }),
    ]);

    const nav = roleOf(result, 'nav-link');
    expect(nav.map((element) => [element.dlId, element.confidence])).toEqual([
      ['dl-1', 0.9],
      ['dl-2', 0.8],
    ]);
  });
});

describe('classify — role exclusivity and ordering', () => {
  // why: "an element already assigned a role is skipped by later roles". A nav anchor styled as a
  // button (`class="btn"`) is navigation, not a call to action — reporting it twice would make the
  // inventory ambiguous for the customize-clone skill, which addresses elements by role.
  it('lets an earlier role claim an element the later role also matches', () => {
    const result = run([
      probe({
        docIndex: 0,
        tag: 'a',
        matches: [SEL.navAnchor, SEL.btnOrCtaClass, SEL.anchorOrButton],
        rawText: 'Sign up',
      }),
    ]);

    expect(roleOf(result, 'nav-link')).toHaveLength(1);
    expect(roleOf(result, 'cta')).toHaveLength(0);
  });

  // why: the hero section carries the hero background AND is a tall direct child of `main`. Since
  // `hero-image` is evaluated before `section`, it must claim the element and leave `section` to the
  // bands below it — otherwise the hero is reported twice under two different roles.
  it('removes a claimed element from the later section role', () => {
    const result = run([
      probe({
        docIndex: 0,
        tag: 'section',
        hasBackgroundImage: true,
        src: `${ORIGIN}/assets/example.com/img/bg.png`,
        height: 700,
        width: 1440,
        directChildOfBodyOrMain: true,
      }),
      probe({ docIndex: 1, tag: 'section', height: 400, width: 1440, directChildOfBodyOrMain: true }),
    ]);

    expect(roleOf(result, 'hero-image').map((e) => e.dlId)).toEqual(['dl-1']);
    expect(roleOf(result, 'section').map((e) => e.dlId)).toEqual(['dl-2']);
  });

  // why: spec 05 — "Elements array ordering: table role order, then ascending numeric data-dl-id
  // within a role." Emission order is match order, so without the explicit sort a `footer` would
  // print before its `nav-link`s and `dl-10` before `dl-2`.
  it('orders by role table order, then ascending numeric dlId', () => {
    const result = run([
      probe({ docIndex: 0, dlId: 'dl-10', tag: 'a', matches: [SEL.navAnchor], rawText: 'B' }),
      probe({ docIndex: 1, dlId: 'dl-2', tag: 'a', matches: [SEL.navAnchor], rawText: 'A' }),
      probe({ docIndex: 2, dlId: 'dl-30', tag: 'footer', matches: [SEL.footer], height: 100 }),
      probe({ docIndex: 3, dlId: 'dl-1', tag: 'img', matches: [SEL.headerImg] }),
    ]);

    expect(result.document.elements.map((element) => [element.role, element.dlId])).toEqual([
      ['logo', 'dl-1'],
      ['nav-link', 'dl-2'],
      ['nav-link', 'dl-10'],
      ['footer', 'dl-30'],
    ]);
  });
});

describe('classify — geometric qualifiers', () => {
  // why: spec 05 keeps only nav anchors in the top 25% of the viewport. A `<nav>` of footer links is
  // the common real-world case; without this filter the inventory reports 20 "nav-links", drowning
  // the three that are actually the site header.
  it('drops nav anchors below the top quarter of the viewport', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'a', matches: [SEL.navAnchor], y: 24, rawText: 'Home' }),
      probe({ docIndex: 1, tag: 'a', matches: [SEL.navAnchor], y: 226, rawText: 'Deep' }),
      probe({ docIndex: 2, tag: 'a', matches: [SEL.navAnchor], y: 3200, rawText: 'Footer' }),
    ]);
    expect(roleOf(result, 'nav-link').map((element) => element.dlId)).toEqual(['dl-1']);
  });

  // why: `hero-image` is "largest img or non-none background-image element intersecting the first
  // viewport, BY RECT AREA". A gallery image further down the page is bigger on many sites; if the
  // viewport test were dropped, the hero would point below the fold.
  it('picks the largest media in the first viewport, ignoring bigger media below the fold', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'img', width: 300, height: 200, y: 100, src: 'a.png' }),
      probe({ docIndex: 1, tag: 'img', width: 900, height: 400, y: 200, src: 'hero.png' }),
      probe({ docIndex: 2, tag: 'img', width: 1400, height: 900, y: 1200, src: 'huge.png' }),
    ]);

    const hero = roleOf(result, 'hero-image');
    expect(hero).toHaveLength(1);
    expect(hero[0].dlId).toBe('dl-2');
    expect(hero[0].src).toBe('hero.png');
    expect(hero[0].confidence).toBe(0.9);
  });

  // why: a `background-image` element competes with `<img>` on equal terms, and its url arrives from
  // getComputedStyle as an ABSOLUTE loopback url. Both facts have to hold at once, or the hero of a
  // background-image hero band is either missed or reported with an ephemeral port in its `src`.
  it('treats a background-image element as media and relativizes its url', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'img', width: 900, height: 400, src: 'hero.png' }),
      probe({
        docIndex: 1,
        tag: 'section',
        width: 1440,
        height: 700,
        hasBackgroundImage: true,
        src: `${ORIGIN}/assets/example.com/img/bg.png`,
      }),
    ]);

    const hero = roleOf(result, 'hero-image');
    expect(hero[0].dlId).toBe('dl-2');
    expect(hero[0].src).toBe('assets/example.com/img/bg.png');
  });

  // why: the `section` role is "direct children of body/main with rect height > 200px". Both halves
  // matter — a tall nested card is not a section, and a short `<section>` band is not one either.
  it('accepts only tall direct children of body/main as sections', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'section', height: 201, directChildOfBodyOrMain: true }),
      probe({ docIndex: 1, tag: 'section', height: 200, directChildOfBodyOrMain: true }),
      probe({ docIndex: 2, tag: 'div', height: 900, directChildOfBodyOrMain: false }),
    ]);
    expect(roleOf(result, 'section').map((element) => element.dlId)).toEqual(['dl-1']);
  });

  // why: the `hero-heading` fallback is "the visible element with the largest computed font-size
  // having direct text, within the first viewport". A hidden 96px element and an off-screen one must
  // both lose to the visible 40px heading, at the fallback's 0.8 confidence.
  it('falls back to the largest visible on-screen text when there is no h1', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'div', fontSizePx: 96, rawText: 'Hidden', visible: false }),
      probe({ docIndex: 1, tag: 'div', fontSizePx: 72, rawText: 'Below', y: 1400 }),
      probe({ docIndex: 2, tag: 'h2', fontSizePx: 40, rawText: 'Real heading' }),
      probe({ docIndex: 3, tag: 'div', fontSizePx: 30, rawText: '', hasDirectText: false }),
    ]);

    const heading = roleOf(result, 'hero-heading');
    expect(heading).toHaveLength(1);
    expect(heading[0].dlId).toBe('dl-3');
    expect(heading[0].confidence).toBe(0.8);
    expect(heading[0].text).toBe('Real heading');
  });

  // why: with an `h1` present, the fallback must not run at all — spec 05's "first h1 · ELSE …".
  it('uses the first h1 and never consults the fallback', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'div', fontSizePx: 96, rawText: 'Giant marketing word' }),
      probe({ docIndex: 1, tag: 'h1', matches: [SEL.h1], fontSizePx: 48, rawText: 'Ship clones' }),
      probe({ docIndex: 2, tag: 'h1', matches: [SEL.h1], fontSizePx: 48, rawText: 'Second h1' }),
    ]);

    const heading = roleOf(result, 'hero-heading');
    expect(heading).toHaveLength(1);
    expect(heading[0].dlId).toBe('dl-2');
    expect(heading[0].confidence).toBe(0.9);
  });
});

/**
 * Every CTA page needs an `h1`: `hero-heading` is evaluated BEFORE `cta`, and with no `h1` its
 * fallback ("largest visible element with direct text") legitimately claims the first `<a>` on the
 * page — which would then be invisible to `cta`. That is correct behaviour, not a bug, so these
 * fixtures give the heading somewhere to land instead of letting it eat the button under test.
 */
const HEADING = probe({ docIndex: 0, tag: 'h1', matches: [SEL.h1], rawText: 'Heading', fontSizePx: 48 });

describe('classify — the CTA fallback', () => {
  // why: spec 05's cta row reads "class*=btn|cta · ELSE short contrasting text". A page that HAS a
  // `.btn` must not also report every short dark-backgrounded link. Without the fallback guard, a
  // real site's `.btn` CTA arrives alongside a dozen tag pills.
  it('never runs the fallback when the class pattern already matched', () => {
    const result = run([
      HEADING,
      probe({
        docIndex: 1,
        tag: 'a',
        matches: [SEL.btnOrCtaClass, SEL.anchorOrButton],
        rawText: 'Get started',
      }),
      probe({
        docIndex: 2,
        tag: 'a',
        matches: [SEL.anchorOrButton],
        rawText: 'Buy now',
        background: BRAND,
      }),
    ]);

    const cta = roleOf(result, 'cta');
    expect(cta.map((element) => element.dlId)).toEqual(['dl-2']);
    expect(cta[0].confidence).toBe(0.9);
  });

  // why: the fallback is the only way to find an unclassed CTA. It fires at 0.8 and demands BOTH
  // halves of the rule — ≤ 4 words AND a background far from the body's.
  it('finds a short, contrasting a/button when no class pattern matched', () => {
    const result = run([
      HEADING,
      probe({ docIndex: 1, tag: 'a', matches: [SEL.anchorOrButton], rawText: 'Buy now', background: BRAND }),
      probe({
        docIndex: 2,
        tag: 'button',
        matches: [SEL.anchorOrButton],
        rawText: 'This label is far too long to be a call to action',
        background: BRAND,
      }),
      probe({
        docIndex: 3,
        tag: 'a',
        matches: [SEL.anchorOrButton],
        rawText: 'Subtle link',
        background: 'rgb(250, 250, 250)',
      }),
    ]);

    const cta = roleOf(result, 'cta');
    expect(cta.map((element) => element.dlId)).toEqual(['dl-2']);
    expect(cta[0].confidence).toBe(0.8);
  });

  // why: THE trap. `rgba(0,0,0,0)` is the default background of every `<a>` and `<button>`, and
  // culori resolves it to BLACK — deltaE ≈ 1.0 from a white page. Without dropping alpha-0 colors,
  // the fallback reports every short link on the page as a CTA. (The same trap bit `tokens`, which
  // is why `transparent` is dropped there too.)
  it('does not mistake a transparent background for a contrasting one', () => {
    const result = run([
      HEADING,
      probe({ docIndex: 1, tag: 'a', matches: [SEL.anchorOrButton], rawText: 'Home', background: TRANSPARENT }),
      probe({ docIndex: 2, tag: 'a', matches: [SEL.anchorOrButton], rawText: 'About', background: TRANSPARENT }),
    ]);
    expect(roleOf(result, 'cta')).toHaveLength(0);
  });

  // why: the contrast is measured against the BODY's background, not against white. On a dark site a
  // white button is the CTA; hard-coding white as the reference would find nothing there.
  it('measures contrast against the body background, not against white', () => {
    const darkBody = 'rgb(10, 37, 64)';
    const result = run(
      [
        HEADING,
        probe({ docIndex: 1, tag: 'a', matches: [SEL.anchorOrButton], rawText: 'Start', background: WHITE }),
        probe({ docIndex: 2, tag: 'a', matches: [SEL.anchorOrButton], rawText: 'Muted', background: darkBody }),
      ],
      darkBody,
    );
    expect(roleOf(result, 'cta').map((element) => element.dlId)).toEqual(['dl-2']);
  });

  // why: a page whose `<body>` leaves the background transparent still paints white. Falling back to
  // white keeps the CTA test meaningful instead of dropping it (a null reference would find no CTAs).
  it('treats a transparent body background as white', () => {
    const result = run(
      [
        HEADING,
        probe({ docIndex: 1, tag: 'a', matches: [SEL.anchorOrButton], rawText: 'Start', background: BRAND }),
      ],
      TRANSPARENT,
    );
    expect(roleOf(result, 'cta').map((element) => element.dlId)).toEqual(['dl-2']);
  });

  // why: spec 05 caps `cta` at 8 and `section` at 12. Uncapped, a card grid of 30 buttons buries the
  // real CTA. The cap must apply AFTER the dlId sort, so it keeps the first eight in document order.
  it('caps cta at 8 elements, keeping the lowest dlIds', () => {
    const probes = [
      HEADING,
      ...Array.from({ length: 12 }, (_, i) =>
        probe({
          docIndex: i + 1,
          tag: 'a',
          matches: [SEL.btnOrCtaClass, SEL.anchorOrButton],
          rawText: `Go ${i}`,
        }),
      ),
    ];
    const cta = roleOf(run(probes), 'cta');
    expect(cta).toHaveLength(8);
    expect(cta.map((element) => element.dlId)).toEqual([
      'dl-2',
      'dl-3',
      'dl-4',
      'dl-5',
      'dl-6',
      'dl-7',
      'dl-8',
      'dl-9',
    ]);
  });

  // why: the section cap is 12, not 8 — two roles, two numbers, and a shared code path that could
  // easily apply the wrong one.
  it('caps section at 12 elements', () => {
    const probes = Array.from({ length: 15 }, (_, i) =>
      probe({ docIndex: i, tag: 'section', height: 400, directChildOfBodyOrMain: true }),
    );
    expect(roleOf(run(probes), 'section')).toHaveLength(12);
  });
});

describe('classify — un-stamped candidates', () => {
  // why: spec 05 — "Candidates lacking a data-dl-id attribute MUST be skipped with a stderr warning."
  // An element with no id cannot be addressed by any skill, so reporting it would hand the agent a
  // selector that matches nothing. Crucially it must be skipped BEFORE it consumes a single-element
  // role's only slot: here the un-stamped `header img` must not deny `logo` to the next candidate.
  // It is warned about again under `hero-image` because it is genuinely a candidate for that role
  // too (an `<img>` in the first viewport) — one warning per role it could have filled.
  it('warns and skips, without letting the skipped element consume a single-element slot', () => {
    const result = run([
      probe({ docIndex: 0, dlId: null, tag: 'img', matches: [SEL.headerImg] }),
      probe({ docIndex: 1, dlId: 'dl-9', tag: 'img', matches: [SEL.headerImg], src: 'logo.svg' }),
    ]);

    const logo = roleOf(result, 'logo');
    expect(logo).toHaveLength(1);
    expect(logo[0].dlId).toBe('dl-9');
    // Confidence stays 0.9: the skip does not advance to the next PATTERN, only the next element.
    expect(logo[0].confidence).toBe(0.9);
    expect(result.warnings).toEqual([
      'candidate without data-dl-id skipped: <img> (role logo)',
      'candidate without data-dl-id skipped: <img> (role hero-image)',
    ]);
    // dl-9 was claimed by `logo`, so the only remaining media candidate was the un-stamped one.
    expect(roleOf(result, 'hero-image')).toHaveLength(0);
  });

  // why: an un-stamped element that matches two patterns of the same role must be warned about once.
  // A duplicate warning per pattern would make stderr noise scale with the pattern table.
  it('warns at most once per element per role', () => {
    const result = run([
      probe({ docIndex: 0, dlId: '', tag: 'a', matches: [SEL.navAnchor, SEL.navRoleAnchor] }),
    ]);
    expect(result.warnings).toEqual(['candidate without data-dl-id skipped: <a> (role nav-link)']);
    expect(roleOf(result, 'nav-link')).toHaveLength(0);
  });
});

describe('classify — the stdout document', () => {
  // why: this is the exact shape spec 05 publishes and every skill parses. `selector` must be
  // derivable from `dlId` alone, `colors` must stay a POINTER to tokens.json (never inlined data —
  // duplicating the palette here would let two files disagree about the brand color).
  it('emits the spec-05 element shape and the colors pointer', () => {
    const result = run([
      probe({
        docIndex: 0,
        dlId: 'dl-17',
        tag: 'img',
        matches: [SEL.headerImg],
        src: 'assets/example.com/logo.svg',
        width: 120,
        height: 32,
      }),
    ]);

    expect(result.document.colors).toBe('see tokens.json');
    expect(result.document.elements[0]).toEqual({
      dlId: 'dl-17',
      role: 'logo',
      confidence: 0.9,
      tag: 'img',
      selector: '[data-dl-id="dl-17"]',
      text: null,
      src: 'assets/example.com/logo.svg',
      rect: { x: 0, y: 0, width: 120, height: 32 },
      styles: {
        color: 'rgb(16, 24, 40)',
        background: TRANSPARENT,
        fontSize: '16px',
        fontFamily: 'Brand Sans',
      },
    });
  });

  // why: an element with no text must serialize `text: null`, not `""` — the schema says "null if
  // empty", and a skill checking `if (element.text)` would otherwise see two different falsy shapes.
  it('collapses text and nulls it when empty', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'a', matches: [SEL.navAnchor], rawText: '  Get\n started  ' }),
      probe({ docIndex: 1, tag: 'img', matches: [SEL.headerImg] }),
    ]);
    expect(roleOf(result, 'nav-link')[0].text).toBe('Get started');
    expect(roleOf(result, 'logo')[0].text).toBeNull();
  });

  // why: `--kind` is a projection over the SAME classification, not a re-run with a narrowed table.
  // Re-running per role would let an element be claimed differently depending on the flag — the
  // inventory would contradict itself between `inspect` and `inspect --kind cta`.
  it('filterByRole projects one role without disturbing the classification', () => {
    const result = run([
      probe({ docIndex: 0, tag: 'img', matches: [SEL.headerImg] }),
      probe({ docIndex: 1, tag: 'a', matches: [SEL.navAnchor], rawText: 'Home' }),
    ]);

    const only = filterByRole(result.document, 'nav-link');
    expect(only.elements.map((element) => element.dlId)).toEqual(['dl-2']);
    expect(only.colors).toBe('see tokens.json');
    // An empty projection is a valid answer, not an error (spec 05).
    expect(filterByRole(result.document, 'section').elements).toEqual([]);
  });

  // why: an empty page must still produce the document envelope. Emitting `undefined`/`{}` would
  // crash `JSON.parse`-then-`.elements.length` in every consuming skill.
  it('returns the envelope for a page with nothing to report', () => {
    const result = run([]);
    expect(result.document).toEqual({ elements: [], colors: 'see tokens.json' });
    expect(result.warnings).toEqual([]);
  });
});
