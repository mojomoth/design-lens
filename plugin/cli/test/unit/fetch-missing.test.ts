/**
 * Unit surface for `localize/fetch-missing` — the refetch of resources the render never requested.
 *
 * WHY these exist: the refetch pass is the ONLY reason a clone carries every `srcset` variant rather
 * than just the one Chromium chose for the capture viewport (sealed A14). It is also the one place
 * the pipeline reaches back to the network AFTER render, so its failure semantics are load-bearing:
 * a dead variant must degrade to a warning + a `manifest.remote[]` entry, never a thrown clone.
 * These cases pin, without a browser:
 *   - which URLs the srcset collector considers (all candidates, deduped, document order; never `data:`),
 *   - which URLs the CSS collector digs out of stylesheet text (T16: the unused `@font-face` a browser
 *     never requests, resolved against the SHEET's origin, through nested cross-origin `@import`s),
 *   - that success lands in the store tagged with the caller's `via` (what makes the manifest honest),
 *   - that retries actually retry, and that exhausting them fails softly,
 *   - that already-captured URLs are never refetched (no duplicate request at the studied site).
 * Remove them and a regression here shows up only as a silently broken image or a dead `@font-face`
 * inside a clone — output nothing in the pipeline validates.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRIES,
  MAX_CSS_IMPORT_DEPTH,
  collectCssUrls,
  collectSrcsetUrls,
  fetchMissing,
  type RefetchClient,
  type RefetchResponse,
} from '../../src/localize/fetch-missing.js';
import { ResourceStore } from '../../src/localize/resource-store.js';

const PAGE = 'https://example.com/pages/index.html';

/** Seed `store` with a stylesheet body at `url`, as the render's response handler would have. */
function seedCss(store: ResourceStore, url: string, css: string): void {
  store.record({ url, status: 200, contentType: 'text/css', body: Buffer.from(css, 'utf8'), via: 'network' });
}

/** Build a fake `APIResponse`; `status` < 400 counts as ok, matching Playwright's `ok()`. */
function response(status: number, contentType: string, body: string): RefetchResponse {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    headers: () => ({ 'content-type': contentType }),
    body: () => Promise.resolve(Buffer.from(body, 'utf8')),
  };
}

/**
 * A fake `RefetchClient` driven by a per-URL script of outcomes (consumed one per attempt), recording
 * every request it received so tests can assert retry counts and that no extra request was made.
 */
