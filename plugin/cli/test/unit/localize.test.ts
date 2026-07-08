/**
 * Unit tests for the localize pass's REMOTE POLICY — the three reasons a reference is left as
 * authored instead of copied into `clone/assets/` (spec 02 §6): `media-skipped`, `fetch-failed`,
 * `oversize`.
 *
 * WHY this file exists: `localizeDocument` decides, for every reference on the page, whether bytes
 * get copied. That decision is the difference between a 200 KB design clone and a 400 MB one, and
 * between a truthful `manifest.remote[]` and a provenance record that blames the network for a
 * policy choice. The e2e suite proves the flags are WIRED; only these tests can exercise the
 * decision table directly — including the boundary (a body exactly at the limit localizes) and the
 * precedence between reasons, neither of which any fixture can express.
 *
 * If these are removed: a regression that reports a deliberately-skipped `<video>` as
 * `fetch-failed`, or that drops a `poster` frame along with the video `src` it sits next to, ships
 * green — both produce a clone that still exits 0 and still passes every sealed assertion.
 */

import { describe, expect, it } from 'vitest';

import {
  localizeDocument,
  BYTES_PER_MB,
  DEFAULT_MAX_ASSET_MB,
  type LocalizeOptions,
} from '../../src/localize/localize.js';
import { ResourceStore } from '../../src/localize/resource-store.js';

const PAGE = 'https://example.com/index.html';

/** Build a store from `{url, contentType, body}` triples, all recorded as captured at render. */
function storeWith(
  entries: { url: string; contentType: string; body: Buffer | string }[],
): ResourceStore {
  const store = new ResourceStore();
  for (const entry of entries) {
    store.record({
      url: entry.url,
      status: 200,
      contentType: entry.contentType,
      body: typeof entry.body === 'string' ? Buffer.from(entry.body, 'utf8') : entry.body,
      via: 'network',
    });
  }
  return store;
}

/** The spec defaults, stated explicitly so a test can vary exactly one knob at a time. */
function options(overrides: Partial<LocalizeOptions> = {}): LocalizeOptions {
  return { maxAssetBytes: DEFAULT_MAX_ASSET_MB * BYTES_PER_MB, includeMedia: false, ...overrides };
}

describe('localizeDocument — oversize bodies', () => {
  // why: `--max-asset-mb` exists to stop a clone swallowing a 40 MB hero image. If the size gate
  // regresses, nothing else notices: the clone is still valid, still inert, still verifiable — just
  // enormous. The reference must ALSO stay byte-identical to how it was authored, since a rewritten
  // `assets/…` path pointing at a file we deliberately did not write is a broken clone.
  it('leaves a body larger than the limit remote with reason oversize', () => {
    const store = storeWith([
      { url: 'https://example.com/big.png', contentType: 'image/png', body: Buffer.alloc(2048) },
    ]);
    const result = localizeDocument(
      '<html><body><img data-dl-id="dl-1" src="big.png"></body></html>',
      PAGE,
      store,
      options({ maxAssetBytes: 1024 }),
    );

    expect(result.assets).toHaveLength(0);
    expect(result.remote).toEqual([
      { url: 'https://example.com/big.png', reason: 'oversize', referencedBy: 'dl-1' },
    ]);
    expect(result.html).toContain('src="big.png"');
    expect(result.stats.images).toBe(0);
  });

  // why: the spec says bodies "over" the limit stay remote, so the limit itself is INCLUSIVE. An
  // off-by-one here (`>=` instead of `>`) silently drops every asset that lands exactly on a round
  // byte boundary — the most likely size for a generated or padded fixture asset.
  it('localizes a body exactly at the limit (the bound is inclusive)', () => {
    const store = storeWith([
      { url: 'https://example.com/exact.png', contentType: 'image/png', body: Buffer.alloc(1024) },
    ]);
    const result = localizeDocument(
      '<html><body><img data-dl-id="dl-1" src="exact.png"></body></html>',
      PAGE,
      store,
      options({ maxAssetBytes: 1024 }),
    );

    expect(result.remote).toEqual([]);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.assetPath).toMatch(/^assets\/example-com\/exact\.png$/);
  });

  // why: an oversize STYLESHEET is not just one skipped file — its `url()` and `@import` targets are
  // discovered by parsing its body, so skipping it prunes the whole subtree. This pins that the pass
  // prunes cleanly (no crash, no half-localized child) rather than recording phantom children it
  // never actually looked at.
  it('prunes the reference subtree under an oversize stylesheet', () => {
    const store = storeWith([
      {
        url: 'https://example.com/big.css',
        contentType: 'text/css',
        body: `@import url(child.css);\n${'/* pad */'.repeat(200)}`,
      },
      { url: 'https://example.com/child.css', contentType: 'text/css', body: 'a{color:red}' },
    ]);
    const result = localizeDocument(
      '<html><head><link rel="stylesheet" href="big.css"></head><body></body></html>',
      PAGE,
      store,
      options({ maxAssetBytes: 64 }),
    );

    expect(result.remote).toEqual([
      { url: 'https://example.com/big.css', reason: 'oversize', referencedBy: 'link' },
    ]);
    expect(result.assets).toHaveLength(0);
    expect(result.html).toContain('href="big.css"');
  });
});

