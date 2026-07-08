import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { sanitizeHtml } from '../../src/localize/html-rewrite.js';

/**
 * Wrap a body fragment in a minimal document so `sanitizeHtml` sees the same html/head/body shape
 * the serializer emits, and reload the result so assertions run against the parsed DOM (not brittle
 * string matching). Every rule below has one POSITIVE case (the hostile thing is gone) and one
 * NEGATIVE case (a benign sibling survives) — the positive proves the strip fires, the negative
 * proves it is targeted and does not gut the page.
 */
function sanitizeDoc(bodyHtml: string, headHtml = ''): cheerio.CheerioAPI {
  const out = sanitizeHtml(
    `<!DOCTYPE html><html><head><meta charset="utf-8">${headHtml}</head><body>${bodyHtml}</body></html>`,
  );
  return cheerio.load(out);
}

// why: script execution is THE thing an inert clone must not have (ADR-001 "photograph, not a
// program"). If `<script>` removal regressed, cloned pages would run arbitrary captured JS when
// re-served. The negative case guards against an over-broad selector nuking real content.
describe('sanitizeHtml — <script>', () => {
  it('strips inline and external <script> (positive)', () => {
    const $ = sanitizeDoc('<script>alert(1)</script><script src="app.js"></script><p>keep</p>');
    expect($('script')).toHaveLength(0);
  });

  it('keeps a benign element (negative)', () => {
    const $ = sanitizeDoc('<script>alert(1)</script><p id="x">keep</p>');
    expect($('p#x').text()).toBe('keep');
  });
});

// why: `on*` handlers are inline JS; leaving even one means the clone can execute on interaction.
// If the `/^on/i` scrub broke, event handlers would ship live. The negative case ensures ordinary
// attributes (class/href) are untouched — the scrub must not strip non-handler attributes.
describe('sanitizeHtml — on* handlers', () => {
  it('removes every on* attribute regardless of case (positive)', () => {
    const $ = sanitizeDoc('<button onclick="x()" ONMOUSEOVER="y()" class="b">go</button>');
    const btn = $('button');
    expect(btn.attr('onclick')).toBeUndefined();
    expect(btn.attr('onmouseover')).toBeUndefined();
  });

  it('keeps non-handler attributes (negative)', () => {
    const $ = sanitizeDoc('<button onclick="x()" class="b" data-dl-id="dl-1">go</button>');
    expect($('button').attr('class')).toBe('b');
    expect($('button').attr('data-dl-id')).toBe('dl-1');
  });
});

// why: `javascript:` URLs execute on click/load exactly like a handler. Spec §5 mandates href→`#`
// (link stays present but dead) while every OTHER attribute carrying the scheme is dropped. If this
// regressed, a cloned link/iframe could run script. The negative case proves normal URLs survive
// (and that whitespace/control-char obfuscation is what triggers the strip, not the substring).
describe('sanitizeHtml — javascript: URLs', () => {
  it('rewrites href to # and drops other javascript: attributes, incl. obfuscated (positive)', () => {
    const $ = sanitizeDoc(
      '<a href="javascript:alert(1)">a</a><a href="JAVA\tSCRIPT:alert(2)">b</a><iframe src="javascript:alert(3)"></iframe>',
    );
    expect($('a').eq(0).attr('href')).toBe('#');
    expect($('a').eq(1).attr('href')).toBe('#');
    expect($('iframe').attr('src')).toBeUndefined();
  });

  it('leaves ordinary URLs intact (negative)', () => {
    const $ = sanitizeDoc('<a href="https://example.com/x">a</a><img src="/img/logo.png">');
    expect($('a').attr('href')).toBe('https://example.com/x');
    expect($('img').attr('src')).toBe('/img/logo.png');
  });
});

// why: `<meta http-equiv="refresh">` is a scriptless redirect that would yank a re-served clone to
// the live site. If removal regressed, the clone would navigate away on open. The negative case
// keeps other meta tags (viewport, description) so the scrub is refresh-specific.
describe('sanitizeHtml — meta refresh', () => {
  it('removes http-equiv=refresh case-insensitively (positive)', () => {
    const $ = sanitizeDoc('', '<meta http-equiv="Refresh" content="0;url=https://evil.test">');
    expect($('meta[http-equiv]')).toHaveLength(0);
  });

  it('keeps other meta tags (negative)', () => {
    const $ = sanitizeDoc('', '<meta name="viewport" content="width=device-width">');
    expect($('meta[name="viewport"]').attr('content')).toBe('width=device-width');
  });
});

