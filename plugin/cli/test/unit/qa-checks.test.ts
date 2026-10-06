import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import type { BuildContract, SignatureCheck } from '../../src/analyze/build-contract.js';
import { lightnessHistogram } from '../../src/analyze/pixels.js';
import {
  assetKind, clippedFindings, evaluateSignatureChecks, fontDrift, fontReadiness, glyphFallbackFindings, imageFindings, linkFindings, overlapFindings,
  solidIcon, sourceAssetSeverity, statusOf, toneDrift,
} from '../../src/analyze/qa-checks.js';
import type { LinkFact } from '../../src/analyze/qa-probes.js';
import { toneProfile } from '../../src/analyze/tone.js';

const RECT = { x: 0, y: 0, width: 10, height: 10 };

function link(overrides: Partial<LinkFact>): LinkFact {
  return {
    index: 0, selector: 'a', label: 'Label', href: 'https://example.org/', resolved: 'https://example.org/', inPage: false, targetId: null,
    targetExists: false, targetInShadow: false, selfAnchor: false, visible: true, rect: RECT, ...overrides,
  };
}
function inPage(id: string, label: string, overrides: Partial<LinkFact> = {}): LinkFact {
  return link({ href: `#${id}`, resolved: `http://127.0.0.1/#${id}`, inPage: true, targetId: id, targetExists: true, label, ...overrides });
}

const CONTRACT: BuildContract = {
  mode: 'derive', fonts: ['Inter', 'Roboto Mono'], displayFonts: ['Inter'], darkShareMax: 0.1, fullBleedDarkMax: 0.02,
  stylesheets: 'rewritten', checks: [], sources: {},
};

