/**
 * Unit tests for `analyze/heuristics.ts` — the constants and pure predicates behind spec 05's
 * role table. These run browser-free (spec 08: unit tests never launch Chromium or bind a port).
 *
 * WHY this file exists: `heuristics.ts` is the ONLY place the role vocabulary, the selector list,
 * the confidence ladder and the geometric thresholds are written down. The in-page probe indexes
 * `SELECTORS` positionally and the classifier indexes it right back, so a silent reorder of that
 * array would mis-assign every role while every other test stayed green. Everything asserted here
 * is a contract some other component reads by position or by exact value.
 */

import { describe, expect, it } from 'vitest';

import {
  CTA_MAX_WORDS,
  CTA_MIN_DELTA_E,
  MAX_TEXT_CHARS,
  NAV_LINK_TOP_FRACTION,
  ROLES,
  ROLE_LIMITS,
  ROLE_PATTERNS,
  SECTION_MIN_HEIGHT_PX,
  SELECTORS,
  SINGLE_ELEMENT_ROLES,
  VIEWPORT_HEIGHT,
  collapseText,
  confidenceForPattern,
  dlIdOrdinal,
  intersectsFirstViewport,
  isRole,
  isWithinNavBand,
  relativizeUrl,
  wordCount,
} from '../../src/analyze/heuristics.js';

const rect = (y: number, height = 10, width = 10) => ({ x: 0, y, width, height });

describe('role vocabulary', () => {
  // why: `--kind` validates against this list, the classifier iterates it in order (earlier roles
  // claim elements first), and the output is grouped by it. Spec 05's table order IS this array.
  // A reorder would silently change which role wins a contested element.
  it('is exactly spec 05s seven roles, in table order', () => {
    expect([...ROLES]).toEqual([
      'logo',
      'nav-link',
      'hero-heading',
      'hero-image',
      'cta',
      'footer',
      'section',
    ]);
  });

  // why: the `--kind` guard. Accepting an unknown role would print an empty inventory and exit 0,
  // which reads to the calling skill as "this clone has no CTAs" rather than "you typo'd the flag".
  it('recognizes only the seven role names', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole('nav')).toBe(false);
    expect(isRole('hero')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole('Logo')).toBe(false);
  });

  // why: spec 05 — "logo, hero-heading, hero-image yield at most ONE element each"; cta max 8,
  // section max 12; the rest are uncapped. These caps are the difference between an inventory and
  // a DOM dump.
  it('pins the single-element roles and the per-role caps', () => {
    expect([...SINGLE_ELEMENT_ROLES].sort()).toEqual(['hero-heading', 'hero-image', 'logo']);
    expect(ROLE_LIMITS).toEqual({ cta: 8, section: 12 });
  });

  // why: every role must have at least one candidate pattern, and only `hero-heading`/`cta` carry
  // the table's literal "else" (a fallback pattern). A stray `fallback` on a first pattern would
  // make that role unreachable.
  it('gives every role patterns, and marks a fallback only where spec 05 says "else"', () => {
    for (const role of ROLES) expect(ROLE_PATTERNS[role].length).toBeGreaterThan(0);
    for (const role of ROLES) expect(ROLE_PATTERNS[role][0].fallback).toBeUndefined();

    const withFallback = ROLES.filter((role) => ROLE_PATTERNS[role].some((p) => p.fallback === true));
    expect(withFallback).toEqual(['hero-heading', 'cta']);
  });

  // why: the probe ships `matches[i] = el.matches(SELECTORS[i])` across a `page.evaluate` boundary
  // and the classifier reads those booleans back BY INDEX. If a selector is inserted anywhere but
  // the end, `logo` starts matching `nav a`. This test is the tripwire for that reorder.
  it('binds every selector pattern to the selector it names, by index', () => {
    expect(SELECTORS[0]).toBe('header img');
    expect(SELECTORS[1]).toBe('[class*="logo" i]');
    expect(SELECTORS[4]).toBe('nav a');
    expect(SELECTORS[6]).toBe('h1');
    expect(SELECTORS[8]).toBe('footer');
    expect(SELECTORS[10]).toBe('a, button');

    const logoPatterns = ROLE_PATTERNS.logo;
    expect(logoPatterns[0]).toEqual({ kind: 'selector', selector: 0 });
    expect(logoPatterns[1]).toEqual({ kind: 'selector', selector: 1 });
    expect(ROLE_PATTERNS['nav-link'][0]).toEqual({ kind: 'selector', selector: 4 });
    expect(ROLE_PATTERNS['hero-heading'][0]).toEqual({ kind: 'selector', selector: 6 });
  });

  // why: every pattern's `selector` field must address a real slot. An off-by-one here yields
  // `matches[undefined]` — silently false for every element, so the role just vanishes.
  it('never references a selector index outside SELECTORS', () => {
    for (const role of ROLES) {
      for (const pattern of ROLE_PATTERNS[role]) {
        if (pattern.kind === 'selector') {
          expect(pattern.selector).toBeGreaterThanOrEqual(0);
          expect(pattern.selector).toBeLessThan(SELECTORS.length);
        }
      }
    }
  });
});

