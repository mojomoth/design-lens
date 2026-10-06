/**
 * Unit tests for the pure half of `inspect --lite` (`analyze/inspect-lite.ts`) and for the option
 * plan of `commands/inspect.ts`. No browser: the in-page probe is covered by e2e/inspect-lite.
 *
 * WHY this file exists: lite output is only useful if it is both small and lossless for the values
 * that carry design intent. The projection decides which computed values are "initial" and may be
 * dropped; a wrong rule either rebuilds the 57 MB dump or silently hides a signature device such as
 * a clip-path chamfer or a pseudo-element corner mark. The option plan is the contract that every
 * invalid combination fails before a port or a browser exists.
 */

import { describe, expect, it } from 'vitest';

import {
  compactSides,
  projectLiteElement,
  validateSelectorSyntax,
  type LiteRawElement,
  type LiteStylesRaw,
} from '../../src/analyze/inspect-lite.js';
import { planInspect } from '../../src/commands/inspect.js';

const ORIGIN = 'http://127.0.0.1:53124';

function initialStyles(overrides: Partial<LiteStylesRaw> = {}): LiteStylesRaw {
  return {
    color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', fontFamily: 'Arial', fontSize: '16px',
    lineHeight: 'normal', fontWeight: '400', letterSpacing: 'normal', textTransform: 'none',
    padding: ['0px', '0px', '0px', '0px'], margin: ['0px', '0px', '0px', '0px'], radius: ['0px', '0px', '0px', '0px'],
    borderWidth: ['0px', '0px', '0px', '0px'], borderStyle: ['none', 'none', 'none', 'none'],
    borderColor: ['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'], boxShadow: 'none',
    display: 'inline', position: 'static', gridTemplateColumns: 'none', gridTemplateRows: 'none',
    rowGap: 'normal', columnGap: 'normal', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'normal',
    justifyContent: 'normal', backgroundImage: 'none', maskImage: 'none', transform: 'none', filter: 'none',
    opacity: '1', mixBlendMode: 'normal', clipPath: 'none',
    ...overrides,
  };
}

function raw(overrides: Partial<LiteRawElement> = {}, styles: Partial<LiteStylesRaw> = {}): LiteRawElement {
  return {
    id: 'dl-7', tag: 'span', text: '', rect: [0, 0, 10, 10], visible: true, parent: 'dl-6', matched: [],
    styles: initialStyles(styles), before: null, after: null,
    ...overrides,
  };
}

describe('compactSides', () => {
  // why: four-sided values dominate element size; without CSS shorthand compaction every padded
  // element repeats four identical strings and lite output grows back toward the full dump.
  it('compacts like the CSS four-value shorthand', () => {
    expect(compactSides(['4px', '4px', '4px', '4px'])).toBe('4px');
    expect(compactSides(['4px', '8px', '4px', '8px'])).toBe('4px 8px');
    expect(compactSides(['4px', '8px', '2px', '8px'])).toBe('4px 8px 2px');
    expect(compactSides(['1px', '2px', '3px', '4px'])).toBe('1px 2px 3px 4px');
  });
});