describe('stand-in-link', () => {
  // why: card grids link many cards to one real listing page (15 noise warns on good builds); only labels that all
  // share a bare site root look like stand-ins.
  it('warns on five labels sharing a site root but not a real destination page', () => {
    const labels = ['One', 'Two', 'Three', 'Four', 'Five'];
    const listing = linkFindings(labels.map((label) => link({ label, resolved: 'https://example.org/list.do?menuNo=2' })), '1440x900');
    expect(listing.findings).toEqual([]);
    const root = linkFindings(labels.map((label) => link({ label, resolved: 'https://example.org/' })), '1440x900');
    expect(root.findings.map((finding) => [finding.severity, finding.detail.split(':')[0]])).toEqual([
      ['warn', '5 distinct labels share one site root https'],
    ]);
  });

  // why: every observed stand-in pointed at an existing id; without the self-anchor, glyph and shared-target
  // rules qa passes builds whose footer links all jump to #footer.
  it('fails dead hrefs, missing targets, self-anchors, glyph links and five labels on one target', () => {
    const { findings, summary } = linkFindings([
      link({ href: '#', resolved: 'http://127.0.0.1/#', inPage: true, targetId: '' }),
      link({ href: '', resolved: 'http://127.0.0.1/' }),
      link({ href: 'javascript:void(0)', resolved: 'javascript:void(0)' }),
      link({ href: null, resolved: null }),
      link({ href: null, resolved: null, visible: false, rect: null }),
      inPage('nowhere', 'Ghost', { targetExists: false }),
      inPage('top', 'Back to top', { targetExists: false }),
      inPage('main', 'Skip', { selfAnchor: true }),
      inPage('ebook', 'E-BOOK ↗', { selfAnchor: true }),
      ...['Privacy', 'Terms', 'Email', 'Directions', 'Sitemap'].map((label) => inPage('footer', label, { selfAnchor: true })),
      ...['One', 'Two', 'Three'].map((label) => inPage('program', label)),
    ], '390x844');
    const fails = findings.filter((finding) => finding.severity === 'fail');
    expect(fails.map((finding) => finding.detail.split(' (href')[0])).toEqual([
      'href="#" goes nowhere', 'href is empty', 'javascript: href is not a destination', 'visible link has no href',
      'in-page target #nowhere does not exist in the document',
      'points at #ebook, the section that contains the link; label "E-BOOK ↗" promises an external page or download but links in-page to #ebook',
      ...Array.from({ length: 5 }, () => 'points at #footer, the section that contains the link'),
      '5 distinct labels share the in-page target #footer: "privacy", "terms", "email", "directions", "sitemap"',
    ]);
    expect(findings.filter((finding) => finding.severity === 'warn').map((finding) => finding.detail)).toEqual([
      '3 distinct labels share the in-page target #program: "one", "two", "three"',
    ]);
    expect(summary).toEqual({ total: 17, inPage: 13, standIn: 11 });
  });

  // why: a hash-routed SPA links to #/about; the route is a destination, not a missing element id.
  it('treats #/route and #!/route fragments as destinations, not missing targets', () => {
    const { findings, summary } = linkFindings([
      ...['Home', 'About', 'Work', 'Contact', 'Jobs'].map((label, index) => inPage(['/', '/about', '/work', '!/contact', '!/jobs'][index], label, { targetExists: false })),
      inPage('about', 'About section', { targetExists: false }),
    ], '390x844');
    expect(findings.map((finding) => finding.detail.split(' (href')[0])).toEqual(['in-page target #about does not exist in the document']);
    expect(summary.standIn).toBe(1);
  });

  // why: a multi-viewport clone-base copy keeps each variant in a shadow root, where #id links cannot
  // scroll; the detail must say why, and a scripted link that a click proves working must pass.
  it('explains shadow-root fragment targets and accepts ones a click scrolled to', () => {
    const links = [
      inPage('stories', 'Stories', { index: 4, targetExists: false, targetInShadow: true }),
      inPage('letter', 'Letter', { index: 7, targetExists: false, targetInShadow: true }),
    ];
    const { findings } = linkFindings(links, '1440x900', new Set([7]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: 'stand-in-link', severity: 'fail' });
    expect(findings[0].detail).toContain('in-page target #stories is inside a shadow root');
  });

  // why: many labels pointing at one external URL is a softer stand-in signal than an in-page target.
  it('warns when five labels share one non-page destination', () => {
    const { findings } = linkFindings(['A', 'B', 'C', 'D', 'E'].map((label) => link({ label })), '1440x900');
    expect(findings).toEqual([expect.objectContaining({ check: 'stand-in-link', severity: 'warn', selector: null })]);
  });
});

