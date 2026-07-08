import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { localPathFor } from '../../src/localize/urlmap.js';

/** Mirror the module's private sha8 so query/overlong assertions can be exact, not just shape. */
function sha8(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

// why: the host segment is the first line of defence against cross-origin collisions and the
// Windows-illegal colon. If default-port dropping or `<hostname>-<port>` encoding regressed, the
// two sealed fixture CDNs (differ only by port) would collide and clones would overwrite assets.
describe('localPathFor — host segment', () => {
  it('maps a simple asset URL under assets/<host>/<path>', () => {
    expect(localPathFor('http://example.com/img/logo.png')).toBe('assets/example-com/img/logo.png');
  });

  it('lowercases the host (URL parser normalizes case)', () => {
    expect(localPathFor('http://EXAMPLE.COM/a.png')).toBe('assets/example-com/a.png');
  });

  it('drops the default http port 80', () => {
    expect(localPathFor('http://example.com:80/a.png')).toBe('assets/example-com/a.png');
  });

  it('drops the default https port 443', () => {
    expect(localPathFor('https://example.com:443/a.png')).toBe('assets/example-com/a.png');
  });

  it('encodes a non-default port as <hostname>-<port> (colon is illegal on Windows)', () => {
    expect(localPathFor('http://example.com:8080/a.png')).toBe('assets/example-com-8080/a.png');
  });

  it('keeps the two fixture CDN hosts (differ only by port) distinct — no collision', () => {
    const a = localPathFor('http://127.0.0.1:4630/f.woff2');
    const b = localPathFor('http://127.0.0.1:4631/f.woff2');
    expect(a).toBe('assets/127-0-0-1-4630/f.woff2');
    expect(b).toBe('assets/127-0-0-1-4631/f.woff2');
    expect(a).not.toBe(b);
  });
});

// why: an empty or directory URL has no filename, yet the rewriter still needs a concrete on-disk
// target. If the `index` fallback regressed, directory-style references would map to `assets/host/`
// (a directory) and the write step would fail or clobber.
describe('localPathFor — index fallback', () => {
  it('appends index for an empty path (unknown html contentType → .bin)', () => {
    expect(localPathFor('http://example.com', 'text/html')).toBe('assets/example-com/index.bin');
  });

  it('appends index for a bare root path "/"', () => {
    expect(localPathFor('http://example.com/')).toBe('assets/example-com/index.bin');
  });

  it('appends index for a trailing-slash directory path', () => {
    expect(localPathFor('http://example.com/docs/')).toBe('assets/example-com/docs/index.bin');
  });

  it('preserves a nested path unchanged', () => {
    expect(localPathFor('http://example.com/a/b/c/d.css')).toBe('assets/example-com/a/b/c/d.css');
  });
});

// why: extension inference is what lets HTML/CSS rewriting run BEFORE fetching (path known up
// front). Every mapping in the spec table is asserted so a dropped case cannot silently write an
// asset with the wrong (or `.bin`) extension and break MIME-sensitive consumers.
describe('localPathFor — extension inference', () => {
  it('keeps an existing extension and ignores contentType', () => {
    expect(localPathFor('http://x.com/a.png', 'text/css')).toBe('assets/x-com/a.png');
  });

  it('infers .css from text/css when the path has no extension', () => {
    expect(localPathFor('http://x.com/style', 'text/css')).toBe('assets/x-com/style.css');
  });

  it('infers .woff2 from font/woff2', () => {
    expect(localPathFor('http://x.com/brand', 'font/woff2')).toBe('assets/x-com/brand.woff2');
  });

  it('infers .png from image/png', () => {
    expect(localPathFor('http://x.com/logo', 'image/png')).toBe('assets/x-com/logo.png');
  });

  it('infers .svg from image/svg+xml', () => {
    expect(localPathFor('http://x.com/icon', 'image/svg+xml')).toBe('assets/x-com/icon.svg');
  });

  it('infers .jpg from image/jpeg', () => {
    expect(localPathFor('http://x.com/hero', 'image/jpeg')).toBe('assets/x-com/hero.jpg');
  });

  it('infers .webp from image/webp', () => {
    expect(localPathFor('http://x.com/pic', 'image/webp')).toBe('assets/x-com/pic.webp');
  });

  it('falls back to .bin for an unknown contentType', () => {
    expect(localPathFor('http://x.com/data', 'application/octet-stream')).toBe('assets/x-com/data.bin');
  });

  it('falls back to .bin when no contentType is supplied', () => {
    expect(localPathFor('http://x.com/data')).toBe('assets/x-com/data.bin');
  });

  it('strips contentType parameters before lookup (text/css; charset=utf-8 → .css)', () => {
    expect(localPathFor('http://x.com/style', 'text/css; charset=utf-8')).toBe('assets/x-com/style.css');
  });
});

// why: query folding is what keeps `a.css?v=1` and `a.css?v=2` from colliding on disk. If the
// `__q-<hash>` insertion moved after the extension, or stopped hashing, cache-busted assets would
// overwrite each other and the clone would serve a stale variant.
describe('localPathFor — query folding', () => {
  it('folds a query into __q-<8hex> BEFORE the extension', () => {
    expect(localPathFor('http://x.com/app.css?v=2')).toBe(`assets/x-com/app__q-${sha8('v=2')}.css`);
  });

  it('folds the query before the inferred extension when the path has none', () => {
    expect(localPathFor('http://x.com/app?v=2', 'text/css')).toBe(`assets/x-com/app__q-${sha8('v=2')}.css`);
  });

  it('gives two URLs differing only by query distinct paths', () => {
    expect(localPathFor('http://x.com/a.png?x=1')).not.toBe(localPathFor('http://x.com/a.png?x=2'));
  });

  it('folds the same query to the same tag (deterministic)', () => {
    expect(localPathFor('http://x.com/a.png?x=1')).toBe(localPathFor('http://x.com/a.png?x=1'));
  });

  it('does not fold an empty query (trailing "?")', () => {
    expect(localPathFor('http://x.com/a.png?')).toBe('assets/x-com/a.png');
  });
});

// why: this mapping is a security boundary — a malicious or buggy URL must never write above
// assets/. If `..` collapsing or percent-decode-first ordering regressed, `%2e%2e` traversal could
// escape the clone directory (arbitrary file write). These are the load-bearing safety cases.
describe('localPathFor — traversal & sanitization', () => {
  it('collapses a mid-path ".." segment', () => {
    expect(localPathFor('http://x.com/a/b/../c.png')).toBe('assets/x-com/a/c.png');
  });

  it('skips a "." current-directory segment', () => {
    expect(localPathFor('http://x.com/a/./b.png')).toBe('assets/x-com/a/b.png');
  });

  it('cannot escape above the host via leading ".." segments', () => {
    expect(localPathFor('http://x.com/../../etc/passwd', 'text/plain')).toBe('assets/x-com/etc/passwd.bin');
  });

  it('collapses percent-encoded traversal (%2e%2e) after decoding', () => {
    expect(localPathFor('http://x.com/a/%2e%2e/%2e%2e/etc/passwd', 'text/plain')).toBe('assets/x-com/etc/passwd.bin');
  });

  it('replaces filesystem-unsafe characters with underscore', () => {
    expect(localPathFor('http://x.com/a:b*c.png')).toBe('assets/x-com/a_b_c.png');
  });

  it('percent-decodes a segment before sanitizing (%20 space → underscore)', () => {
    expect(localPathFor('http://x.com/my%20file.png')).toBe('assets/x-com/my_file.png');
  });
});

// why: an unbounded path segment could blow past filesystem name limits; the 91+dash+8hex collapse
// keeps every component ≤100 chars while staying deterministic. If truncation regressed, a long
// query- or CMS-generated filename could crash the writer with ENAMETOOLONG.
describe('localPathFor — overlong segments', () => {
  it('collapses a >100-char directory segment to first-91 + "-" + 8hex (exactly 100 chars)', () => {
    const long = 'a'.repeat(120);
    const result = localPathFor(`http://x.com/${long}/f.png`);
    const seg = result.split('/')[2]; // assets / x.com / <seg> / f.png
    expect(seg).toHaveLength(100);
    expect(seg).toBe(`${'a'.repeat(91)}-${sha8('a'.repeat(120))}`);
  });

  it('is deterministic for the same overlong segment', () => {
    const long = 'z'.repeat(200);
    expect(localPathFor(`http://x.com/${long}/f.png`)).toBe(localPathFor(`http://x.com/${long}/f.png`));
  });

  it('leaves a segment of exactly 100 chars untouched (boundary is > 100)', () => {
    const exact = 'a'.repeat(100);
    expect(localPathFor(`http://x.com/${exact}/f.png`)).toBe(`assets/x-com/${exact}/f.png`);
  });
});

// why: determinism (same URL ⇒ same path) is the invariant that lets the rewrite pass precede the
// fetch pass. If any hidden state or ordering crept in, two rewrites of the same reference could
// disagree and dangle.
describe('localPathFor — determinism & errors', () => {
  it('returns an identical path for the same URL called twice', () => {
    const url = 'https://cdn.example.com/assets/x/y/z.woff2?rev=abc';
    expect(localPathFor(url)).toBe(localPathFor(url));
  });

  it('gives different hosts different paths', () => {
    expect(localPathFor('http://a.com/f.png')).not.toBe(localPathFor('http://b.com/f.png'));
  });

  it('throws on an unparseable URL', () => {
    expect(() => localPathFor('not a url')).toThrow(/invalid URL/);
  });

  it('throws on a URL with no host (e.g. file:///)', () => {
    expect(() => localPathFor('file:///etc/passwd')).toThrow(/no host/);
  });
});
