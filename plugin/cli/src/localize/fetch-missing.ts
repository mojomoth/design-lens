/**
 * Refetch resources the page REFERENCES but the render never REQUESTED (spec 02 §M2 "Refetch of
 * uncaptured resources"). Split into pure collectors and one narrow I/O seam so both are testable.
 *
 * Two distinct ways a reference escapes the render, hence two collectors:
 *
 * 1. `srcset` ({@link collectSrcsetUrls}) — `<img srcset="hero.png 1x, hero@2x.png 2x">` makes
 *    Chromium request exactly ONE candidate, the one matching the capture viewport and `--dsf`, so
 *    the other variant's bytes never reach the ResourceStore and the localize pass would leave it a
 *    live remote URL (a broken image the moment the clone leaves this machine). Selecting a
 *    different variant per viewport is not an option: a clone must carry EVERY candidate, because it
 *    is re-rendered at arbitrary widths and device pixel ratios (sealed A14). ⇒ `via: refetch`.
 *
 * 2. CSS-discovered refs ({@link collectCssUrls}) — a browser fetches a `@font-face src` only when
 *    some element actually renders text in that family (lazy font loading), and a `background-image`
 *    only when its element is painted. A stylesheet therefore names resources the render never
 *    requested: unused faces, off-branch `unicode-range` subsets, rules for states the capture never
 *    entered. Nothing in the DOM points at them — they exist only inside CSS text, reachable by
 *    parsing every `<style>` block, every stored stylesheet body, and every nested `@import`.
 *    ⇒ `via: css-fetch` ("discovered inside CSS and fetched", spec 03).
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
 * Spec: specs/02-clone-engine.md §M2 (Refetch of uncaptured resources: srcset, CSS-discovered fonts);
 *       specs/03-clone-format.md §manifest.json schema (`via: network|css-fetch|refetch`).
 */

import * as cheerio from 'cheerio';

import { parseSrcset } from './srcset.js';
import { rewriteCss, type CssRefKind } from './css-rewrite.js';
import { isCssResource } from './media-type.js';
import { ResourceStore } from './resource-store.js';
import type { ResourceVia } from '../output/manifest.js';

/** Extra attempts after the first (spec 02 §M2: "Retries ×2"). */
export const DEFAULT_RETRIES = 2;

/** Per-request budget when the caller supplies none. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * How deep {@link collectCssUrls} follows an `@import` chain within one call, and (as the caller's
 * round cap) how many fetch→re-collect rounds a chain of not-yet-fetched sheets may take. Real sites
 * nest one or two levels; the bound exists so a pathological or adversarial chain cannot spin.
 */
export const MAX_CSS_IMPORT_DEPTH = 8;

/** Provenance a refetch may claim: bytes we went back for, from a DOM ref or from inside CSS. */
export type RefetchVia = Extract<ResourceVia, 'refetch' | 'css-fetch'>;

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
  /** Absolute URLs recorded into the store with the requested `via`, in attempt order. */
  fetched: string[];
  /** Absolute URLs that exhausted their retries; the localize pass will record them as remote. */
  failed: RefetchFailure[];
}

