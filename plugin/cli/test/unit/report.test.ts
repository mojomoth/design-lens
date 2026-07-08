import { describe, it, expect } from 'vitest';

import { buildReport, type ReportInput } from '../../src/output/report.js';

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
