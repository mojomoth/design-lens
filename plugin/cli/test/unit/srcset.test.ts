import { describe, it, expect } from 'vitest';
import {
  parseSrcset,
  stringifySrcset,
  rewriteSrcset,
  type SrcsetCandidate,
  type SrcsetRef,
} from '../../src/localize/srcset.js';

// why: the fixture srcset (`img/hero.png 1x, img/hero@2x.png 2x`) and the whole M2 srcset-localise
// path (T14) depend on this splitting the two density candidates apart. If it regressed to a naive
// comma-split it would still pass THIS case, so the comma-in-URL suite below is the real guard.
describe('parseSrcset — density (x) descriptors', () => {
  it('splits the two-candidate fixture srcset into url + descriptor pairs', () => {
    expect(parseSrcset('img/hero.png 1x, img/hero@2x.png 2x')).toEqual<SrcsetCandidate[]>([
      { url: 'img/hero.png', descriptor: '1x' },
      { url: 'img/hero@2x.png', descriptor: '2x' },
    ]);
  });
});

// why: width descriptors are the other half of the spec's `w`/`x` requirement (specs/08 §unit).
// Browsers pair them with a `sizes` attribute; the parser must preserve the integer + `w` verbatim.
describe('parseSrcset — width (w) descriptors', () => {
  it('preserves w descriptors on a multi-candidate list', () => {
    expect(parseSrcset('small.jpg 480w, medium.jpg 800w, large.jpg 1200w')).toEqual<SrcsetCandidate[]>([
      { url: 'small.jpg', descriptor: '480w' },
      { url: 'medium.jpg', descriptor: '800w' },
      { url: 'large.jpg', descriptor: '1200w' },
    ]);
  });
});