describe('localizeDocument — bulk media', () => {
  // why: this is the whole point of `--include-media` being OFF by default. The `poster` assertion
  // is the discriminator: a "skip the media element" implementation (rather than "skip the media
  // REFERENCE") passes the mp4 half and silently loses the poster frame — the one image on a <video>
  // that a designer actually needs.
  it('skips a captured mp4 while still localizing the poster on the same element', () => {
    const store = storeWith([
      { url: 'https://example.com/promo.mp4', contentType: 'video/mp4', body: Buffer.alloc(64) },
      { url: 'https://example.com/poster.png', contentType: 'image/png', body: Buffer.alloc(64) },
    ]);
    const result = localizeDocument(
      '<html><body><video data-dl-id="dl-9" src="promo.mp4" poster="poster.png"></video></body></html>',
      PAGE,
      store,
      options(),
    );

    expect(result.remote).toEqual([
      { url: 'https://example.com/promo.mp4', reason: 'media-skipped', referencedBy: 'dl-9' },
    ]);
    expect(result.assets.map((a) => a.assetPath)).toEqual(['assets/example-com/poster.png']);
    expect(result.html).toContain('src="promo.mp4"');
    expect(result.html).toContain('poster="assets/example-com/poster.png"');
  });

  // why (ORDERING GUARD): Chromium routinely never requests a `<video src>` — `preload="none"`, an
  // unsupported codec, a decode abort. Such a ref is absent from the store, so a naive
  // store-lookup-first implementation reports `fetch-failed`, blaming the network for a policy
  // decision we made deliberately. The media check must run BEFORE the store is consulted.
  it('reports an uncaptured mp4 as media-skipped, never fetch-failed', () => {
    const result = localizeDocument(
      '<html><body><video data-dl-id="dl-2" src="never-requested.mp4"></video></body></html>',
      PAGE,
      new ResourceStore(),
      options(),
    );

    expect(result.remote).toEqual([
      { url: 'https://example.com/never-requested.mp4', reason: 'media-skipped', referencedBy: 'dl-2' },
    ]);
  });

  // why: the flag has to actually turn the behaviour off, and the bytes must land under `assets/`
  // like any other resource — same URL mapping, same verbatim body, nothing left in `remote[]`.
  it('localizes bulk media under --include-media', () => {
    const store = storeWith([
      { url: 'https://example.com/promo.mp4', contentType: 'video/mp4', body: Buffer.from('MP4BYTES') },
    ]);
    const result = localizeDocument(
      '<html><body><video data-dl-id="dl-3" src="promo.mp4"></video></body></html>',
      PAGE,
      store,
      options({ includeMedia: true }),
    );

    expect(result.remote).toEqual([]);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.assetPath).toBe('assets/example-com/promo.mp4');
    expect(result.assets[0]!.body.toString('utf8')).toBe('MP4BYTES');
    expect(result.html).toContain('src="assets/example-com/promo.mp4"');
  });

  // why (ORDERING GUARD): with `--include-media` a huge video is no longer skipped as media, so the
  // size gate must still catch it. `oversize` is the informative reason here — it tells the user to
  // raise `--max-asset-mb`, whereas `media-skipped` would tell them to pass a flag they already did.
  it('reports an oversize video as oversize once --include-media removes the media skip', () => {
    const store = storeWith([
      { url: 'https://example.com/huge.mp4', contentType: 'video/mp4', body: Buffer.alloc(4096) },
    ]);
    const result = localizeDocument(
      '<html><body><video data-dl-id="dl-4" src="huge.mp4"></video></body></html>',
      PAGE,
      store,
      options({ includeMedia: true, maxAssetBytes: 1024 }),
    );

    expect(result.remote).toEqual([
      { url: 'https://example.com/huge.mp4', reason: 'oversize', referencedBy: 'dl-4' },
    ]);
  });

  // why: real media URLs are frequently extensionless (`/stream?id=…`, a signed CDN path). The
  // content-type witness is the only thing that classifies those, and without it `--include-media`
  // OFF would still copy every streaming payload the render happened to buffer.
  it('classifies an extensionless URL as media from its content type alone', () => {
    const store = storeWith([
      { url: 'https://cdn.example.com/stream', contentType: 'video/mp4', body: Buffer.alloc(32) },
    ]);
    const result = localizeDocument(
      '<html><body><video data-dl-id="dl-5" src="https://cdn.example.com/stream"></video></body></html>',
      PAGE,
      store,
      options(),
    );

    expect(result.remote).toEqual([
      { url: 'https://cdn.example.com/stream', reason: 'media-skipped', referencedBy: 'dl-5' },
    ]);
    expect(result.assets).toHaveLength(0);
  });

  // why: a query string must not defeat extension sniffing (`promo.mp4?v=2` is still an mp4), and
  // conversely `.mp4` appearing only in the QUERY must not make a real image look like media. This
  // pins that classification reads the URL's path component, not the raw href.
  it('sniffs the extension from the URL path, ignoring the query string', () => {
    const store = storeWith([
      { url: 'https://example.com/logo.png?fallback=clip.mp4', contentType: 'image/png', body: Buffer.alloc(16) },
    ]);
    const result = localizeDocument(
      '<html><body><img data-dl-id="dl-6" src="logo.png?fallback=clip.mp4">' +
        '<video data-dl-id="dl-7" src="promo.mp4?v=2"></video></body></html>',
      PAGE,
      store,
      options(),
    );

    expect(result.remote).toEqual([
      { url: 'https://example.com/promo.mp4?v=2', reason: 'media-skipped', referencedBy: 'dl-7' },
    ]);
    expect(result.assets).toHaveLength(1);
    expect(result.stats.images).toBe(1);
  });
});