/** Tunables for {@link fetchMissing}; each defaults to the module constant named beside it. */
export interface FetchMissingOptions {
  /** Extra attempts after the first. `0` ⇒ a single attempt. Default {@link DEFAULT_RETRIES}. */
  retries?: number;
  /** Per-request timeout in ms, handed to the client. Default {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Provenance stamped on every body this call records. The caller knows WHERE the reference was
   * found — the store cannot infer it — so it passes `'css-fetch'` for URLs that
   * {@link collectCssUrls} dug out of stylesheet text and `'refetch'` (the default) for DOM
   * references like unused `srcset` candidates. Spec 03 keeps these distinct in the manifest.
   */
  via?: RefetchVia;
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
 * Collect every http(s) URL reachable from the document's CSS, resolved absolute (PURE, no network).
 *
 * "Reachable from the CSS" means the transitive closure over:
 *   - every `<style>` block's text (base: `pageUrl`),
 *   - every `<link rel=stylesheet>` body found in `store` (base: THAT sheet's own URL — a
 *     `url(fonts/x.woff2)` in a CDN stylesheet resolves against the CDN, not the page),
 *   - every inline `style=""` declaration list (base: `pageUrl`),
 *   - and recursively, every `@import`ed sheet whose body is already in `store`.
 *
 * The result includes URLs already present in `store`; the caller filters those out. That keeps this
 * function's contract independent of fetch state and makes it safe to call again after a fetch round:
 * a sheet that was missing on round N is in the store on round N+1, so its own references surface
 * then. `data:` payloads, `#fragment` targets and non-http(s) schemes never appear.
 *
 * An `@import` cycle terminates on the visited-set check; {@link MAX_CSS_IMPORT_DEPTH} bounds depth.
 *
 * NOT collected: a `<link rel=stylesheet>` whose own body is absent from the store. That sheet was
 * discovered in the HTML, not inside CSS, so refetching it here would stamp it `css-fetch` — a lie
 * the manifest would carry forever. It stays remote with reason `fetch-failed`, as spec 02 §6 says.
 */
export function collectCssUrls(html: string, pageUrl: string, store: ResourceStore): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  /** Sheets already descended into — the `@import` cycle guard. */
  const descended = new Set<string>();

  const push = (url: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  /**
   * Walk one CSS body, recording every reference and descending into the stylesheets among them.
   * `resolve` always returns `null`, so `rewriteCss` mutates nothing and its output is discarded —
   * we are borrowing its css-tree walk (escapes, `@import` preludes) purely as a discovery seam.
   */
  const walkCss = (css: string, baseUrl: string, depth: number, inline = false): void => {
    rewriteCss(
      css,
      baseUrl,
      (absolute: string, kind: CssRefKind): null => {
        const fetchable = toFetchableUrl(absolute, baseUrl);
        if (fetchable === null) return null;
        push(fetchable);

        // Descend only into sheets we already hold. A missing sheet was just pushed, so a later
        // round (once its bytes land in the store) will walk it.
        if (depth >= MAX_CSS_IMPORT_DEPTH || descended.has(fetchable)) return null;
        const stored = store.get(fetchable);
        if (stored === undefined) return null;
        const isSheet =
          kind === 'import' || isCssResource(stored.contentType, new URL(fetchable).pathname);
        if (!isSheet) return null;

        descended.add(fetchable);
        walkCss(stored.body.toString('utf8'), fetchable, depth + 1);
        return null;
      },
      inline ? { context: 'declarationList' } : {},
    );
  };

  const $ = cheerio.load(html);

  $('style').each((_, el) => {
    const css = $(el).text();
    if (css.trim() !== '') walkCss(css, pageUrl, 0);
  });

  $('link').each((_, el) => {
    const href = $(el).attr('href');
    if (href === undefined) return;
    const rel = (el.attribs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.includes('stylesheet')) return;
    const absolute = toFetchableUrl(href, pageUrl);
    if (absolute === null || descended.has(absolute)) return;
    const stored = store.get(absolute);
    if (stored === undefined) return; // see the doc comment: HTML-discovered, not ours to refetch
    descended.add(absolute);
    walkCss(stored.body.toString('utf8'), absolute, 0);
  });

  $('[style]').each((_, el) => {
    const raw = $(el).attr('style');
    if (raw === undefined || !raw.includes('url(')) return;
    walkCss(raw, pageUrl, 0, true);
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
 * store with `options.via` (default `'refetch'`) so the localize pass treats it exactly like a
 * render-captured resource — the only surviving difference is the manifest's provenance field.
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
  const via: RefetchVia = options.via ?? 'refetch';

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
        via,
      });
      fetched.push(url);
    } catch (err) {
      failed.push({ url, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return { fetched, failed };
}