describe('confidenceForPattern', () => {
  // why: spec 05 — "0.9 for a role's first-listed pattern, −0.1 per subsequent pattern, floor 0.5".
  // The floor matters: `logo` has four patterns, so without it a fifth would go negative.
  it('walks 0.9 → 0.5 and floors there', () => {
    expect(confidenceForPattern(0)).toBe(0.9);
    expect(confidenceForPattern(1)).toBe(0.8);
    expect(confidenceForPattern(2)).toBe(0.7);
    expect(confidenceForPattern(3)).toBe(0.6);
    expect(confidenceForPattern(4)).toBe(0.5);
    expect(confidenceForPattern(5)).toBe(0.5);
    expect(confidenceForPattern(99)).toBe(0.5);
  });

  // why: `0.9 - 2 * 0.1 === 0.7000000000000001` in IEEE-754, and confidence is serialized straight
  // into the stdout contract. Without the rounding, `inspect` prints a 17-digit float for every
  // third-pattern match — ugly, and a diff-unstable machine contract.
  it('emits short decimals, not IEEE-754 noise', () => {
    for (let i = 0; i < 6; i += 1) {
      expect(JSON.stringify(confidenceForPattern(i)).length).toBeLessThanOrEqual(3);
    }
  });
});

describe('collapseText / wordCount', () => {
  // why: `text` is a one-line label an agent reads, not a transcript. innerText carries the newlines
  // of block children; leaving them in would put raw `\n` into the JSON contract.
  it('collapses whitespace, trims, and truncates at MAX_TEXT_CHARS', () => {
    expect(collapseText('  Ship\n  faithful   clones ')).toBe('Ship faithful clones');
    expect(collapseText('x'.repeat(MAX_TEXT_CHARS + 50))).toHaveLength(MAX_TEXT_CHARS);
  });

  // why: spec 05 — `text` is "null if empty". An empty string would make `text: ""` indistinguishable
  // from "this element has whitespace-only content" for the consuming skill.
  it('returns null for empty and whitespace-only text', () => {
    expect(collapseText('')).toBeNull();
    expect(collapseText('   \n\t ')).toBeNull();
  });

  // why: the CTA fallback tests "text ≤ 4 words". Counting on the TRUNCATED string would let a long
  // heading masquerade as a 4-word CTA once clipped at 120 chars.
  it('counts words on the full text, before truncation', () => {
    expect(wordCount('Get started')).toBe(2);
    expect(wordCount('  one\ttwo\nthree  ')).toBe(3);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount(`${'word '.repeat(CTA_MAX_WORDS + 1)}`)).toBe(CTA_MAX_WORDS + 1);
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    expect(long.length).toBeGreaterThan(MAX_TEXT_CHARS);
    expect(wordCount(long)).toBe(40);
  });
});

