import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { collectResourceReferences, fetchMissing } from '../../src/localize/fetch-missing.js';
import { sanitizeHtml } from '../../src/localize/html-rewrite.js';
import { localizeDocument } from '../../src/localize/localize.js';
import { ResourceStore } from '../../src/localize/resource-store.js';

const PAGE = 'https://example.test/pages/home';
function seed(store: ResourceStore, url: string, contentType: string, body: string): void {
  store.record({ url, contentType, body: Buffer.from(body), via: 'network', status: 200 });
}

describe('resource closure', () => {
  // Why: removing base before resolving resources sends every relative CDN asset to the wrong host.
  it('uses the first base for CSS, srcset, preload and SVG references before removing it', () => {
    const html = '<base href="https://cdn.test/static/"><base href="https://wrong.test/">' +
      '<link rel="preload" as="image" href="small.png" imagesrcset="small.png 1x, large.png 2x">' +
      '<style>:root{--bg:url(bg.png)}</style><svg><use href="icons.svg#logo"/></svg>';
    const store = new ResourceStore();
    for (const file of ['small.png', 'large.png', 'bg.png']) seed(store, `https://cdn.test/static/${file}`, 'image/png', file);
    seed(store, 'https://cdn.test/static/icons.svg', 'image/svg+xml', '<svg><symbol id="logo"/></svg>');
    expect(collectResourceReferences(html, PAGE, store).map((ref) => ref.url)).toEqual([
      'https://cdn.test/static/small.png', 'https://cdn.test/static/large.png',
      'https://cdn.test/static/bg.png', 'https://cdn.test/static/icons.svg',
    ]);
    const out = localizeDocument(sanitizeHtml(html), PAGE, store);
    expect(out.remote).toEqual([]);
    expect(out.html).not.toContain('<base');
    expect(out.html).toContain('assets/cdn-test/static/icons.svg#logo');
    expect(out.html).toContain('assets/cdn-test/static/large.png 2x');
    expect(out.html).toContain('--bg:url(assets/cdn-test/static/bg.png)');
  });

  // Why: fragment-insensitive stores must still preserve each symbol/filter selection in the output.
  it('keeps SVG fragments while rewriting external SVG images and paint references', () => {
    const store = new ResourceStore();
    seed(store, 'https://example.test/pages/icons.svg', 'image/svg+xml',
      '<svg viewBox="0 0 100 100" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="pic.png"/><path fill="url(filters.svg#gradient)"/><use href="#local"/></svg>');
    seed(store, 'https://example.test/pages/pic.png', 'image/png', 'IMAGE');
    seed(store, 'https://example.test/pages/filters.svg', 'image/svg+xml', '<svg><linearGradient id="gradient"/></svg>');
    const html = '<svg><use xlink:href="icons.svg#one"/><use href="icons.svg#two"/></svg>';
    const result = localizeDocument(html, PAGE, store);
    expect(result.remote).toEqual([]);
    expect(result.assets).toHaveLength(3);
    expect(result.html).toContain('icons.svg#one');
    expect(result.html).toContain('icons.svg#two');
    const svg = result.assets.find((asset) => asset.assetPath.endsWith('/icons.svg'))!.body.toString();
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('xlink:href="pic.png"');
    expect(svg).toContain('url(filters.svg#gradient)');
    expect(svg).toContain('href="#local"');
    expect(svg).not.toContain('<html');
  });

  // Why: redirect aliases must resolve CSS relative paths from the response's final directory.
  it('resolves redirect aliases and uses the final stylesheet URL as the CSS base', () => {
    const store = new ResourceStore();
    seed(store, 'https://cdn.test/styles/final.css', 'text/css', '.a{background:url(../images/bg.png)}');
    seed(store, 'https://cdn.test/images/bg.png', 'image/png', 'BG');
    store.recordAlias('https://example.test/redirect', 'https://cdn.test/styles/final.css');
    const html = '<link rel="stylesheet" href="/redirect">';
    expect(collectResourceReferences(html, PAGE, store)).toContainEqual({
      url: 'https://cdn.test/images/bg.png', via: 'css-fetch',
    });
    const out = localizeDocument(html, PAGE, store);
    expect(out.remote).toEqual([]);
    expect(out.html).toContain('href="assets/cdn-test/styles/final.css"');
    expect(out.assets.find((asset) => asset.contentType === 'text/css')!.body.toString())
      .toContain('url(../images/bg.png)');
  });

  // Why: the offline server derives MIME from filenames; PHP routes must not serve styles/SVG as octet streams.
  it('preserves usable local MIME types for dynamic stylesheet and SVG routes', () => {
    const store = new ResourceStore();
    seed(store, 'https://example.test/pages/style.php', 'text/css', '.x{color:red}');
    seed(store, 'https://example.test/pages/sprite.php', 'image/svg+xml', '<svg><symbol id="logo"/></svg>');
    const result = localizeDocument('<link rel="stylesheet" href="style.php"><svg><use href="sprite.php#logo"/></svg>', PAGE, store);
    expect(result.html).toContain('style.php.css');
    expect(result.html).toContain('sprite.php.svg#logo');
  });

  // Why: refetch follows redirects outside page response events, so it must retain the final base too.
  it('records refetch response URLs and aliases without duplicating stored bodies', async () => {
    const store = new ResourceStore();
    await fetchMissing({ get: async () => ({
      ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'text/css' }),
      url: () => 'https://cdn.test/css/final.css', body: async () => Buffer.from('.x{color:red}'),
    }) }, ['https://example.test/go'], store);
    expect(store.size).toBe(1);
    expect(store.get('https://cdn.test/css/final.css')).toBe(store.get('https://example.test/go'));
    expect(store.get('https://example.test/go')!.responseUrl).toBe('https://cdn.test/css/final.css');
  });

  // Why: a sequence of missing references must not multiply a whole-capture deadline into many timeouts.
  it('bounds refetch timeouts to the remaining deadline and never starts requests after expiration', async () => {
    const store = new ResourceStore();
    const timeouts: number[] = [];
    const client = { get: async (_url: string, options?: { timeout?: number }) => {
      timeouts.push(options!.timeout!);
      return { ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'image/png' }),
        body: async () => Buffer.from('PNG') };
    } };
    await fetchMissing(client, ['https://example.test/first.png'], store,
      { timeoutMs: 15_000, deadline: Date.now() + 1_000 });
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThan(0);
    expect(timeouts[0]).toBeLessThanOrEqual(1_000);
    const expired = await fetchMissing(client, ['https://example.test/late.png'], store,
      { deadline: Date.now() - 1_000 });
    expect(timeouts).toHaveLength(1);
    expect(expired.failed).toEqual([{ url: 'https://example.test/late.png', detail: 'capture deadline exhausted' }]);
  });

  // Why: escaped srcdoc markup and fetched frame HTML can otherwise retain scripts or lose their assets.
  it('recursively sanitizes srcdoc and fetched HTML while using each document base', () => {
    const store = new ResourceStore();
    seed(store, 'https://example.test/frame', 'text/html',
      '<base href="https://cdn.test/frame/"><script>bad()</script><img src="frame.png" onload="bad()">');
    seed(store, 'https://cdn.test/frame/frame.png', 'image/png', 'FRAME');
    seed(store, 'https://example.test/pages/inline.png', 'image/png', 'INLINE');
    const html = '<iframe src="/frame"></iframe>' +
      '<iframe src="/ignored" srcdoc="&lt;script&gt;bad()&lt;/script&gt;&lt;img src=&quot;inline.png&quot;&gt;"></iframe>';
    const found = collectResourceReferences(html, PAGE, store);
    expect(found.map((ref) => ref.url)).toEqual([
      'https://example.test/frame', 'https://cdn.test/frame/frame.png', 'https://example.test/pages/inline.png',
    ]);
    const result = localizeDocument(sanitizeHtml(html), PAGE, store);
    const $ = cheerio.load(result.html);
    expect($('iframe').eq(0).attr('src')).toBe('assets/example-test/frame.bin.html');
    expect($('iframe').eq(1).attr('src')).toBeUndefined();
    expect($('iframe').eq(1).attr('srcdoc')).toContain('assets/example-test/pages/inline.png');
    expect($('iframe').eq(1).attr('srcdoc')).not.toContain('<script');
    const frame = result.assets.find((asset) => asset.contentType === 'text/html')!.body.toString();
    expect(frame).toContain('../cdn-test/frame/frame.png');
    expect(frame).not.toMatch(/<script|onload|<base/);
  });

  // Why: retained SRI/CSP values can reject locally rewritten styles even though the asset exists.
  it('removes transformed integrity and source CSP, including within embedded documents', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="style-src none">' +
      '<link rel="stylesheet" href="style.css" integrity="sha384-source">' +
      '<iframe srcdoc="&lt;link rel=&quot;stylesheet&quot; href=&quot;x.css&quot; integrity=&quot;sha384-x&quot;&gt;"></iframe>';
    expect(sanitizeHtml(html)).not.toMatch(/integrity|Content-Security-Policy/);
  });

  // Why: identical CSS may reference different image bytes at different widths; both rewritten sheets must survive.
  it('isolates capture variants including styles whose own source bytes did not change', () => {
    const make = (image: string): ReturnType<typeof localizeDocument> => {
      const store = new ResourceStore();
      seed(store, 'https://example.test/pages/site.css', 'text/css', '.x{background:url(image.png)}');
      seed(store, 'https://example.test/pages/image.png', 'image/png', image);
      return localizeDocument('<link rel="stylesheet" href="site.css">', PAGE, store,
        { maxAssetBytes: 1e6, includeMedia: false, contentAddressed: true });
    };
    const desktop = make('DESKTOP');
    const mobile = make('MOBILE');
    expect(desktop.assets.map((asset) => asset.assetPath)).toEqual(make('DESKTOP').assets.map((asset) => asset.assetPath));
    for (const desktopAsset of desktop.assets) {
      expect(mobile.assets.some((asset) => asset.assetPath === desktopAsset.assetPath)).toBe(false);
    }
    expect(desktop.assets[0].body.toString()).not.toBe(mobile.assets[0].body.toString());
  });

  // Why: shared traversal must discover nested shadow-root assets instead of treating template content as absent.
  it('walks declarative shadow DOM and nested image-set CSS', () => {
    const html = '<div><template shadowrootmode="open"><img src="shadow.png">' +
      '<style>.x{background:image-set("one.png" 1x,"two.png" 2x)}</style></template></div>';
    expect(collectResourceReferences(html, PAGE, new ResourceStore()).map((ref) => ref.url)).toEqual([
      'https://example.test/pages/shadow.png', 'https://example.test/pages/one.png', 'https://example.test/pages/two.png',
    ]);
  });
});
