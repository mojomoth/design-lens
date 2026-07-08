/**
 * Unit surface for `localize/fetch-missing` — the refetch of resources the render never requested.
 *
 * WHY these exist: the refetch pass is the ONLY reason a clone carries every `srcset` variant rather
 * than just the one Chromium chose for the capture viewport (sealed A14). It is also the one place
 * the pipeline reaches back to the network AFTER render, so its failure semantics are load-bearing:
 * a dead variant must degrade to a warning + a `manifest.remote[]` entry, never a thrown clone.
 * These cases pin, without a browser:
 *   - which URLs the collector considers (all candidates, deduped, document order; never `data:`),
 *   - that success lands in the store tagged `via: 'refetch'` (what makes the manifest honest),
 *   - that retries actually retry, and that exhausting them fails softly,
 *   - that already-captured URLs are never refetched (no duplicate request at the studied site).
 * Remove them and a regression here shows up only as a silently broken image inside a clone.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRIES,
  collectSrcsetUrls,
  fetchMissing,
  type RefetchClient,
  type RefetchResponse,
} from '../../src/localize/fetch-missing.js';
import { ResourceStore } from '../../src/localize/resource-store.js';

const PAGE = 'https://example.com/pages/index.html';

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
});
