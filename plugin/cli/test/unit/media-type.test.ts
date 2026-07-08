/**
 * Unit tests for the shared resource classifiers (`src/localize/media-type.ts`).
 *
 * WHY this file exists: these four predicates are consulted from four modules that must never
 * disagree (localize's rewrite/skip decision, fetch-missing's descend-into-CSS decision, clone's
 * beautify decision and REPORT rows). The module's whole reason for existing is that these once
 * lived as near-identical private copies. A drift here does not crash anything — it produces a
 * stylesheet stored as opaque bytes, a font counted as an image, or a 400 MB video copied into a
 * design clone. Each case below is a witness the classifiers must agree on.
 *
 * `isBulkMediaResource` carries the heaviest load: it is the ONLY predicate consulted before the
 * ResourceStore is queried, so it runs against an empty content type most of the time and the
 * extension is its only witness. If it is removed, `--include-media` becomes a no-op flag.
 */

import { describe, expect, it } from 'vitest';

import {
  isBulkMediaResource,
  isCssResource,
  isFontResource,
  isImageResource,
} from '../../src/localize/media-type.js';

describe('isBulkMediaResource', () => {
  // why: spec 02 §6 names exactly these five extensions. The empty content type is the REAL calling
  // convention — the predicate runs before the store lookup, so nothing has read a header yet.
  it.each(['/promo.mp4', '/clip.webm', '/tone.mp3', '/spec.pdf', '/bundle.zip'])(
    'matches the spec-named extension %s with no content type',
    (pathname) => {
      expect(isBulkMediaResource('', pathname)).toBe(true);
    },
  );

  // why: servers routinely omit or bungle extensions on media URLs (`/stream`, `/v/abc123`), and a
  // signed CDN path has no extension at all. The content-type arm is what catches those.
  it.each([
    ['video/mp4', '/stream'],
    ['video/webm; codecs="vp9"', '/v/abc123'],
    ['audio/mpeg', '/listen'],
    ['application/pdf', '/download'],
    ['application/pdf; charset=binary', '/download'],
    ['application/zip', '/archive'],
    ['application/x-zip-compressed', '/archive'],
  ])('matches content type %s on an extensionless path', (contentType, pathname) => {
    expect(isBulkMediaResource(contentType, pathname)).toBe(true);
  });

  // why: extension matching is case-insensitive because URLs are not. `IMG_0421.MP4` off a phone
  // camera is the single most common real-world spelling.
  it('matches extensions case-insensitively', () => {
    expect(isBulkMediaResource('', '/IMG_0421.MP4')).toBe(true);
    expect(isBulkMediaResource('', '/Report.PDF')).toBe(true);
  });

  // why: the design-bearing assets are exactly what must NOT be swept up by the media skip. A false
  // positive here means the clone silently loses its stylesheet, its webfont, or its hero image —
  // and the clone still exits 0, because a skipped ref is a legitimate `remote[]` entry.
  it.each([
    ['image/png', '/hero.png'],
    ['text/css; charset=utf-8', '/style.css'],
    ['font/woff2', '/brand.woff2'],
    ['image/svg+xml', '/logo.svg'],
    ['text/html; charset=utf-8', '/index.html'],
    ['application/octet-stream', '/unknown.bin'],
    // `.mp4` must be the real extension, not merely a substring of the filename.
    ['image/png', '/promo.mp4.png'],
    // `zip` must not swallow neighbouring subtypes that merely start with it.
    ['application/zippy', '/thing'],
    // A media word in the path is not a media type.
    ['text/plain', '/video-notes.txt'],
  ])('does not match %s at %s', (contentType, pathname) => {
    expect(isBulkMediaResource(contentType, pathname)).toBe(false);
  });

  // why: the four predicates partition the resources the pipeline routes. An mp4 that also answered
  // `isImageResource` would be counted in `stats.images` and beautified as text. This pins that bulk
  // media is disjoint from the three design-bearing classes, in both witnesses.
  it('is disjoint from the css/font/image classifiers', () => {
    const cases: [string, string][] = [
      ['video/mp4', '/promo.mp4'],
      ['audio/mpeg', '/tone.mp3'],
      ['application/pdf', '/spec.pdf'],
    ];
    for (const [contentType, pathname] of cases) {
      expect(isBulkMediaResource(contentType, pathname)).toBe(true);
      expect(isCssResource(contentType, pathname)).toBe(false);
      expect(isFontResource(contentType, pathname)).toBe(false);
      expect(isImageResource(contentType, pathname)).toBe(false);
    }
  });
});

describe('isCssResource / isFontResource / isImageResource', () => {
  // why: "either witness is sufficient" is the module's documented contract — a font served as
  // `application/octet-stream` is still a font if it ends in `.woff2`, and an extensionless URL is
  // still a stylesheet if the server said `text/css`. Both halves are load-bearing in the wild, and
  // nothing else in the suite tests the header-only and extension-only halves in isolation.
  it('accepts either the content type or the extension as a sufficient witness', () => {
    expect(isCssResource('text/css; charset=utf-8', '/styles')).toBe(true);
    expect(isCssResource('application/octet-stream', '/styles.css')).toBe(true);

    expect(isFontResource('font/woff2', '/f')).toBe(true);
    expect(isFontResource('application/octet-stream', '/brand.woff2')).toBe(true);

    expect(isImageResource('image/webp', '/img')).toBe(true);
    expect(isImageResource('application/octet-stream', '/hero.avif')).toBe(true);
  });

  // why: a wrong-but-plausible header must not reclassify an asset whose extension is unambiguous.
  it('rejects resources matching neither witness', () => {
    expect(isCssResource('text/html', '/page.html')).toBe(false);
    expect(isFontResource('image/png', '/hero.png')).toBe(false);
    expect(isImageResource('text/css', '/style.css')).toBe(false);
  });
});