function fakeClient(script: Record<string, (RefetchResponse | Error)[]>): RefetchClient & {
  requests: string[];
} {
  const requests: string[] = [];
  return {
    requests,
    get(url: string): Promise<RefetchResponse> {
      requests.push(url);
      const queue = script[url];
      const next = queue?.shift();
      if (next === undefined) return Promise.reject(new Error(`unscripted request: ${url}`));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
}

describe('collectSrcsetUrls', () => {
  // why: the whole point of T14 — BOTH candidates must be offered for refetch, not just the one the
  // renderer picked. A regression to "collect the src only" makes the 2x variant vanish from clones.
  it('collects every candidate of an img srcset, resolved against the page URL', () => {
    const html = '<img src="a.png" srcset="a.png 1x, ../img/a@2x.png 2x">';
    expect(collectSrcsetUrls(html, PAGE)).toEqual([
      'https://example.com/pages/a.png',
      'https://example.com/img/a@2x.png',
    ]);
  });

  // why: <picture> art direction puts candidates on <source>, not <img>; missing them would leave the
  // clone's alternate-format/breakpoint images pointing at the live web.
  it('collects candidates from <source srcset> inside <picture>', () => {
    const html =
      '<picture><source srcset="wide.png 1200w" media="(min-width: 900px)"><img src="n.png"></picture>';
    expect(collectSrcsetUrls(html, PAGE)).toEqual(['https://example.com/pages/wide.png']);
  });

  // why: a data: candidate is already inline and a fragment/mailto/javascript ref is not a resource;
  // requesting any of them would be a guaranteed-failing round trip that pollutes report.warnings[].
  it('never offers data: or non-http candidates for refetch', () => {
    const html =
      '<img srcset="data:image/gif;base64,R0lGOD,with,commas 1x, blob:https://example.com/x 2x, real.png 3x">';
    expect(collectSrcsetUrls(html, PAGE)).toEqual(['https://example.com/pages/real.png']);
  });

  // why: the same variant referenced twice (a repeated logo, a <picture> that names its fallback)
  // must be fetched once. Duplicate requests at the studied site are exactly what a polite tool avoids.
  it('deduplicates URLs (fragment-insensitively) while preserving document order', () => {
    const html =
      '<img srcset="b.png 1x"><img srcset="a.png 1x, b.png#frag 2x"><img srcset="b.png 3x">';
    expect(collectSrcsetUrls(html, PAGE)).toEqual([
      'https://example.com/pages/b.png',
      'https://example.com/pages/a.png',
    ]);
  });

  // why: `srcset` values legally contain commas inside URLs; the collector must reuse the WHATWG
  // parser (not a comma split) or a CDN transform URL gets torn into two bogus requests.
  it('tolerates commas inside candidate URLs', () => {
    const html = '<img srcset="https://cdn.example/w_100,h_50,c_fit/a.png 1x">';
    expect(collectSrcsetUrls(html, PAGE)).toEqual(['https://cdn.example/w_100,h_50,c_fit/a.png']);
  });

  // why: a document with no srcset must cost zero requests — guards against a collector that returns
  // `src` values or an empty-string candidate.
  it('returns nothing when the document has no srcset', () => {
    expect(collectSrcsetUrls('<img src="a.png"><p>text</p>', PAGE)).toEqual([]);
  });
});

describe('collectCssUrls', () => {
  // why (T16, the core case): browsers load fonts LAZILY — an `@font-face` no element renders in is
  // never requested, so its woff2 is absent from the store and no DOM attribute names it. If this
  // collector does not parse stylesheet text, that font can never be localized and the clone ships a
  // rule pointing at the live web. This asserts the URL is dug out of a STORED sheet's body.
  it('finds a url() inside a stored stylesheet the render captured', () => {
    const store = new ResourceStore();
    const sheet = 'https://example.com/css/site.css';
    seedCss(store, sheet, '@font-face { src: url(../fonts/unused.woff2) format("woff2"); }');
    const html = `<link rel="stylesheet" href="${sheet}">`;

    expect(collectCssUrls(html, PAGE, store)).toEqual(['https://example.com/fonts/unused.woff2']);
  });

  // why: a reference inside a stylesheet resolves against THAT SHEET's URL, not the page's. Resolving
  // against the page would send a cross-origin CDN font request to the page's own origin — a 404 that
  // silently degrades to `fetch-failed`. This is the bug the xorigin e2e fixture exists to catch.
  it('resolves references against the stylesheet URL, not the page URL', () => {
    const store = new ResourceStore();
    const sheet = 'https://cdn.example.net/webfont.css';
    seedCss(store, sheet, '@font-face { src: url(fonts/cdn.woff2); }');
    const html = `<link rel="stylesheet" href="${sheet}">`;

    expect(collectCssUrls(html, PAGE, store)).toEqual(['https://cdn.example.net/fonts/cdn.woff2']);
  });

  // why: the @import target itself must be offered even when its bytes are missing — that is the only
  // way a chain of uncaptured sheets can ever be walked (the caller fetches it, then re-collects).
  // A collector that only descended into stored sheets would stop dead at the first missing one.
  it('offers an @import target whose body is absent from the store', () => {
    const store = new ResourceStore();
    const sheet = 'https://example.com/css/site.css';
    seedCss(store, sheet, '@import url(missing.css);');
    const html = `<link rel="stylesheet" href="${sheet}">`;

    expect(collectCssUrls(html, PAGE, store)).toEqual(['https://example.com/css/missing.css']);
  });

  // why: this is the fixpoint the clone loop depends on. Round 1 surfaces the @import; after its bytes
  // land, round 2 must surface the font hiding INSIDE it. If recursion into newly-stored sheets broke,
  // a two-level chain would silently lose its leaf assets.
  it('descends into a nested @import once its body reaches the store', () => {
    const store = new ResourceStore();
    const outer = 'https://example.com/css/site.css';
    const inner = 'https://cdn.example.net/fonts.css';
    seedCss(store, outer, `@import url(${inner});`);
    const html = `<link rel="stylesheet" href="${outer}">`;

    // Round 1: the inner sheet is missing, so only it is offered.
    expect(collectCssUrls(html, PAGE, store)).toEqual([inner]);

    // Round 2: with the inner sheet stored, its own font surfaces (resolved against the CDN).
    seedCss(store, inner, '@font-face { src: url(f/serif.woff2); }');
    expect(collectCssUrls(html, PAGE, store)).toEqual([inner, 'https://cdn.example.net/f/serif.woff2']);
  });

  // why: `<style>` blocks carry the folded CSSOM rules (adoptedStyleSheets, insertRule) the serializer
  // emits. A background-image on an element this capture never painted lives only there.
  it('collects url() from <style> blocks and inline style="" against the page URL', () => {
    const store = new ResourceStore();
    const html =
      '<style>.a { background: url(../img/never-painted.png); }</style>' +
      '<div style="background-image:url(inline.png)"></div>';

    expect(collectCssUrls(html, PAGE, store)).toEqual([
      'https://example.com/img/never-painted.png',
      'https://example.com/pages/inline.png',
    ]);
  });

  // why: a `data:` payload is already inline and `url(#gradient)` names an SVG node in this document.
  // Requesting either is a guaranteed-failing round trip that pollutes report.warnings[].
  it('never offers data: payloads, fragments, or non-http schemes', () => {
    const store = new ResourceStore();
    const html =
      '<style>' +
      '.a { background: url(data:image/gif;base64,R0lGOD); }' +
      '.b { fill: url(#gradient); }' +
      '.c { background: url(blob:https://example.com/x); }' +
      '.d { background: url(real.png); }' +
      '</style>';

    expect(collectCssUrls(html, PAGE, store)).toEqual(['https://example.com/pages/real.png']);
  });

  // why: the same font referenced by two faces (woff2 + a `format()` fallback naming the same file)
  // must be fetched once. Duplicate requests at a site we are merely studying are what politeness costs.
  it('deduplicates URLs fragment-insensitively, preserving discovery order', () => {
    const store = new ResourceStore();
    const html =
      '<style>' +
      '.a { background: url(b.png); }' +
      '.b { background: url(a.png); }' +
      '.c { background: url(b.png#frag); }' +
      '</style>';

    expect(collectCssUrls(html, PAGE, store)).toEqual([
      'https://example.com/pages/b.png',
      'https://example.com/pages/a.png',
    ]);
  });

  // why: a `<link>` stylesheet missing from the store was discovered in the HTML, not inside CSS.
  // Refetching it here would stamp it `via: css-fetch` — a lie the manifest carries forever. It must
  // stay remote with reason `fetch-failed` (spec 02 §6). Deleting this lets provenance rot silently.
  it('does not offer a <link> stylesheet whose own body is absent from the store', () => {
    const store = new ResourceStore();
    const html = '<link rel="stylesheet" href="https://example.com/css/uncaptured.css">';

    expect(collectCssUrls(html, PAGE, store)).toEqual([]);
  });

  // why: `rel="preload stylesheet"` is token-separated and `rel="preload"` alone is not a stylesheet.
  // A substring match on `rel` would walk a preloaded font's bytes as if they were CSS text.
  it('parses rel as tokens, ignoring non-stylesheet links', () => {
    const store = new ResourceStore();
    const multi = 'https://example.com/css/multi.css';
    const preload = 'https://example.com/css/preload.css';
    seedCss(store, multi, '.a { background: url(m.png); }');
    seedCss(store, preload, '.b { background: url(p.png); }');
    const html =
      `<link rel="preload stylesheet" href="${multi}">` + `<link rel="preload" href="${preload}">`;

    expect(collectCssUrls(html, PAGE, store)).toEqual(['https://example.com/css/m.png']);
  });

  // why: a circular @import (a→b→a) is legal CSS and appears in the wild via shared partials. Without
  // the visited-set guard the collector recurses until the stack blows — taking the whole clone down.
  it('terminates on a circular @import chain', () => {
    const store = new ResourceStore();
    const a = 'https://example.com/css/a.css';
    const b = 'https://example.com/css/b.css';
    seedCss(store, a, `@import url(${b});`);
    seedCss(store, b, `@import url(${a}); .b { background: url(leaf.png); }`);
    const html = `<link rel="stylesheet" href="${a}">`;

    expect(collectCssUrls(html, PAGE, store)).toEqual([b, a, 'https://example.com/css/leaf.png']);
  });

  // why: the depth bound is the backstop against an adversarial (or generated) import chain. It must
  // stop descending, NOT stop collecting — the sheet at the boundary is still offered for fetching.
  it('stops descending at MAX_CSS_IMPORT_DEPTH but still offers the boundary sheet', () => {
    const store = new ResourceStore();
    const url = (n: number): string => `https://example.com/css/s${n}.css`;
    // A chain longer than the cap, every level stored: s0 → s1 → … → s(depth+1).
    for (let n = 0; n <= MAX_CSS_IMPORT_DEPTH + 1; n++) {
      seedCss(store, url(n), `@import url(${url(n + 1)}); .s${n} { background: url(x${n}.png); }`);
    }
    const html = `<link rel="stylesheet" href="${url(0)}">`;

    const found = collectCssUrls(html, PAGE, store);

    // Walking s0 is depth 0, so sheets s1…s(MAX) are descended into and s(MAX+1) is only offered.
    expect(found).toContain(url(MAX_CSS_IMPORT_DEPTH));
    expect(found).toContain(`https://example.com/css/x${MAX_CSS_IMPORT_DEPTH}.png`);
    expect(found).toContain(url(MAX_CSS_IMPORT_DEPTH + 1));
    expect(found).not.toContain(`https://example.com/css/x${MAX_CSS_IMPORT_DEPTH + 1}.png`);
  });

  // why: a document whose CSS names no external resource must cost zero requests.
  it('returns nothing when no CSS references anything external', () => {
    const store = new ResourceStore();
    expect(collectCssUrls('<style>.a { color: red; }</style>', PAGE, store)).toEqual([]);
  });
});

describe('fetchMissing', () => {
  // why (AC): a refetched variant MUST land in the store tagged `via: 'refetch'` — that tag is what
  // the manifest publishes to distinguish it from a render-captured `network` resource.
  it('records a fetched resource into the store with via: refetch', async () => {
    const store = new ResourceStore();
    const url = 'https://example.com/img/a@2x.png';
    const client = fakeClient({ [url]: [response(200, 'image/png', 'PNGBYTES')] });

    const outcome = await fetchMissing(client, [url], store);

    expect(outcome).toEqual({ fetched: [url], failed: [] });
    const stored = store.get(url);
    expect(stored?.via).toBe('refetch');
    expect(stored?.status).toBe(200);
    expect(stored?.contentType).toBe('image/png');
    expect(stored?.body.toString('utf8')).toBe('PNGBYTES');
  });

  // why: the store keys by the REQUESTED url because that is the reference the localize pass looks
  // up. Keying by a redirect's final url would silently orphan the reference and leave it remote.
  it('keys the stored resource by the requested URL, not a redirected one', async () => {
    const store = new ResourceStore();
    const requested = 'https://example.com/img/a@2x.png';
    const client = fakeClient({ [requested]: [response(200, 'image/png', 'X')] });

    await fetchMissing(client, [requested], store);

    expect(store.has(requested)).toBe(true);
    expect(store.size).toBe(1);
  });

  // why (spec 02 §M2 "Retries ×2"): a transient network blip must not cost the clone an asset. If the
  // retry loop regresses to a single attempt, this fails.
  it('retries a throwing request and succeeds on a later attempt', async () => {
    const store = new ResourceStore();
    const url = 'https://example.com/a.png';
    const client = fakeClient({
      [url]: [new Error('socket hang up'), response(200, 'image/png', 'OK')],
    });

    const outcome = await fetchMissing(client, [url], store);

    expect(outcome.fetched).toEqual([url]);
    expect(client.requests).toEqual([url, url]);
  });

  // why: a non-2xx is a failure like any other and must be retried, then reported with its status —
  // a 404'd variant that was silently recorded would write an HTML error page into clone/assets/.
  it('retries a non-2xx status and reports the last status after exhausting attempts', async () => {
    const store = new ResourceStore();
    const url = 'https://example.com/gone.png';
    const client = fakeClient({
      [url]: [response(500, 'text/html', 'err'), response(500, 'text/html', 'err'), response(404, 'text/html', 'nope')],
    });

    const outcome = await fetchMissing(client, [url], store);

    // DEFAULT_RETRIES extra attempts after the first ⇒ 3 total, and nothing is stored.
    expect(client.requests).toHaveLength(DEFAULT_RETRIES + 1);
    expect(outcome.fetched).toEqual([]);
    expect(outcome.failed).toEqual([{ url, detail: 'HTTP 404' }]);
    expect(store.has(url)).toBe(false);
  });

  // why (degradation ladder): one dead URL must not abort the refetch of the others, and must never
  // throw out of the pass — the clone proceeds and the reference is recorded remote by localize.
  it('fails softly for one URL and keeps fetching the rest', async () => {
    const store = new ResourceStore();
    const dead = 'https://example.com/dead.png';
    const live = 'https://example.com/live.png';
    const client = fakeClient({
      [dead]: [new Error('ECONNREFUSED'), new Error('ECONNREFUSED'), new Error('ECONNREFUSED')],
      [live]: [response(200, 'image/png', 'OK')],
    });

    const outcome = await fetchMissing(client, [dead, live], store);

    expect(outcome.failed).toEqual([{ url: dead, detail: 'ECONNREFUSED' }]);
    expect(outcome.fetched).toEqual([live]);
    expect(store.has(live)).toBe(true);
  });

  // why: refetching a URL the render already captured would re-request it at the studied site and
  // overwrite `via: 'network'` with `via: 'refetch'`, corrupting the manifest's provenance.
  it('never refetches a URL whose bytes the render already captured', async () => {
    const store = new ResourceStore();
    const url = 'https://example.com/a.png';
    store.record({ url, status: 200, contentType: 'image/png', body: Buffer.from('R'), via: 'network' });
    const client = fakeClient({});

    const outcome = await fetchMissing(client, [url], store);

    expect(client.requests).toEqual([]);
    expect(outcome).toEqual({ fetched: [], failed: [] });
    expect(store.get(url)?.via).toBe('network');
  });

  // why: `retries: 0` must mean exactly one attempt — the caller's budget knob has to be honoured or
  // a tight `--timeout` still pays for three round trips per dead URL.
  it('honours retries: 0 as a single attempt', async () => {
    const store = new ResourceStore();
    const url = 'https://example.com/a.png';
    const client = fakeClient({ [url]: [new Error('boom')] });

    const outcome = await fetchMissing(client, [url], store, { retries: 0 });

    expect(client.requests).toEqual([url]);
    expect(outcome.failed).toEqual([{ url, detail: 'boom' }]);
  });

  // why: the per-request timeout must reach the client, or a hung variant fetch stalls the whole
  // clone past its `--timeout` budget.
  it('passes the per-request timeout through to the client', async () => {
    const store = new ResourceStore();
    const url = 'https://example.com/a.png';
    const seen: (number | undefined)[] = [];
    const client: RefetchClient = {
      get(requestUrl: string, options?: { timeout?: number }): Promise<RefetchResponse> {
        expect(requestUrl).toBe(url);
        seen.push(options?.timeout);
        return Promise.resolve(response(200, 'image/png', 'OK'));
      },
    };

    await fetchMissing(client, [url], store, { timeoutMs: 4321 });

    expect(seen).toEqual([4321]);
  });

  // why (T16, spec 03): `css-fetch` and `refetch` are DIFFERENT provenance claims — "discovered inside
  // CSS and fetched" vs "re-fetched post-render". Only the caller knows where the reference was found,
  // so it must be able to say. Hardcoding `refetch` here would make every localized webfont lie about
  // how it was discovered, and `css-fetch` would be a value the manifest schema allows but never emits.
  it('stamps the caller-supplied via on fetched bytes, defaulting to refetch', async () => {
    const store = new ResourceStore();
    const font = 'https://cdn.example.net/fonts/serif.woff2';
    const image = 'https://example.com/a@2x.png';
    const client = fakeClient({
      [font]: [response(200, 'font/woff2', 'WOFF2')],
      [image]: [response(200, 'image/png', 'PNG')],
    });

    await fetchMissing(client, [font], store, { via: 'css-fetch' });
    await fetchMissing(client, [image], store);

    expect(store.get(font)?.via).toBe('css-fetch');
    expect(store.get(image)?.via).toBe('refetch');
  });
});