describe('localizeDocument — default policy', () => {
  // why: `runClone` is not the only caller of this pure function (tests, future commands), so the
  // bare 3-argument form must already obey the spec's defaults — 25 MB, media excluded. A default of
  // `Infinity`/`includeMedia: true` would make every non-CLI caller silently violate spec 02 §6.
  it('applies the spec defaults (25 MB, media excluded) when no options are passed', () => {
    expect(DEFAULT_MAX_ASSET_MB).toBe(25);
    expect(BYTES_PER_MB).toBe(1024 * 1024);

    const store = storeWith([
      { url: 'https://example.com/ok.png', contentType: 'image/png', body: Buffer.alloc(BYTES_PER_MB) },
      { url: 'https://example.com/promo.mp4', contentType: 'video/mp4', body: Buffer.alloc(64) },
    ]);
    const result = localizeDocument(
      '<html><body><img data-dl-id="dl-1" src="ok.png"><video data-dl-id="dl-2" src="promo.mp4"></video></body></html>',
      PAGE,
      store,
    );

    // A 1 MB image is well under the 25 MB default: localized.
    expect(result.assets.map((a) => a.assetPath)).toEqual(['assets/example-com/ok.png']);
    // Media is excluded by default.
    expect(result.remote).toEqual([
      { url: 'https://example.com/promo.mp4', reason: 'media-skipped', referencedBy: 'dl-2' },
    ]);
  });

  // why: `remote[]` is deduplicated by URL and FIRST reason wins. A page that references the same
  // skipped video from two elements must produce one entry, not two — `manifest.remote[]` is a set
  // of resources, and a duplicate would double-count it in REPORT.md's "Left remote" list.
  it('deduplicates a repeated remote reference to a single entry', () => {
    const result = localizeDocument(
      '<html><body><video data-dl-id="dl-1" src="promo.mp4"></video>' +
        '<video data-dl-id="dl-2" src="promo.mp4"></video></body></html>',
      PAGE,
      new ResourceStore(),
      options(),
    );

    expect(result.remote).toEqual([
      { url: 'https://example.com/promo.mp4', reason: 'media-skipped', referencedBy: 'dl-1' },
    ]);
  });
});