// why: a lone URL with no descriptor is legal (`srcset="a.png"`) and is how a bare high-DPI source
// is declared. If the parser required a descriptor it would drop such candidates and the clone
// would lose the image reference entirely.
describe('parseSrcset — descriptorless candidates', () => {
  it('parses a single descriptorless URL', () => {
    expect(parseSrcset('logo.png')).toEqual<SrcsetCandidate[]>([{ url: 'logo.png', descriptor: '' }]);
  });

  it('parses a descriptorless candidate mixed with a descriptored one', () => {
    expect(parseSrcset('a.png, b.png 2x')).toEqual<SrcsetCandidate[]>([
      { url: 'a.png', descriptor: '' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });

  it('treats a URL ending in a comma as descriptorless, stripping the comma(s)', () => {
    expect(parseSrcset('a.png,,, b.png 2x')).toEqual<SrcsetCandidate[]>([
      { url: 'a.png', descriptor: '' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });
});

// why: THE reason this module exists instead of a comma-split — a `data:` URI (and CDN transform
// paths) carry literal commas. Splitting on bare commas mangles them (kage's known bug,
// research/kage-clone.md §4). The data-URI-with-comma case is the AC's named requirement (T08).
describe('parseSrcset — commas inside URLs', () => {
  it('keeps the comma inside a base64 data-URI candidate (does NOT split on it)', () => {
    const data = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    expect(parseSrcset(`${data} 1x, /b.png 2x`)).toEqual<SrcsetCandidate[]>([
      { url: data, descriptor: '1x' },
      { url: '/b.png', descriptor: '2x' },
    ]);
  });

  it('keeps commas inside a CDN transform path segment', () => {
    expect(parseSrcset('https://cdn.example/w_100,h_50,c_fit/a.png 1x')).toEqual<SrcsetCandidate[]>([
      { url: 'https://cdn.example/w_100,h_50,c_fit/a.png', descriptor: '1x' },
    ]);
  });

  it('parses two data-URI candidates each containing commas', () => {
    const a = 'data:image/svg+xml,%3Csvg%20a,b%3E';
    const b = 'data:image/svg+xml,%3Csvg%20c,d%3E';
    expect(parseSrcset(`${a} 1x, ${b} 2x`)).toEqual<SrcsetCandidate[]>([
      { url: a, descriptor: '1x' },
      { url: b, descriptor: '2x' },
    ]);
  });
});

// why: real HTML wraps srcset across lines and indents it, and authors are inconsistent with spaces
// around commas/descriptors. All of these must yield identical candidates or the clone's output
// would depend on incidental source formatting.
describe('parseSrcset — whitespace variants', () => {
  it('tolerates leading/trailing whitespace and stray leading commas', () => {
    expect(parseSrcset('  ,  a.png 1x  ,  b.png 2x  ')).toEqual<SrcsetCandidate[]>([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });

  it('tolerates newlines, tabs and multiple spaces between URL and descriptor', () => {
    expect(parseSrcset('\n  a.png\t\t1x,\n  b.png   2x\n')).toEqual<SrcsetCandidate[]>([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });

  it('returns [] for empty input and for whitespace/comma-only input', () => {
    expect(parseSrcset('')).toEqual([]);
    expect(parseSrcset('   ')).toEqual([]);
    expect(parseSrcset(' , , ')).toEqual([]);
  });
});

// why: a localised srcset must round-trip through parse→stringify with only the URLs changed, so
// the browser still sees valid `url descriptor, …` syntax. If the serialiser dropped descriptors or
// mis-joined candidates the clone's responsive images would break.
describe('stringifySrcset — round-trip', () => {
  it('re-serialises candidates as comma-space separated `url descriptor`', () => {
    expect(stringifySrcset([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ])).toBe('a.png 1x, b.png 2x');
  });

  it('omits the descriptor for a descriptorless candidate', () => {
    expect(stringifySrcset([{ url: 'logo.png', descriptor: '' }])).toBe('logo.png');
  });

  it('normalises whitespace variants back to a canonical form on round-trip', () => {
    expect(stringifySrcset(parseSrcset('\n a.png\t1x ,  b.png  2x '))).toBe('a.png 1x, b.png 2x');
  });
});

// why: rewriteSrcset is T14's substitution primitive. It must resolve each URL against the page's
// base, keep descriptors, and honour the resolver's `null` (stay-remote) contract exactly as
// css-rewrite does — otherwise localised and remote variants would be indistinguishable.
describe('rewriteSrcset — resolver substitution', () => {
  const base = 'https://site.example/page/index.html';

  it('substitutes both candidates and records refs against the resolved absolute URLs', () => {
    const resolve = (url: string): string =>
      url.endsWith('hero.png') ? '../assets/site.example/img/hero.png'
        : '../assets/site.example/img/hero@2x.png';
    const result = rewriteSrcset('img/hero.png 1x, img/hero@2x.png 2x', base, resolve);
    expect(result.srcset).toBe(
      '../assets/site.example/img/hero.png 1x, ../assets/site.example/img/hero@2x.png 2x',
    );
    expect(result.refs).toEqual<SrcsetRef[]>([
      { url: 'https://site.example/page/img/hero.png', localPath: '../assets/site.example/img/hero.png' },
      { url: 'https://site.example/page/img/hero@2x.png', localPath: '../assets/site.example/img/hero@2x.png' },
    ]);
  });

  it('leaves a candidate remote when the resolver returns null (no ref recorded)', () => {
    const resolve = (url: string): string | null =>
      url.endsWith('a.png') ? '../assets/site.example/a.png' : null;
    const result = rewriteSrcset('a.png 1x, b.png 2x', base, resolve);
    expect(result.srcset).toBe('../assets/site.example/a.png 1x, b.png 2x');
    expect(result.refs).toEqual<SrcsetRef[]>([
      { url: 'https://site.example/page/a.png', localPath: '../assets/site.example/a.png' },
    ]);
  });

  it('never resolves a data: candidate — it is left inline and unrecorded', () => {
    const data = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const resolve = (): string => 'SHOULD_NOT_BE_CALLED';
    const result = rewriteSrcset(`${data} 1x, real.png 2x`, base, resolve);
    expect(result.srcset).toBe(`${data} 1x, SHOULD_NOT_BE_CALLED 2x`);
    expect(result.refs).toEqual<SrcsetRef[]>([
      { url: 'https://site.example/page/real.png', localPath: 'SHOULD_NOT_BE_CALLED' },
    ]);
  });
});