describe('geometry checks', () => {
  // why: the masked 5px card spill must fail while a cropped display word (≥ 48px) or a big bleed stays a warning.
  it('separates accidental spill from intentional bleed', () => {
    const findings = clippedFindings([
      { selector: '.card', text: 'Card', rect: RECT, overflow: 5, width: 377, fontSize: 16 },
      { selector: '.hero-word', text: 'BUILD', rect: RECT, overflow: 20, width: 400, fontSize: 120 },
      { selector: '.bleed', text: '', rect: RECT, overflow: 120, width: 400, fontSize: 16 },
    ], '390x844');
    expect(findings.map((finding) => finding.severity)).toEqual(['fail', 'warn', 'warn']);
    expect(findings[0].detail).toContain('extends 5px (1.3%');
  });

  // why: the .quick button covered 18% of the hero CTA without touching its centre; a centre-only probe missed it.
  it('fails at 15% coverage or a covered centre and keeps the worst overlap per control', () => {
    const base = { text: '', rect: RECT, cover: '.quick', scrollY: 0 };
    const findings = overlapFindings([
      { ...base, selector: '.cta', ratio: 0.05, centre: false },
      { ...base, selector: '.cta', ratio: 0.177, centre: false },
      { ...base, selector: '.next', ratio: 0.08, centre: true },
      { ...base, selector: '.small', ratio: 0.04, centre: false },
    ], '390x844');
    expect(findings.map((finding) => [finding.selector, finding.severity])).toEqual([['.cta', 'fail'], ['.next', 'fail'], ['.small', 'warn']]);
    expect(findings[0].detail).toContain('coveredRatio 0.177');
  });

  // why: sticky headers covering 0.5-2% of a tall card at its check position produced warns on reference-faithful
  // builds; a sliver under a top-pinned bar is ordinary scrolling, while any other cover and larger shares still count.
  it('ignores a sliver covered by a bar pinned to the viewport top', () => {
    const base = { text: '', rect: RECT, cover: 'header', scrollY: 900 };
    const findings = overlapFindings([
      { ...base, selector: '.card-a', ratio: 0.021, centre: false, coverAtTop: true },
      { ...base, selector: '.card-b', ratio: 0.021, centre: false, coverAtTop: false },
      { ...base, selector: '.card-c', ratio: 0.08, centre: false, coverAtTop: true },
      { ...base, selector: '.card-d', ratio: 0.02, centre: true, coverAtTop: true },
    ], '1440x900');
    expect(findings.map((finding) => [finding.selector, finding.severity])).toEqual([['.card-b', 'warn'], ['.card-c', 'warn'], ['.card-d', 'fail']]);
  });

  // why: an undecodable image is a hole in the page; a still-loading one after the sweep is only suspicious.
  it('reports broken and pending images', () => {
    expect(imageFindings([
      { selector: 'img.a', rect: RECT, complete: true, naturalWidth: 0, src: 'missing.png' },
      { selector: 'img.b', rect: RECT, complete: false, naturalWidth: 0, src: 'slow.png' },
      { selector: 'img.c', rect: RECT, complete: true, naturalWidth: 10, src: 'ok.png' },
    ], '390x844').map((finding) => `${finding.check}:${finding.severity}`)).toEqual(['broken-image:fail', 'pending-image:warn']);
  });

  // why: the white-square icon renders flat while its source has detail; either condition alone is normal.
  it('flags a flat render of a detailed source only', () => {
    const flat = new PNG({ width: 20, height: 20 });
    flat.data.fill(255);
    const checker = new PNG({ width: 20, height: 20 });
    for (let index = 0; index < 400; index += 1) checker.data.set((index + Math.floor(index / 20)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], index * 4);
    const flatHistogram = lightnessHistogram(flat, { insetRatio: 0.15 });
    const detailHistogram = lightnessHistogram(checker, { insetRatio: 0.15, background: [255, 255, 255] });
    expect(solidIcon(flatHistogram, detailHistogram)).toBe(true);
    expect(solidIcon(flatHistogram, flatHistogram)).toBe(false);
    expect(solidIcon(detailHistogram, detailHistogram)).toBe(false);
  });
});

