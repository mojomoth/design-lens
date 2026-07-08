import { describe, it, expect } from 'vitest';

import { buildReport, fontFilesFrom, type ReportInput } from '../../src/output/report.js';
import type { ManifestResource } from '../../src/output/manifest.js';

const INPUT: ReportInput = {
  title: 'Example Site',
  source: {
    url: 'https://example.com/',
    capturedAt: '2026-07-08T00:00:00.000Z',
    viewport: { width: 1440, height: 900 },
    robotsDisallowed: false,
  },
  capture: {
    images: { count: 3, bytes: 4096 },
    fonts: { count: 1, bytes: 2048 },
    css: { count: 2, bytes: 1024 },
    other: { count: 0, bytes: 0 },
    consentBlocking: 'none',
    fontFiles: [{ localPath: 'clone/assets/example-com/fonts/brand.woff2', host: 'example.com' }],
  },
  remote: [],
  fidelity: { canvasConverted: 0, shadowRootsSerialized: 0, crossOriginIframes: 0 },
  verify: 'PASS — all invariants hold.',
};

// why: gate AC-08 greps REPORT.md for the exact string 'License & usage notice'; the whole report
// is worthless to the gate if that heading is renamed, reworded, or dropped. This is the single
// assertion the plan's AC names, so it must stay green literally.
describe('buildReport — license heading', () => {
  it('contains the verbatim "## License & usage notice" heading', () => {
    expect(buildReport(INPUT)).toContain('## License & usage notice');
  });

  // why: the spec marks the notice PARAGRAPH verbatim, not just the heading; readers rely on the
  // exact wording ("Do not deploy or redistribute", "check font licenses"). A paraphrase would
  // silently weaken the legal notice the product promises.
  it('reproduces the full notice paragraph verbatim', () => {
    const md = buildReport(INPUT);
    expect(md).toContain('This clone is for private design study and derivation.');
    expect(md).toContain('Do not deploy or redistribute this clone.');
    expect(md).toContain('check font licenses (font files and their source hosts are listed above).');
  });
});

// why: the spec fixes SIX `##` headings in a specific order; consumers and the gate anchor on them.
// If a heading were removed or reordered the report would violate the on-disk contract even while
// still containing the license line.
describe('buildReport — six exact headings in order', () => {
  it('emits the six headings in the spec order', () => {
    const headings = buildReport(INPUT)
      .split('\n')
      .filter((l) => l.startsWith('## '));
    expect(headings).toEqual([
      '## Source',
      '## Capture results',
      '## Left remote',
      '## Fidelity notes',
      '## Verify',
      '## License & usage notice',
    ]);
  });

  // why: the H1 title carries the captured page title; a reader identifies which clone a report
  // belongs to by it. If it stopped interpolating we'd get identical anonymous reports.
  it('titles the report with the page title', () => {
    expect(buildReport(INPUT).startsWith('# Clone Report: Example Site\n')).toBe(true);
  });
});

// why: "Capture results" hint mandates a per-class count/bytes table; downstream humans read font
// and image weight from it. If the table stopped reflecting input, the ethics/weight story is lost.
describe('buildReport — capture table content', () => {
  it('renders each resource class as a table row with its count and bytes', () => {
    const md = buildReport(INPUT);
    expect(md).toContain('| Images | 3 | 4096 |');
    expect(md).toContain('| Fonts | 1 | 2048 |');
    expect(md).toContain('| CSS | 2 | 1024 |');
    expect(md).toContain('Consent/banner blocking: none');
  });
});

// why (T27, spec 10 §Layer 1): font provenance MUST be visible for commercial-font licence checks —
// the notice paragraph literally promises "font files and their source hosts are listed above". The
// `| Fonts | 1 | 2048 |` row alone does not name a single file or host, so before this section the
// notice pointed at nothing. If these tests are removed the report can silently go back to lying.
describe('buildReport — localized font files with origin hosts', () => {
  it('lists each localized font file with the host its bytes came from, under Capture results', () => {
    const md = buildReport(INPUT);
    expect(md).toContain('- clone/assets/example-com/fonts/brand.woff2 — from example.com');
    // "listed above" is only true if the list precedes the notice that claims it.
    expect(md.indexOf('brand.woff2')).toBeLessThan(md.indexOf('## License & usage notice'));
    // And the list belongs to `## Capture results`, not to a later section.
    expect(md.indexOf('## Capture results')).toBeLessThan(md.indexOf('brand.woff2'));
    expect(md.indexOf('brand.woff2')).toBeLessThan(md.indexOf('## Left remote'));
  });

  it('says so explicitly when a capture localized no webfonts', () => {
    const md = buildReport({ ...INPUT, capture: { ...INPUT.capture, fontFiles: [] } });
    expect(md).toContain('Localized font files: none');
  });

  it('lists every font file, not just the first', () => {
    const md = buildReport({
      ...INPUT,
      capture: {
        ...INPUT.capture,
        fontFiles: [
          { localPath: 'clone/assets/example-com/a.woff2', host: 'example.com' },
          { localPath: 'clone/assets/fonts-gstatic-com/b.woff2', host: 'fonts.gstatic.com' },
        ],
      },
    });
    expect(md).toContain('- clone/assets/example-com/a.woff2 — from example.com');
    expect(md).toContain('- clone/assets/fonts-gstatic-com/b.woff2 — from fonts.gstatic.com');
  });
});

