import { describe, it, expect } from 'vitest';
import { rewriteCss, type CssResolver, type CssRef } from '../../src/localize/css-rewrite.js';

const BASE = 'https://cdn.example.com/css/site.css';

/**
 * A trivial resolver: localise every http(s) reference to `local/<pathname-with-slashes-as-_>`,
 * so assertions can be exact. `null`-returning variants below prove the remote path.
 */
const toLocal: CssResolver = (url) => {
  const { pathname } = new URL(url);
  return `local${pathname.replace(/\//g, '/')}`;
};

// why: `url()` values may carry backslash-escaped parens and spaces; a regex rewriter mangles
// them. This proves css-tree DECODES the escape into the ref before we resolve it (the value the
// browser actually sees), and RE-ESCAPES special characters in the substituted path on output. If
// either regressed we'd resolve the wrong URL or emit broken CSS the browser can't parse.
describe('rewriteCss — escaped url()', () => {
  it('decodes a backslash-escaped space before resolving (browser-accurate URL)', () => {
    const { refs } = rewriteCss('.a{background:url(foo\\ bar.png)}', BASE, toLocal);
    // css-tree unescaped `foo\ bar.png` → `foo bar.png`, which URL-resolution percent-encodes.
    expect(refs).toEqual<CssRef[]>([
      { url: 'https://cdn.example.com/css/foo%20bar.png', kind: 'url', localPath: 'local/css/foo%20bar.png' },
    ]);
  });

  it('re-escapes a substituted path that contains a space and parentheses', () => {
    // A resolver can legitimately return a local path with CSS-special characters; generate() must
    // escape them or the output stylesheet is unparseable.
    const spaced: CssResolver = () => 'assets/x/a b(c).png';
    const { css } = rewriteCss('.a{background:url(orig.png)}', BASE, spaced);
    expect(css).toContain('url(assets/x/a\\ b\\(c\\).png)');
  });
});

// why: @import is the recursion entry point — its target must be rewritten AND surfaced as a
// `kind:'import'` ref so the pipeline knows to fetch and rewrite that stylesheet next. Both the
// bare-string and url() forms must work, and trailing layer/media tokens must survive untouched.
// If this broke, imported stylesheets would never be localised (dangling remote CSS).
describe('rewriteCss — @import (recursion entry)', () => {
  it('rewrites a bare-string @import and records it as an import ref', () => {
    const { css, refs } = rewriteCss('@import "reset.css";', BASE, toLocal);
    expect(refs).toEqual<CssRef[]>([
      { url: 'https://cdn.example.com/css/reset.css', kind: 'import', localPath: 'local/css/reset.css' },
    ]);
    expect(css).toContain('reset.css');
  });

  it('rewrites a url() @import and preserves the trailing media query', () => {
    const { css, refs } = rewriteCss('@import url(print.css) print;', BASE, toLocal);
    expect(refs[0]).toMatchObject({ kind: 'import', localPath: 'local/css/print.css' });
    expect(css).toContain('print.css');
    expect(css).toContain('print'); // the media query token survives
  });

  it('drives a nested @import chain when re-invoked on the imported sheet', () => {
    // First stylesheet imports a second; the pipeline recurses by calling rewriteCss again on it.
    const top = rewriteCss('@import "a/level2.css";', BASE, toLocal);
    expect(top.refs[0]).toMatchObject({ kind: 'import', url: 'https://cdn.example.com/css/a/level2.css' });
    // The imported sheet lives at that URL and itself pulls a font; relative refs resolve against IT.
    const nested = rewriteCss('@font-face{src:url(../f/deep.woff2)}', top.refs[0].url, toLocal);
    expect(nested.refs[0]).toMatchObject({ kind: 'url', url: 'https://cdn.example.com/css/f/deep.woff2' });
  });

  it('leaves a case-insensitive @IMPORT recognised', () => {
    const { refs } = rewriteCss('@IMPORT "x.css";', BASE, toLocal);
    expect(refs[0]).toMatchObject({ kind: 'import' });
  });
});

