import { describe, expect, it } from 'vitest';

import { disclosureLine, reconcileBodyReads } from '../../src/capture/disclosures.js';
import { capturePolicy, parseStabilizationFlags, readinessReserveMs, type CloneRunOptions } from '../../src/commands/clone.js';

const DEFAULT_FLAGS = { readinessMs: '5000', readinessRetries: '2', captureAttempts: '2' };
const RUN: CloneRunOptions = {
  out: '.', viewport: { width: 800, height: 600 }, dsf: 1, timeoutMs: 90_000, settleMs: 0, removeSelectors: [],
  noScroll: false, blockCookies: false, maxAssetBytes: 1, includeMedia: false,
};

// why: the body-read warning made real captures incomplete although the stylesheet bytes were
// stored from another response and the other failures were analytics beacons that never reach the
// inert clone. Only a design resource whose bytes are truly absent may still warn.
describe('reconcileBodyReads', () => {
  // why: each failure class has exactly one outcome; a mix-up either hides loss or blocks completion.
  it('drops stored URLs, discloses non-design types and keeps the exact warning otherwise', () => {
    const result = reconcileBodyReads([
      { url: 'https://example.com/site.css', resourceType: 'stylesheet', status: 200 },
      { url: 'https://www.google-analytics.com/g/collect', resourceType: 'ping', status: 204 },
      { url: 'https://ads.example.net/pixel', resourceType: 'xhr', status: 200 },
      { url: 'https://example.com/hero.png', resourceType: 'image', status: 200 },
      { url: 'https://example.com/hero.png', resourceType: 'image', status: 200 },
    ], (url) => url === 'https://example.com/site.css');
    expect(result.warnings).toEqual(['could not read response body: https://example.com/hero.png']);
    expect(result.disclosures.map((entry) => entry.code)).toEqual(['body-unread-reconciled', 'body-unread-nondesign']);
    expect(result.disclosures[1].detail).toContain('ping https://www.google-analytics.com/g/collect');
    expect(disclosureLine({ code: 'late-stamped', detail: 'two\n lines' })).toBe('late-stamped: two lines');
  });
});

// why: analytics beacons made one REPORT.md disclosure line 3,625 characters long; endpoints are named once
// without query strings and a long list is capped, while the count still covers every failure.
it('names each unread non-design endpoint once, without its query, and caps the list', () => {
  const failures = Array.from({ length: 15 }, (_, index) => ({ url: `https://t.example.net/e${index}?payload=${'x'.repeat(500)}`, resourceType: 'ping', status: 204 }));
  failures.push({ url: 'https://t.example.net/e0?other=1', resourceType: 'ping', status: 204 });
  const [disclosure] = reconcileBodyReads(failures, () => false).disclosures;
  expect(disclosure.detail.startsWith('16 unreadable non-design response bodies (never part of the clone): ping https://t.example.net/e0, ')).toBe(true);
  expect(disclosure.detail).not.toContain('payload');
  expect(disclosure.detail.endsWith(', and 3 more')).toBe(true);
});

// why: the stabilization flags are validated with the other clone flags, before any browser runs,
// and programmatic callers that predate them keep the documented defaults.
describe('stabilization policy', () => {
  // why: these defaults are the 0.4.0 contract (poster, eager, 5000 ms, 2 retries, 2 attempts).
  it('defaults programmatic callers and keeps includeMedia meaning include', () => {
    expect(capturePolicy(RUN)).toEqual({ media: 'poster', lazyImages: 'eager', readinessMs: 5000, readinessRetries: 2, freezeTimers: false, captureAttempts: 2 });
    expect(capturePolicy({ ...RUN, includeMedia: true }).media).toBe('include');
    expect(capturePolicy({ ...RUN, includeMedia: true, media: 'remote' }).media).toBe('remote');
  });

  // why: an alias that silently disagrees with its target flag would pick one meaning at random.
  it('parses flags, accepts the alias and rejects conflicts and out-of-range values', () => {
    expect(parseStabilizationFlags(DEFAULT_FLAGS)).toEqual({ media: 'poster', includeMedia: false, lazyImages: 'eager', readinessMs: 5000, readinessRetries: 2, freezeTimers: false, captureAttempts: 2 });
    expect(parseStabilizationFlags({ ...DEFAULT_FLAGS, includeMedia: true }).media).toBe('include');
    expect(parseStabilizationFlags({ ...DEFAULT_FLAGS, includeMedia: true, media: 'include' }).includeMedia).toBe(true);
    expect(parseStabilizationFlags({ ...DEFAULT_FLAGS, media: 'remote', lazyImages: 'native', freezeTimers: true, readinessMs: '1000', readinessRetries: '0', captureAttempts: '4' }))
      .toEqual({ media: 'remote', includeMedia: false, lazyImages: 'native', readinessMs: 1000, readinessRetries: 0, freezeTimers: true, captureAttempts: 4 });
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, includeMedia: true, media: 'poster' })).toThrow('--include-media conflicts with --media poster');
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, media: 'frames' })).toThrow('invalid --media');
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, lazyImages: 'auto' })).toThrow('invalid --lazy-images');
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, readinessMs: '999' })).toThrow('--readiness-ms');
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, readinessMs: '1.5e3' })).toThrow('--readiness-ms');
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, readinessRetries: '6' })).toThrow('--readiness-retries');
    expect(() => parseStabilizationFlags({ ...DEFAULT_FLAGS, captureAttempts: '5' })).toThrow('--capture-attempts');
  });

  // why: retries may never consume the time serialization, screenshots and refetch need.
  it('reserves the larger of 15 s and 35% of the viewport budget', () => {
    expect(readinessReserveMs(100_000, 0)).toBe(35_000);
    expect(readinessReserveMs(20_000, 0)).toBe(15_000);
    expect(readinessReserveMs(0, 10)).toBe(15_000);
  });
});