/** Build a manifest resource; only the fields `fontFilesFrom` reads need to be meaningful. */
function resource(localPath: string, originalUrl: string, contentType: string): ManifestResource {
  return { localPath, originalUrl, contentType, bytes: 0, sha256: '', via: 'network' };
}

// why (T27): this is the ONLY place a font's origin host is recovered from its `originalUrl`. It must
// select exactly the fonts (a font served as `application/octet-stream` is still a font), keep the
// port that distinguishes two hosts, and never drop a resource it cannot attribute — an unattributable
// font is precisely what a licence check needs to see. Without these, the report's font list would
// quietly omit CDN fonts served with a wrong content type: the licence-risk case that matters most.
describe('fontFilesFrom', () => {
  it('selects fonts by content type or extension, and ignores non-fonts', () => {
    expect(
      fontFilesFrom([
        resource('clone/assets/example-com/f.woff2', 'https://example.com/f.woff2', 'font/woff2'),
        resource('clone/assets/example-com/s.css', 'https://example.com/s.css', 'text/css'),
        resource('clone/assets/example-com/i.png', 'https://example.com/i.png', 'image/png'),
        // Served with a wrong/generic content type: the `.otf` extension still makes it a font.
        resource('clone/assets/cdn-example-com/x.otf', 'https://cdn.example.com/x.otf', 'application/octet-stream'),
      ]),
    ).toEqual([
      { localPath: 'clone/assets/example-com/f.woff2', host: 'example.com' },
      { localPath: 'clone/assets/cdn-example-com/x.otf', host: 'cdn.example.com' },
    ]);
  });

  it('keeps the port in the host, so two origins on one hostname stay distinguishable', () => {
    expect(
      fontFilesFrom([resource('clone/assets/127-0-0-1-4631/a.woff2', 'http://127.0.0.1:4631/a.woff2', 'font/woff2')]),
    ).toEqual([{ localPath: 'clone/assets/127-0-0-1-4631/a.woff2', host: '127.0.0.1:4631' }]);
  });

  it('lists an unparseable originalUrl as an unknown host rather than dropping the font', () => {
    expect(fontFilesFrom([resource('clone/assets/x/a.woff2', 'not a url', 'font/woff2')])).toEqual([
      { localPath: 'clone/assets/x/a.woff2', host: 'unknown host' },
    ]);
  });

  it('returns an empty list when nothing was localized', () => {
    expect(fontFilesFrom([])).toEqual([]);
  });
});

// why: "Left remote" must enumerate each remote reference with its reason so a user knows exactly
// what still points at the live web; an empty list must say so rather than render a blank section.
describe('buildReport — left-remote list', () => {
  it('states none when nothing was left remote', () => {
    expect(buildReport(INPUT)).toContain('None — every referenced resource was localised.');
  });

  it('lists each remote reference with its reason and referencedBy', () => {
    const md = buildReport({
      ...INPUT,
      remote: [{ url: 'https://cdn.example.com/f.woff2', reason: 'fetch-failed', referencedBy: 'style.css' }],
    });
    expect(md).toContain('- https://cdn.example.com/f.woff2 — fetch-failed (referenced by style.css)');
  });
});

// why: the "Fidelity notes" hint enumerates specific caveats (canvas count, shadow roots,
// cross-origin iframes, closed-shadow-DOM warning, JS removed). These set correct user expectations
// about what the inert clone can and cannot reproduce; dropping them hides known limitations.
describe('buildReport — fidelity notes', () => {
  it('reports the fidelity counters and the fixed caveats', () => {
    const md = buildReport({
      ...INPUT,
      fidelity: { canvasConverted: 2, shadowRootsSerialized: 1, crossOriginIframes: 3 },
    });
    expect(md).toContain('Canvas elements converted to images: 2');
    expect(md).toContain('Open shadow roots serialized: 1');
    expect(md).toContain('Cross-origin iframes left live: 3');
    expect(md).toContain('Closed shadow DOM is undetectable and may be missing.');
    expect(md).toContain('JS interactivity was intentionally removed');
  });
});

// why: the Source section must show robots status and the final URL when a redirect occurred; a
// missing robots note or a swallowed redirect would misrepresent provenance in the ethics report.
describe('buildReport — source section', () => {
  it('notes when robots.txt disallowed the path and shows a differing final URL', () => {
    const md = buildReport({
      ...INPUT,
      source: { ...INPUT.source, finalUrl: 'https://example.com/home', robotsDisallowed: true },
    });
    expect(md).toContain('robots.txt: disallowed the captured path');
    expect(md).toContain('- Final URL: https://example.com/home');
  });

  it('omits the final-URL line when it matches the source URL', () => {
    expect(buildReport(INPUT)).not.toContain('Final URL:');
  });
});
