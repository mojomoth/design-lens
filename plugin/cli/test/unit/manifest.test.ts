import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  buildManifest,
  manifestJson,
  resourceEntry,
  MANIFEST_VERSION,
  type ManifestSource,
  type ManifestStats,
} from '../../src/output/manifest.js';
import { VERSION } from '../../src/version.js';

const SOURCE: ManifestSource = {
  url: 'https://example.com/',
  finalUrl: 'https://example.com/',
  title: 'Example',
  capturedAt: '2026-07-08T00:00:00.000Z',
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (test)',
  robotsDisallowed: false,
};

const STATS: ManifestStats = {
  elementsStamped: 30,
  styleRules: 12,
  fonts: 1,
  images: 3,
  cssFiles: 2,
  warnings: 0,
};

// why: gate AC-07 joins each `resources[].localPath` to the PROJECT dir and asserts the file
// exists — so paths must be rooted at `clone/assets/`, not the `assets/…` form urlmap emits into
// the HTML. resourceEntry owns that `clone/` prefix; if it regressed, every localPath would resolve
// one level too shallow and A7 would report every asset missing.
describe('resourceEntry — clone/assets-rooted localPath', () => {
  it('prefixes clone/ onto a urlmap assets/ path', () => {
    const entry = resourceEntry(new Uint8Array([1, 2, 3]), {
      assetPath: 'assets/example.com/img/logo.svg',
      originalUrl: 'https://example.com/img/logo.svg',
      contentType: 'image/svg+xml',
      via: 'network',
    });
    expect(entry.localPath).toBe('clone/assets/example.com/img/logo.svg');
    expect(entry.localPath.startsWith('clone/assets/')).toBe(true);
  });

  // why: a caller that hands in an already-rooted or otherwise malformed path is a bug that would
  // silently break gate AC-07; the constructor must reject it loudly rather than emit a bad path.
  it('throws when the assetPath is not rooted at assets/', () => {
    expect(() =>
      resourceEntry(new Uint8Array(), {
        assetPath: 'clone/assets/x.png',
        originalUrl: 'https://example.com/x.png',
        contentType: 'image/png',
        via: 'network',
      }),
    ).toThrow(/must start with "assets\/"/);
  });
});

// why: the manifest is a provenance record — its bytes/sha256 must describe the file actually
// stored on disk, so hashing happens HERE from the passed bytes rather than trusting a caller
// digest. If this drifted, `verify` and any integrity check downstream would compare against a lie.
describe('resourceEntry — integrity fields', () => {
  it('records byte length and lowercase-hex sha256 of the stored bytes', () => {
    const body = new TextEncoder().encode('hello world');
    const entry = resourceEntry(body, {
      assetPath: 'assets/example.com/a.txt',
      originalUrl: 'https://example.com/a.txt',
      contentType: 'text/plain',
      via: 'css-fetch',
    });
    expect(entry.bytes).toBe(body.byteLength);
    expect(entry.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(entry.via).toBe('css-fetch');
  });
});

// why: version, tool.name, and tool.version are LOCKED — the provenance comment, `--version`, and
// this field all read the single source of truth. If any were caller-overridable they could drift
// apart, which spec 00 §Product identity and AC-10 forbid.
describe('buildManifest — locked identity', () => {
  it('locks version, tool.name, and tool.version to the product constants', () => {
    const m = buildManifest({
      playwrightVersion: '1.61.1',
      source: SOURCE,
      resources: [],
      stats: STATS,
    });
    expect(m.version).toBe(MANIFEST_VERSION);
    expect(m.tool.name).toBe('design-lens');
    expect(m.tool.version).toBe(VERSION);
    expect(m.tool.playwright).toBe('1.61.1');
  });

  // why: `remote` is optional at the call site but MUST always be an array in the document so
  // consumers (REPORT.md builder, verify) can iterate without a null guard.
  it('defaults remote to an empty array when omitted', () => {
    const m = buildManifest({ playwrightVersion: '1.61.1', source: SOURCE, resources: [], stats: STATS });
    expect(m.remote).toEqual([]);
  });

  // why: the assembled document must carry the exact schema shape the sealed gate parses; a
  // dropped or renamed top-level key would make A7 unparseable/meaningless.
  it('assembles the full schema shape with source, resources, and stats', () => {
    const entry = resourceEntry(new Uint8Array([9]), {
      assetPath: 'assets/example.com/s.css',
      originalUrl: 'https://example.com/s.css',
      contentType: 'text/css',
      via: 'network',
    });
    const m = buildManifest({
      playwrightVersion: '1.61.1',
      source: SOURCE,
      resources: [entry],
      remote: [{ url: 'https://cdn.example.com/x.png', reason: 'fetch-failed', referencedBy: 'dl-5' }],
      stats: STATS,
    });
    expect(Object.keys(m)).toEqual(['version', 'tool', 'source', 'resources', 'remote', 'stats']);
    expect(m.source).toEqual(SOURCE);
    expect(m.resources).toEqual([entry]);
    expect(m.remote[0].reason).toBe('fetch-failed');
    expect(m.stats).toEqual(STATS);
  });

  // why: buildManifest is the last line of defence for the clone/assets/ invariant — a resource
  // constructed by hand (bypassing resourceEntry) with a bad path must still be rejected, or a bad
  // path could reach disk and break A7.
  it('throws when a resource localPath is not under clone/assets/', () => {
    expect(() =>
      buildManifest({
        playwrightVersion: '1.61.1',
        source: SOURCE,
        resources: [
          {
            localPath: 'assets/example.com/x.png',
            originalUrl: 'https://example.com/x.png',
            contentType: 'image/png',
            bytes: 0,
            sha256: '',
            via: 'network',
          },
        ],
        stats: STATS,
      }),
    ).toThrow(/under "clone\/assets\/"/);
  });
});

// why: the writer commits these bytes; the e2e reads them back with JSON.parse. 2-space indent and
// a trailing newline keep the committed dist diff clean and match the repo's text-file convention —
// a change here would churn `git diff` on every regenerated clone.
describe('manifestJson — serialization', () => {
  it('emits 2-space-indented JSON that round-trips and ends in a newline', () => {
    const m = buildManifest({ playwrightVersion: '1.61.1', source: SOURCE, resources: [], stats: STATS });
    const text = manifestJson(m);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "version": 1');
    expect(JSON.parse(text)).toEqual(m);
  });
});

// why: `substituted` is optional so manifests of media-free captures (the sealed fixture) keep
// their exact key set, while substituted media is recorded whenever it exists.
describe('buildManifest — substituted media', () => {
  // why: see the describe comment; this pins both the absent and the present shape.
  it('omits substituted when empty and records it otherwise', () => {
    expect(Object.keys(buildManifest({ playwrightVersion: '1.61.1', source: SOURCE, resources: [], substituted: [], stats: STATS })))
      .toEqual(['version', 'tool', 'source', 'resources', 'remote', 'stats']);
    const substituted = [{ kind: 'video-frame' as const, referencedBy: 'dl-3', urls: ['https://example.com/a.webm'], stillFrom: 'captured-frame' as const, currentTime: 1.5, lost: ['motion' as const] }];
    const m = buildManifest({ playwrightVersion: '1.61.1', source: SOURCE, resources: [], substituted, stats: STATS });
    expect(m.substituted).toEqual(substituted);
    expect(Object.keys(m)).toEqual(['version', 'tool', 'source', 'resources', 'remote', 'substituted', 'stats']);
  });
});
