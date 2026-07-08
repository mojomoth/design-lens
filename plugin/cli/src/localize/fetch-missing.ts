/**
 * Refetch resources the page REFERENCES but the render never REQUESTED (spec 02 §M2 "Refetch of
 * uncaptured resources"). Split into a pure collector and one narrow I/O seam so both are testable.
 *
 * The motivating case is `srcset`: a `<img srcset="hero.png 1x, hero@2x.png 2x">` makes Chromium
 * request exactly ONE candidate — the one matching the capture viewport and `--dsf` — so the other
 * variant's bytes never reach the ResourceStore, and the localize pass would leave it as a live
 * remote URL (a broken image the moment the clone leaves this machine). Selecting a different
 * variant per viewport is not an option: a clone must carry EVERY candidate, because the clone is
 * re-rendered at arbitrary widths and device pixel ratios (sealed A14).
 *
 * Fetching goes through the BROWSER CONTEXT's request client (`context.request.get`), never Node's
 * `fetch`: the browser context carries the real Chromium UA, its cookies, and its origin — and UA is
 * load-bearing, since Google Fonts serves a single TTF face to an unknown UA but woff2 + unicode-range
 * subsets to a Chrome UA (verified; spec 02 §Verified facts). That client is injected as the narrow
 * {@link RefetchClient} interface so unit tests need no browser.
 *
 * Failures are NOT fatal and are NOT recorded here: an unfetched URL simply stays absent from the
 * store, so the localize pass leaves the reference as authored and records it in `manifest.remote[]`
 * with reason `fetch-failed` — one code path for "we never got these bytes", however that happened.
 * The caller folds the returned failures into `report.warnings[]` (degradation ladder, spec 02).
 *
 * Spec: specs/02-clone-engine.md §M2 (Refetch of uncaptured resources, srcset);
 *       specs/03-clone-format.md §manifest.json schema (`via: refetch`).
 */

import * as cheerio from 'cheerio';

import { parseSrcset } from './srcset.js';
import { ResourceStore } from './resource-store.js';

/** Extra attempts after the first (spec 02 §M2: "Retries ×2"). */
export const DEFAULT_RETRIES = 2;

/** Per-request budget when the caller supplies none. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The slice of Playwright's `APIRequestContext` this module needs. Declaring it structurally (rather
 * than importing the Playwright type) keeps `playwright` external to the bundle AND lets the unit
 * tests drive `fetchMissing` with a fake client — no browser, no network.
 */
export interface RefetchClient {
  get(url: string, options?: { timeout?: number }): Promise<RefetchResponse>;
}

/** The slice of Playwright's `APIResponse` this module reads. */
export interface RefetchResponse {
  ok(): boolean;
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
}

/** One URL we could not fetch, with the reason (a status line or the thrown error's message). */
export interface RefetchFailure {
  url: string;
  detail: string;
}

/** What `fetchMissing` did: URLs whose bytes now sit in the store, and the ones that stayed absent. */
export interface RefetchOutcome {
  /** Absolute URLs recorded into the store with `via: 'refetch'`, in attempt order. */
  fetched: string[];
  /** Absolute URLs that exhausted their retries; the localize pass will record them as remote. */
  failed: RefetchFailure[];
}

/** Tunables for {@link fetchMissing}; both default to the module constants. */
export interface FetchMissingOptions {
  /** Extra attempts after the first. `0` ⇒ a single attempt. */
  retries?: number;
  /** Per-request timeout in milliseconds, handed to the client. */
  timeoutMs?: number;
}

/**
 * A reference no HTTP request can ever satisfy: an inline payload, a non-web scheme, a same-document
 * fragment, or the empty string. Mirrors `localize.ts#isUnlocalizable` — a URL this rejects is one
 * the localize pass will never look up in the store either, so refetching it would be pure waste.
 */
function isUnfetchable(raw: string): boolean {
  return (
    raw === '' ||
    raw.startsWith('data:') ||
    raw.startsWith('mailto:') ||
    raw.startsWith('tel:') ||
    raw.startsWith('#') ||
    raw.startsWith('javascript:')
  );
}

/**
 * Resolve `raw` against `pageUrl` and keep it only if it is an http(s) URL. `blob:` and other
 * schemes resolve to a valid `URL` but cannot be refetched from outside the page that minted them.
 */
function toFetchableUrl(raw: string, pageUrl: string): string | null {
  if (isUnfetchable(raw)) return null;
  let absolute: URL;
  try {
    absolute = new URL(raw, pageUrl);
  } catch {
    return null;
  }
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null;
  absolute.hash = ''; // the store keys fragment-insensitively; HTTP never sends a fragment
  return absolute.href;
}

/**
 * Collect every `srcset` candidate URL in `html`, resolved absolute against `pageUrl` (PURE, no I/O).
 *
 * Returns each distinct URL once, in document order. `data:` candidates and unresolvable references
 * are dropped. Descriptors are irrelevant here — the clone localizes ALL candidates, not the one the
 * renderer happened to pick — so this deliberately ignores `w`/`x` values and the `sizes` attribute.
 *
 * Callers filter the result against the ResourceStore; whatever remains is what the render missed.
 */
export function collectSrcsetUrls(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $('img[srcset], source[srcset]').each((_, el) => {
    const raw = $(el).attr('srcset');
    if (raw === undefined) return;
    for (const candidate of parseSrcset(raw)) {
      const absolute = toFetchableUrl(candidate.url, pageUrl);
      if (absolute === null || seen.has(absolute)) continue;
      seen.add(absolute);
      urls.push(absolute);
    }
  });

  return urls;
}

/**
 * Fetch one URL, retrying on a thrown error or a non-2xx status. Returns the successful response, or
 * throws the LAST failure's reason so the caller can record it verbatim.
 */
async function fetchWithRetries(
  client: RefetchClient,
  url: string,
  attempts: number,
  timeoutMs: number,
): Promise<RefetchResponse> {
  let lastDetail = 'no attempt was made';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await client.get(url, { timeout: timeoutMs });
      if (response.ok()) return response;
      lastDetail = `HTTP ${response.status()}`;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastDetail);
}

/**
 * Fetch every URL in `urls` that the store does not already hold, recording each success into the
 * store with `via: 'refetch'` so the localize pass treats it exactly like a render-captured resource.
 *
 * Requests run SEQUENTIALLY: the refetch list is short (unused srcset variants, CSS-discovered fonts)
 * and a capture must not fan out a burst of requests at a site it is merely studying.
 *
 * The response is recorded under the REQUESTED url, not the response's final url — the localize pass
 * looks the resource up by the reference it found in the markup, so a redirect must not hide it.
 *
 * Never throws for a single URL's failure: failures come back in {@link RefetchOutcome.failed}.
 */
export async function fetchMissing(
  client: RefetchClient,
  urls: string[],
  store: ResourceStore,
  options: FetchMissingOptions = {},
): Promise<RefetchOutcome> {
  const attempts = (options.retries ?? DEFAULT_RETRIES) + 1;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fetched: string[] = [];
  const failed: RefetchFailure[] = [];

  for (const url of urls) {
    if (store.has(url)) continue; // already captured during render — nothing to refetch
    try {
      const response = await fetchWithRetries(client, url, attempts, timeoutMs);
      store.record({
        url,
        status: response.status(),
        contentType: (response.headers()['content-type'] ?? '').trim(),
        body: await response.body(),
        via: 'refetch',
      });
      fetched.push(url);
    } catch (err) {
      failed.push({ url, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return { fetched, failed };
}