// why: `data:` payloads are already inline — rewriting them would corrupt the stylesheet and
// waste a resolver call. This is the AC's untouched-data: case. If it regressed, embedded fonts
// and images would be double-processed or broken.
describe('rewriteCss — untouched references', () => {
  it('leaves a data: URI byte-for-byte and never calls the resolver for it', () => {
    let called = false;
    const spy: CssResolver = (u, k) => { called = true; return toLocal(u, k); };
    const src = '.a{background:url(data:image/png;base64,AAAA)}';
    const { css, refs } = rewriteCss(src, BASE, spy);
    expect(css).toContain('url(data:image/png;base64,AAAA)');
    expect(refs).toEqual([]);
    expect(called).toBe(false);
  });

  it('leaves a same-document fragment url(#gradient) untouched (SVG paint reference)', () => {
    const { css, refs } = rewriteCss('.a{fill:url(#grad)}', BASE, toLocal);
    expect(css).toContain('url(#grad)');
    expect(refs).toEqual([]);
  });
});

// why: at M1 a ref whose resource was not captured must stay remote — the resolver returns null.
// The original reference must be preserved exactly so the clone still points at the live asset.
// If a null return still rewrote, clones would reference nonexistent local files.
describe('rewriteCss — remote fallback (resolver returns null)', () => {
  it('leaves the reference unchanged when the resolver declines it', () => {
    const declineAll: CssResolver = () => null;
    const { css, refs } = rewriteCss('.a{background:url(https://other.test/x.png)}', BASE, declineAll);
    expect(css).toContain('url(https://other.test/x.png)');
    expect(refs).toEqual([]);
  });
});

// why: @font-face src is the primary webfont carrier and can list several candidates in one
// declaration; every url() must be localised and reported in document order. The `format()`
// function and comma operators must be preserved so the browser still picks a face.
describe('rewriteCss — @font-face src', () => {
  it('localises every candidate url() and keeps format()/commas', () => {
    const src = '@font-face{font-family:F;src:url(f.woff2) format("woff2"),url(f.woff) format("woff")}';
    const { css, refs } = rewriteCss(src, BASE, toLocal);
    expect(refs.map((r) => r.localPath)).toEqual(['local/css/f.woff2', 'local/css/f.woff']);
    expect(css).toContain('format("woff2")');
    expect(css).toContain(','); // the candidate list separator survives
  });
});

// why: references come in relative, absolute, and protocol-relative forms; all must resolve to a
// correct absolute URL against the stylesheet's OWN url before the resolver sees them (a browser
// resolves url() against the stylesheet, not the document). A resolution bug would fetch/localise
// the wrong asset.
describe('rewriteCss — URL resolution against the stylesheet URL', () => {
  it('resolves a ../ relative ref against the stylesheet, not the document root', () => {
    const { refs } = rewriteCss('.a{background:url(../img/p.png)}', BASE, toLocal);
    expect(refs[0].url).toBe('https://cdn.example.com/img/p.png');
  });

  it('resolves a protocol-relative //host ref using the base scheme', () => {
    const { refs } = rewriteCss('.a{background:url(//img.test/p.png)}', BASE, toLocal);
    expect(refs[0].url).toBe('https://img.test/p.png');
  });

  it('preserves an already-absolute cross-origin ref as its own href', () => {
    const { refs } = rewriteCss('.a{background:url(https://x.test/y.png)}', BASE, toLocal);
    expect(refs[0].url).toBe('https://x.test/y.png');
  });
});

// why: a real stylesheet mixes localisable and untouchable refs; the module must rewrite only the
// former, in document order, and leave the rest. This guards the whole walk against off-by-one or
// double-processing (e.g. an @import's inner url() counted twice).
describe('rewriteCss — mixed document', () => {
  it('rewrites imports and url()s once each, in order, skipping data:/fragments', () => {
    const src = [
      '@import url(base.css);',
      '.hero{background:url(../bg.jpg),url(#mask)}',
      '.logo{background:url(data:image/svg+xml,<svg/>)}',
      '@font-face{src:url(font.woff2)}',
    ].join('\n');
    const { refs } = rewriteCss(src, BASE, toLocal);
    expect(refs).toEqual<CssRef[]>([
      { url: 'https://cdn.example.com/css/base.css', kind: 'import', localPath: 'local/css/base.css' },
      { url: 'https://cdn.example.com/bg.jpg', kind: 'url', localPath: 'local/bg.jpg' },
      { url: 'https://cdn.example.com/css/font.woff2', kind: 'url', localPath: 'local/css/font.woff2' },
    ]);
  });
});