describe('fonts, tone and the Build contract', () => {
  // why: a cross-origin font that failed at the network layer is environment noise (unverified), not a build bug.
  it('skips cross-origin network font failures and fails everything else', () => {
    const network = fontReadiness({ status: 'timeout', failedFamilies: [], networkFailures: [{ url: 'https://fonts.example/a.woff2', crossOrigin: true }], httpFailures: [] }, '390x844');
    expect(network.skipped).toMatchObject({ check: 'font-readiness', affectsStatus: true });
    const http = fontReadiness({ status: 'ready', failedFamilies: ['Brand'], networkFailures: [], httpFailures: ['404 http://127.0.0.1/a.woff2'] }, '390x844');
    expect(http.finding).toMatchObject({ check: 'font-readiness', severity: 'fail' });
    expect(fontReadiness({ status: 'ready', failedFamilies: [], networkFailures: [], httpFailures: [] }, '390x844')).toEqual({});
  });

  // why: the experiment swapped the display face for an unlisted one; fonts are judged by the family actually
  // resolved from the computed stack, and headings must use a display font.
  it('reports undeclared families, off-contract headings and unused contract fonts', () => {
    const findings = fontDrift(
      [
        { family: 'Black Han Sans', generic: false, elements: 41, samples: ['h1', 'h2.title'] },
        { family: 'inter', generic: false, elements: 10, samples: ['p'] },
        { family: 'sans-serif', generic: true, elements: 3, samples: ['small'] },
      ],
      [{ index: 1, selector: 'h1', tag: 'h1', family: 'Black Han Sans', generic: false, loaded: true }, { index: 2, selector: 'h2', tag: 'h2', family: 'Inter', generic: false, loaded: true }],
      CONTRACT, '1440x900',
    );
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'fail', selector: 'h1', detail: expect.stringMatching(/^"Black Han Sans" resolved from the computed stack on 41 text element/) }),
      expect.objectContaining({ severity: 'fail', selector: 'h1', detail: expect.stringMatching(/^1 h1\/h2 heading\(s\) resolved from the computed stack to "Black Han Sans"/) }),
      expect.objectContaining({ severity: 'warn', selector: null, detail: expect.stringMatching(/^Build contract font "Roboto Mono" is not resolved/) }),
    ]);
  });

  // why: the experiment's Korean target rendered Hangul headings in a system fallback while the stack resolved to the
  // Latin-only display face; only the fonts that painted the glyphs reveal that loss of the display typeface.
  it('fails display headings whose glyphs render in a platform fallback', () => {
    const findings = glyphFallbackFindings([
      { selector: 'h1', family: 'Gelasio', fonts: [{ familyName: 'AppleMyungjo', isCustomFont: false, glyphCount: 7 }, { familyName: 'Gelasio', isCustomFont: true, glyphCount: 1 }] },
      { selector: 'h2.mixed', family: 'Gelasio', fonts: [{ familyName: 'Gelasio', isCustomFont: true, glyphCount: 12 }, { familyName: 'AppleMyungjo', isCustomFont: false, glyphCount: 3 }] },
      { selector: 'h2.emoji', family: 'Gelasio', fonts: [{ familyName: 'Gelasio', isCustomFont: true, glyphCount: 3 }, { familyName: 'Apple Color Emoji', isCustomFont: false, glyphCount: 1 }] },
      { selector: 'h2.latin', family: 'Gelasio', fonts: [{ familyName: 'Gelasio', isCustomFont: true, glyphCount: 20 }] },
    ], '1440x900');
    expect(findings).toEqual([expect.objectContaining({ check: 'font-drift', severity: 'fail', selector: 'h1' })]);
    expect(findings[0].detail).toMatch(/^10 of 23 glyphs in 2 h1\/h2 heading\(s\) resolved to display font "Gelasio" render in platform fallback font\(s\) AppleMyungjo/);
    expect(glyphFallbackFindings([{ selector: 'h1', family: 'Gelasio', fonts: [{ familyName: 'Gelasio', isCustomFont: true, glyphCount: 20 }, { familyName: 'AppleMyungjo', isCustomFont: false, glyphCount: 2 }] }], '390x844')).toEqual([]);
  });

  // why: tone-drift compares the build's pixel tone (same algorithm as tone.json) with the contract maxima.
  it('fails a full-bleed dark band above the contract maximum', () => {
    const page = new PNG({ width: 100, height: 400 });
    for (let y = 0; y < 400; y += 1) for (let x = 0; x < 100; x += 1) page.data.set(y < 200 ? [10, 10, 10, 255] : [250, 250, 250, 255], (y * 100 + x) * 4);
    const tone = toneProfile(page, 1);
    expect(tone).toMatchObject({ darkShare: 0.5, fullBleedDarkShare: 0.5, darkBandCount: 1 });
    expect(toneDrift(tone, CONTRACT, '390x844').map((finding) => finding.detail.split(' exceeds')[0])).toEqual(['darkShare 0.5', 'fullBleedDarkShare 0.5 (1 full-bleed dark band(s))']);
    expect(toneDrift(tone, { ...CONTRACT, darkShareMax: 0.6, fullBleedDarkMax: 0.6 }, '390x844')).toEqual([]);
  });

  // why: a signature check passes when it holds at any viewport with a visible match; no match anywhere fails, and
  // the per-viewport observations are what validate-design and the agent read.
  it('evaluates signature checks across viewports', () => {
    const checks: SignatureCheck[] = [
      { rank: 1, selector: 'h1', property: 'font-family', op: '~', value: 'Inter', line: 1 },
      { rank: 2, selector: '.corner', property: 'count', op: '>=', value: '4', line: 2 },
      { rank: 3, selector: '.chamfer', property: 'clip-path', op: '!=', value: 'none', line: 3 },
    ];
    const results = evaluateSignatureChecks(checks, [
      { viewport: '1440x900', results: [{ count: 1, value: '"Inter", sans-serif' }, { count: 4, value: null }, { count: 0, value: null }] },
      { viewport: '390x844', results: [{ count: 1, value: 'Arial' }, { count: 2, value: null }, { count: 0, value: null, error: 'bad selector' }] },
    ]);
    expect(results.map((result) => [result.rank, result.pass, result.observed])).toEqual([
      [1, true, { '1440x900': '"Inter", sans-serif', '390x844': 'Arial' }],
      [2, true, { '1440x900': 4, '390x844': 2 }],
      [3, false, { '1440x900': null, '390x844': null }],
    ]);
  });

  // why: status precedence is what makes qa usable as a gate: any fail wins, then status-affecting skips.
  it('derives the run status', () => {
    const fail = { check: 'x', severity: 'fail' as const, viewport: 'a', selector: null, detail: '' };
    const warn = { ...fail, severity: 'warn' as const };
    expect(statusOf([warn, fail], [])).toBe('fail');
    expect(statusOf([warn], [{ check: 'unsourced-number', reason: '', affectsStatus: true }])).toBe('unverified');
    expect(statusOf([warn], [{ check: 'solid-icon', reason: '', affectsStatus: false }])).toBe('pass');
  });
});

