import { describe, expect, it } from 'vitest';

import { fontFaceCss, responsiveRanges, responsiveSelectors } from '../../src/output/responsive.js';

describe('sampled responsive composition', () => {
  it('selects nearest widths with exact midpoint ties assigned to the larger sample', () => {
    const ranges = responsiveRanges([
      { id: 'desktop', viewport: { width: 1440, height: 900 } },
      { id: 'mobile', viewport: { width: 390, height: 844 } },
      { id: 'tablet', viewport: { width: 768, height: 1024 } },
    ]);
    expect(ranges.map((range) => [range.captureId, range.media])).toEqual([
      ['desktop', '(width >= 1104px)'], ['mobile', '(width < 579px)'],
      ['tablet', '(width >= 579px) and (width < 1104px)'],
    ]);
  });

  it('uses height only within equal-width groups, retaining the accepted viewport interface', () => {
    expect(responsiveRanges([
      { id: 'short', viewport: { width: 390, height: 600 } },
      { id: 'tall', viewport: { width: 390, height: 900 } },
      { id: 'wide', viewport: { width: 1440, height: 600 } },
    ]).map((range) => range.media)).toEqual([
      '(width < 915px) and (height < 750px)', '(width < 915px) and (height >= 750px)', '(width >= 915px)',
    ]);
  });

  it('rejects duplicate dimensions rather than producing overlapping active variants', () => {
    expect(() => responsiveRanges([
      { id: 'a', viewport: { width: 390, height: 844 } }, { id: 'b', viewport: { width: 390, height: 844 } },
    ])).toThrow('duplicate viewport');
  });

  it('rewrites root selectors inside functional selectors without changing body classes or text', () => {
    const css = responsiveSelectors('html.phone > body.home :is(h1,body .item){content:"html body :root"}:root{--body:red}[data-dl-id="dl-1"]{color:red}', new Map([['dl-1', 'dl-42']]));
    expect(css).toContain('dl-root.phone>dl-body.home :is(h1,dl-body .item)');
    expect(css).toContain('content:"html body :root"');
    expect(css).toContain('[data-dl-root]{--body:red}');
    expect(css).toContain('[data-dl-id="dl-42"]');
  });

  it('preserves namespace qualification while aliasing HTML root type selectors', () => {
    const css = responsiveSelectors('@namespace h "http://www.w3.org/1999/xhtml";h|html>h|body,*|body,|body{margin:0}');
    expect(css).toContain('h|dl-root>h|dl-body,*|dl-body,|dl-body');
    expect(css).toMatch(/@namespace h\s*"http:\/\/www\.w3\.org\/1999\/xhtml"/);
  });

  it('hoists only font definitions while keeping their layer, supports and media conditions', () => {
    const css = fontFaceCss('@layer type{@supports (font-format:woff2){@media (min-width:400px){@font-face{font-family:Sample;src:url(font.woff2)}body{color:red}}}}@keyframes blink{to{opacity:0}}');
    expect(css).toContain('@layer type{@supports (font-format:woff2){@media (min-width:400px){@font-face');
    expect(css).not.toContain('body');
    expect(css).not.toContain('keyframes');
  });

  it('keeps native document-root :defined and :not(:defined) semantics on generated proxies', () => {
    const css = responsiveSelectors('html:defined,body:defined{color:red}html:not(:defined){color:blue}');
    expect(css).toContain('dl-root:is(:defined,dl-root,dl-body)');
    expect(css).toContain('dl-body:is(:defined,dl-root,dl-body)');
    expect(css).toContain('dl-root:not(:is(:defined,dl-root,dl-body))');
  });
});