// why: dead resource hints (preconnect/dns-prefetch/modulepreload, and script preload/prefetch)
// open connections or fetch JS the inert clone never uses; they also leak the capture origin. If
// this regressed the clone would beacon out on open. The negative case proves style/font preloads
// and real stylesheet links — assets we DO localize — are preserved.
describe('sanitizeHtml — dead resource hints', () => {
  it('removes preconnect/dns-prefetch/modulepreload/script-preload links (positive)', () => {
    const $ = sanitizeDoc(
      '',
      '<link rel="preconnect" href="https://cdn.test">' +
        '<link rel="dns-prefetch" href="https://a.test">' +
        '<link rel="modulepreload" href="m.js">' +
        '<link rel="preload" as="script" href="s.js">' +
        '<link rel="prefetch" as="script" href="p.js">',
    );
    expect($('link')).toHaveLength(0);
  });

  it('keeps stylesheet links and non-script preloads (negative)', () => {
    const $ = sanitizeDoc(
      '',
      '<link rel="stylesheet" href="style.css">' +
        '<link rel="preload" as="style" href="theme.css">' +
        '<link rel="preload" as="font" href="brand.woff2">',
    );
    expect($('link')).toHaveLength(3);
  });
});

// why: `<noscript>` holds a JS-disabled fallback (often trackers/pixels). Since the clone never
// runs JS the fallback would ALWAYS show, doubling content and re-adding network beacons. If the
// removal regressed we'd render both branches. The negative case ensures siblings survive.
describe('sanitizeHtml — <noscript>', () => {
  it('removes noscript entirely, contents and all (positive)', () => {
    const $ = sanitizeDoc('<noscript><img src="https://track.test/px"></noscript><p>keep</p>');
    expect($('noscript')).toHaveLength(0);
    expect($('img')).toHaveLength(0);
  });

  it('keeps a benign sibling (negative)', () => {
    const $ = sanitizeDoc('<noscript>x</noscript><p id="k">keep</p>');
    expect($('p#k').text()).toBe('keep');
  });
});

// why: IE conditional comments (`<!--[if IE]><script>…</script><![endif]-->`) smuggle a full
// <script> INSIDE a comment node, so `$('script').remove()` never sees it — this pass must strip
// the comment itself. If it regressed, a browser that honors conditionals could execute the
// smuggled script. The negative case proves ordinary comments (e.g. the writer's provenance
// comment) are NOT removed.
describe('sanitizeHtml — IE conditional comments', () => {
  it('removes the conditional comment and its smuggled script (positive)', () => {
    const out = sanitizeHtml(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<!--[if IE]><script>evil()</script><![endif]-->' +
        '<!--[if lt IE 9]><link rel="stylesheet" href="ie.css"><![endif]-->' +
        '<p>keep</p></body></html>',
    );
    expect(out).not.toContain('evil()');
    expect(out).not.toContain('[if IE]');
    expect(out).not.toContain('[if lt IE 9]');
    expect(cheerio.load(out)('p').text()).toBe('keep');
  });

  it('keeps an ordinary comment (negative)', () => {
    const out = sanitizeHtml(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<!-- Cloned by design-lens --><p>keep</p></body></html>',
    );
    expect(out).toContain('<!-- Cloned by design-lens -->');
  });
});

// why: the written clone is UTF-8 bytes; without a `<meta charset="utf-8">` browsers may mis-decode
// non-ASCII text. Spec §5 requires the pass to GUARANTEE one. If it regressed, charset-less captures
// would render mojibake. The negative case proves an existing charset is not duplicated.
describe('sanitizeHtml — charset', () => {
  it('injects a charset meta when none exists (positive)', () => {
    const out = sanitizeHtml('<!DOCTYPE html><html><head></head><body><p>é</p></body></html>');
    const $ = cheerio.load(out);
    expect($('meta[charset]')).toHaveLength(1);
    expect($('meta[charset]').attr('charset')).toBe('utf-8');
  });

  it('does not add a second charset when one is present (negative)', () => {
    const out = sanitizeHtml(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>',
    );
    expect(cheerio.load(out)('meta[charset]')).toHaveLength(1);
  });
});