describe('source-asset severity', () => {
  // why: reference images/fonts/media copied into a build are never acceptable; a retained stylesheet is only a
  // warning in clone-base; shared CDN files are warnings (fonts only when they are contract families).
  it('grades byte-identical reference assets', () => {
    expect(assetKind('image/png', 'a.png')).toBe('image');
    expect(assetKind('', 'fonts/a.woff2')).toBe('font');
    expect(assetKind('video/mp4', 'a')).toBe('media');
    expect(assetKind('text/css; charset=utf-8', 'a')).toBe('stylesheet');
    expect(assetKind('text/javascript', 'a.js')).toBeNull();
    expect(sourceAssetSeverity('image', 'https://ref.example/hero.jpg', 'clone-base', [])).toMatchObject({ severity: 'fail' });
    expect(sourceAssetSeverity('stylesheet', 'https://ref.example/site.css', 'derive', [])).toMatchObject({ severity: 'fail' });
    expect(sourceAssetSeverity('stylesheet', 'https://ref.example/site.css', 'clone-base', [])).toEqual({
      severity: 'warn', note: 'reference stylesheet retained; rewrite it or confirm reuse rights before deploying',
    });
    expect(sourceAssetSeverity('font', 'https://fonts.gstatic.com/s/robotomono/v1/a.woff2', 'derive', ['Roboto Mono'])).toMatchObject({ severity: 'warn' });
    expect(sourceAssetSeverity('font', 'https://fonts.gstatic.com/s/brandface/v1/a.woff2', 'derive', ['Roboto Mono'])).toMatchObject({ severity: 'fail' });
    expect(sourceAssetSeverity('stylesheet', 'https://cdn.jsdelivr.net/npm/x/x.css', 'derive', [])).toMatchObject({ severity: 'warn' });
  });
});