describe('geometry predicates', () => {
  // why: spec 05 keeps only nav anchors "whose rect top is within the top 25% of the viewport" —
  // this is what stops a footer's `<nav>` link list from being reported as site navigation.
  it('accepts nav candidates in the top quarter and rejects the rest', () => {
    const band = VIEWPORT_HEIGHT * NAV_LINK_TOP_FRACTION;
    expect(band).toBe(225);
    expect(isWithinNavBand(rect(0), VIEWPORT_HEIGHT)).toBe(true);
    expect(isWithinNavBand(rect(224), VIEWPORT_HEIGHT)).toBe(true);
    expect(isWithinNavBand(rect(225), VIEWPORT_HEIGHT)).toBe(true);
    expect(isWithinNavBand(rect(226), VIEWPORT_HEIGHT)).toBe(false);
    expect(isWithinNavBand(rect(3200), VIEWPORT_HEIGHT)).toBe(false);
    // Never scrolled, so a negative top means "positioned off-canvas", not "scrolled past".
    expect(isWithinNavBand(rect(-1), VIEWPORT_HEIGHT)).toBe(false);
  });

  // why: `hero-image`/`hero-heading` are defined as "within/intersecting the FIRST viewport". A
  // zero-area rect (display:none, an empty inline element) must intersect nothing — otherwise a
  // hidden 0×0 `<img>` at the top of the DOM competes for the hero-image slot.
  it('intersects the first viewport only for on-screen, non-degenerate rects', () => {
    expect(intersectsFirstViewport(rect(0, 100), VIEWPORT_HEIGHT)).toBe(true);
    expect(intersectsFirstViewport(rect(899, 100), VIEWPORT_HEIGHT)).toBe(true);
    expect(intersectsFirstViewport(rect(900, 100), VIEWPORT_HEIGHT)).toBe(false);
    expect(intersectsFirstViewport(rect(-50, 100), VIEWPORT_HEIGHT)).toBe(true);
    expect(intersectsFirstViewport(rect(-100, 100), VIEWPORT_HEIGHT)).toBe(false);
    expect(intersectsFirstViewport({ x: 0, y: 10, width: 0, height: 0 }, VIEWPORT_HEIGHT)).toBe(false);
    expect(intersectsFirstViewport({ x: 0, y: 10, width: 10, height: 0 }, VIEWPORT_HEIGHT)).toBe(false);
  });

  // why: a `section` is a page band, not any tall box. The threshold is the only thing separating
  // "this is a page section" from "this is a card".
  it('pins the section height threshold at 200px', () => {
    expect(SECTION_MIN_HEIGHT_PX).toBe(200);
  });

  // why: the CTA contrast threshold is a spec constant the classifier compares against; drifting it
  // silently would turn every mildly tinted button into a CTA (or none of them).
  it('pins the CTA thresholds', () => {
    expect(CTA_MAX_WORDS).toBe(4);
    expect(CTA_MIN_DELTA_E).toBe(0.15);
  });
});

describe('relativizeUrl', () => {
  // why: `background-image` is readable only as the ABSOLUTE url Chromium resolved it to, which for
  // `inspect` embeds the run's EPHEMERAL port. Emitting `http://127.0.0.1:53124/assets/bg.png` would
  // make stdout differ on every run and be useless as a path into the clone directory.
  it('strips the served origin so background urls are clone-relative', () => {
    const origin = 'http://127.0.0.1:53124';
    expect(relativizeUrl(`${origin}/assets/example.com/img/bg.png`, origin)).toBe(
      'assets/example.com/img/bg.png',
    );
    expect(relativizeUrl(`${origin}/index.html`, origin)).toBe('index.html');
    expect(relativizeUrl(origin, origin)).toBe('');
  });

  // why: a `data:` URI and an asset deliberately left remote are already correct; rewriting them
  // would corrupt the reference. Only the loopback origin we ourselves introduced comes back off.
  it('leaves data URIs, remote urls, and already-relative paths untouched', () => {
    const origin = 'http://127.0.0.1:53124';
    expect(relativizeUrl('data:image/png;base64,AAA', origin)).toBe('data:image/png;base64,AAA');
    expect(relativizeUrl('https://cdn.example.com/hero.png', origin)).toBe(
      'https://cdn.example.com/hero.png',
    );
    expect(relativizeUrl('img/hero.png', origin)).toBe('img/hero.png');
    // A different loopback port is a different origin — never stripped.
    expect(relativizeUrl('http://127.0.0.1:9999/a.png', origin)).toBe('http://127.0.0.1:9999/a.png');
  });
});

describe('dlIdOrdinal', () => {
  // why: output is ordered by ascending NUMERIC data-dl-id. String ordering would put `dl-10`
  // before `dl-2`, so the inventory would not read in document order.
  it('orders numerically, not lexically', () => {
    expect(dlIdOrdinal('dl-2')).toBe(2);
    expect(dlIdOrdinal('dl-10')).toBe(10);
    expect([...['dl-10', 'dl-2', 'dl-1']].sort((a, b) => dlIdOrdinal(a) - dlIdOrdinal(b))).toEqual([
      'dl-1',
      'dl-2',
      'dl-10',
    ]);
  });

  // why: a hand-edited clone can carry any `data-dl-id` string. Sorting must degrade (unparseable
  // ids last) rather than throw or produce NaN comparisons that scramble the whole array.
  it('sorts unparseable ids last instead of crashing', () => {
    expect(dlIdOrdinal('custom-id')).toBe(Number.POSITIVE_INFINITY);
    expect(dlIdOrdinal('dl-')).toBe(Number.POSITIVE_INFINITY);
    expect(dlIdOrdinal('dl-1x')).toBe(Number.POSITIVE_INFINITY);
  });
});