describe('projectLiteElement', () => {
  // why: the size win depends on dropping CSS-initial values; if an initial value leaks, every
  // element carries empty box/layout/fx groups and an agent cannot tell what is actually styled.
  it('reduces an element with only initial values to the required keys', () => {
    const element = projectLiteElement(raw(), ORIGIN);
    expect(element).toEqual({
      id: 'dl-7', tag: 'span', r: [0, 0, 10, 10], v: 1,
      font: 'Arial|16px/normal|400|normal|none', color: 'rgb(0, 0, 0)', parent: 'dl-6',
    });
  });

  // why: these are the values that carry signature devices (chamfered buttons, corner marks,
  // frames, grids); losing any of them makes lite unusable for the Signature priority table.
  it('keeps non-initial box, layout, effect and pseudo values in schema key order', () => {
    const element = projectLiteElement(raw({
      text: 'Start', matched: ['.cta'], rect: [10.04, 20.06, 100.25, 40],
      before: { content: '""', backgroundColor: 'rgb(255, 102, 0)', backgroundImage: 'none', width: '8px', height: '8px' },
    }, {
      backgroundColor: 'rgb(255, 102, 0)', padding: ['12px', '24px', '12px', '24px'], radius: ['4px', '4px', '4px', '4px'],
      borderWidth: ['1px', '1px', '1px', '1px'], borderStyle: ['solid', 'solid', 'solid', 'solid'],
      boxShadow: 'rgba(0, 0, 0, 0.2) 0px 2px 4px 0px', display: 'flex', position: 'relative',
      rowGap: '8px', columnGap: '16px', flexDirection: 'column', alignItems: 'center',
      backgroundImage: `url("${ORIGIN}/assets/a.svg")`, clipPath: 'polygon(0px 0px, 100% 0px, 100% 70%, 0px 100%)',
      opacity: '0.5', mixBlendMode: 'multiply',
    }), ORIGIN, 'cta');
    expect(Object.keys(element)).toEqual(['id', 'tag', 'role', 'text', 'r', 'v', 'font', 'color', 'bg', 'box', 'layout', 'fx', 'before', 'parent', 'matched']);
    expect(element.r).toEqual([10, 20.1, 100.3, 40]);
    expect(element.box).toEqual({ pad: '12px 24px', radius: '4px', border: '1px solid rgb(0, 0, 0)', shadow: 'rgba(0, 0, 0, 0.2) 0px 2px 4px 0px' });
    expect(element.layout).toEqual({ display: 'flex', position: 'relative', gap: '8px 16px', flex: 'column nowrap', align: 'center' });
    expect(element.fx).toEqual({
      bgImage: 'url("/assets/a.svg")', clipPath: 'polygon(0px 0px, 100% 0px, 100% 70%, 0px 100%)', opacity: '0.5', blend: 'multiply',
    });
    expect(element.before).toEqual({ content: '""', bg: 'rgb(255, 102, 0)', size: '8px 8px' });
  });

  // why: grid/flex properties on a block element have no effect; reporting them would mislead a
  // rebuild into inventing a layout the reference does not have.
  it('reports container-only properties only for flex and grid containers', () => {
    const block = projectLiteElement(raw({}, { display: 'block', alignItems: 'center', rowGap: '8px', columnGap: '8px', flexDirection: 'column' }), ORIGIN);
    expect(block.layout).toEqual({ display: 'block' });
    const grid = projectLiteElement(raw({}, { display: 'grid', gridTemplateColumns: '100px 100px', rowGap: '8px', columnGap: '8px' }), ORIGIN);
    expect(grid.layout).toEqual({ display: 'grid', cols: '100px 100px', gap: '8px' });
  });

  // why: single-side rules (a bottom hairline under a nav) are common design devices; collapsing
  // them into one value or dropping them would misdescribe the frame.
  it('lists borders per side when the sides differ', () => {
    const element = projectLiteElement(raw({}, {
      borderWidth: ['0px', '0px', '1px', '0px'], borderStyle: ['none', 'none', 'solid', 'none'],
      borderColor: ['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(158, 158, 158)', 'rgb(0, 0, 0)'],
    }), ORIGIN);
    expect(element.box).toEqual({ border: 'none | none | 1px solid rgb(158, 158, 158) | none' });
  });

  // why: unstamped selector matches must stay addressable by path, and the ephemeral server origin
  // must never leak into agent-facing output (it changes on every run).
  it('keeps the path of an unstamped match and strips the serving origin from pseudo backgrounds', () => {
    const element = projectLiteElement(raw({
      id: null, path: '[data-dl-id="dl-9"] > span:nth-of-type(1)', visible: false, matched: ['.frame span'],
      after: { content: '"→"', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: `url("${ORIGIN}/i.svg")`, width: 'auto', height: 'auto' },
    }), ORIGIN);
    expect(element).toMatchObject({ id: null, v: 0, path: '[data-dl-id="dl-9"] > span:nth-of-type(1)', matched: ['.frame span'] });
    expect(element.after).toEqual({ content: '"→"', bg: 'url("/i.svg")' });
    expect(JSON.stringify(element)).not.toContain('127.0.0.1');
  });

  // why: `content: url(…)` icons compute to an absolute URL on the ephemeral server exactly like
  // background images; leaving it would leak a per-run origin into the agent-facing document.
  it('strips the serving origin from pseudo-element url() content', () => {
    const element = projectLiteElement(raw({
      before: { content: `url("${ORIGIN}/assets/mark.svg")`, backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', width: '50px', height: '20px' },
    }), ORIGIN);
    expect(element.before).toEqual({ content: 'url("/assets/mark.svg")', size: '50px 20px' });
  });

  // why: address-only probe records (used by the detailed --selector path) carry no styles; a
  // projection that defaulted them would print invented "initial" styling.
  it('refuses to project an unmeasured record', () => {
    expect(() => projectLiteElement(raw({ styles: null }), ORIGIN)).toThrow(/measured/);
  });
});

describe('validateSelectorSyntax', () => {
  // why: a malformed selector must fail before a port or Chromium is started (exit 1, no JSON).
  it('accepts selector lists and rejects malformed or empty selectors', () => {
    for (const selector of ['h1', '.frame > span', '[data-dl-id="dl-1"]', 'h1, h2']) {
      expect(() => validateSelectorSyntax(selector)).not.toThrow();
    }
    for (const selector of ['', '  ', 'h1[', 'a,,b', 'h1 { color: red }']) {
      expect(() => validateSelectorSyntax(selector)).toThrow(/invalid --selector/);
    }
  });

  // why: css-tree silently drops a trailing comma and keeps a dangling combinator, while the
  // engine throws on all of them; without these checks a typo costs a server, a browser and a
  // full composed-clone navigation before exit 1. Relative selectors nested in :has stay valid.
  it('rejects trailing commas and dangling combinators that css-tree accepts', () => {
    for (const selector of ['h1,', 'h1, h2, ', '.a\\\\,', 'h1 >', '> h1', 'h1 ~', '+ a', 'h1, > p']) {
      expect(() => validateSelectorSyntax(selector), selector).toThrow(/invalid --selector/);
    }
    for (const selector of ['a:has(> img)', 'section:has(+ footer)', 'h1 > p ~ a', ' h1 ', ':is(h1, h2)', '.a\\,']) {
      expect(() => validateSelectorSyntax(selector), selector).not.toThrow();
    }
  });
});

describe('planInspect', () => {
  // why: these combinations have no defined meaning; each must fail before any server or browser.
  it.each([
    [{ all: true, selector: ['h1'] }, /--all/],
    [{ all: true, id: ['dl-1'] }, /--all/],
    [{ kind: 'cta', selector: ['h1'] }, /--kind and --selector/],
    [{ lite: true, viewport: '1440x900', viewports: '390x844' }, /--viewport and --viewports/],
    [{ viewports: '390x844' }, /--viewports requires --lite/],
    [{ lite: true, details: true }, /--lite and --details/],
    [{ lite: true, selector: ['h1['] }, /invalid --selector/],
    [{ lite: true, viewports: '390x844,390x844' }, /duplicate/],
  ])('rejects %o', (options, message) => {
    expect(() => planInspect(options)).toThrow(message);
  });

  // why: ids come first and repeated flags are de-duplicated, so output order is predictable
  // when an agent combines a signature id with a selector.
  it('combines ids and selectors in order and records the multi-viewport shape', () => {
    const plan = planInspect({ lite: true, id: ['dl-2', 'dl-1', 'dl-2'], selector: ['h1', 'h1', 'h2'], viewports: '1440x900,390x844' });
    expect(plan).toMatchObject({ ids: ['dl-2', 'dl-1'], selectors: ['h1', 'h2'], multi: true, lite: true, all: false });
    expect(plan.viewports).toEqual([{ width: 1440, height: 900 }, { width: 390, height: 844 }]);
  });

  // why: the flagless invocation is sealed (A18); its plan must stay the legacy desktop default.
  it('keeps the legacy single desktop viewport when no viewport flag is given', () => {
    expect(planInspect({})).toEqual({
      kind: null, viewports: [{ width: 1440, height: 900 }], multi: false, ids: undefined, selectors: undefined,
      all: false, details: false, lite: false,
    });
  });
});
