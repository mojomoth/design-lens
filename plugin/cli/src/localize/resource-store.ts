/**
 * In-memory record of every HTTP response the render captured (PURE data structure, no I/O).
 *
 * During capture, `page.on('response')` feeds each successful body here keyed by its absolute URL;
 * the localize pass then asks the store, for each reference it finds in the HTML/CSS, whether that
 * resource's bytes were captured. Refs present in the store are localised from these bytes; refs
 * absent stay remote (M1) or are refetched (M2, `localize/fetch-missing.ts`). Keeping this a plain
 * class — separate from the browser wiring in `capture/browser.ts` — lets it be unit-tested without
 * a live page.
 *
 * Lookups and inserts normalise the URL (drop the fragment, which never survives an HTTP request)
 * so a reference written `x.css#frag` still finds the response recorded for `x.css`. A later insert
 * for the same URL wins (the last body served is the one the page actually rendered against).
 *
 * Spec: specs/02-clone-engine.md §1 (Launch → ResourceStore) and §6 (Localize).
 */

/** One captured response: its final URL, HTTP status, content type, and raw body bytes. */
export interface StoredResource {
  /** Absolute URL the response was served from (after redirects). */
  url: string;
  /** HTTP status (only 2xx bodies are recorded by the capture wiring). */
  status: number;
  /** `content-type` header verbatim (may include a `; charset=…` parameter). */
  contentType: string;
  /** The response body exactly as received. */
  body: Buffer;
}

/** Normalise a URL for keying: strip the fragment (HTTP never sends it); tolerate malformed input. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

/** Records captured responses and answers "were these bytes captured?" for the localize pass. */
export class ResourceStore {
  private readonly byUrl = new Map<string, StoredResource>();

  /** Record (or overwrite) the response for its URL; the last body served for a URL wins. */
  record(resource: StoredResource): void {
    this.byUrl.set(normalizeUrl(resource.url), resource);
  }

  /** The captured response for `url` (fragment-insensitive), or `undefined` if never captured. */
  get(url: string): StoredResource | undefined {
    return this.byUrl.get(normalizeUrl(url));
  }

  /** True when a body for `url` was captured. */
  has(url: string): boolean {
    return this.byUrl.has(normalizeUrl(url));
  }

  /** Number of distinct captured resources (for stats/tests). */
  get size(): number {
    return this.byUrl.size;
  }
}
