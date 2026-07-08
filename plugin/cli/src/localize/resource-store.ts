/**
 * In-memory record of every HTTP response the render captured (PURE data structure, no I/O).
 *
 * During capture, `page.on('response')` feeds each successful body here keyed by its absolute URL;
 * the localize pass then asks the store, for each reference it finds in the HTML/CSS, whether that
 * resource's bytes were captured. Refs present in the store are localised from these bytes; refs
 * absent are refetched into it by `localize/fetch-missing.ts` before localize runs, and whatever is
 * STILL absent stays remote. Keeping this a plain class — separate from the browser wiring in
 * `capture/browser.ts` — lets it be unit-tested without a live page.
 *
 * Each entry carries the {@link ResourceVia} provenance of its bytes, which is what lets the manifest
 * distinguish a resource the render fetched (`network`) from one we had to go back for (`refetch`).
 * The store is the single place that knows this, so recording it here keeps `localize.ts` from having
 * to guess.
 *
 * Lookups and inserts normalise the URL (drop the fragment, which never survives an HTTP request)
 * so a reference written `x.css#frag` still finds the response recorded for `x.css`. A later insert
 * for the same URL wins (the last body served is the one the page actually rendered against).
 *
 * Spec: specs/02-clone-engine.md §1 (Launch → ResourceStore), §6 (Localize), §M2 (Refetch).
 */

import type { ResourceVia } from '../output/manifest.js';

/** One captured response: its URL, HTTP status, content type, raw body bytes, and provenance. */
export interface StoredResource {
  /** Absolute URL the resource is keyed by (the reference the localize pass will look up). */
  url: string;
  /** HTTP status (only 2xx bodies are recorded by the capture wiring). */
  status: number;
  /** `content-type` header verbatim (may include a `; charset=…` parameter). */
  contentType: string;
  /** The response body exactly as received. */
  body: Buffer;
  /** How these bytes were obtained: captured during render, fetched from CSS, or refetched. */
  via: ResourceVia;
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
