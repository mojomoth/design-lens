import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import { activeContentIssues, compareObservations, comparePng, FIDELITY_POLICY, importantObservation, matchObservation, missingLoadedFonts, normalizeObservationUrls, validateFidelityComposition, type FidelityComposition } from '../../src/analyze/fidelity.js';
import type { ElementObservation, ObservationDocument } from '../../src/analyze/observations.js';

function png(width: number, height: number, square = 0): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  for (let y = 0; y < square; y += 1) for (let x = 0; x < square; x += 1) {
    const offset = (y * width + x) * 4;
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
  }
  return PNG.sync.write(image);
}

function element(overrides: Partial<ElementObservation> = {}): ElementObservation {
  return {
    dlId: 'dl-1', tag: 'h1', text: 'Measured heading', semantic: 'heading',
    domPath: 'body>h1:nth-of-type(1)', rootPath: [], parentDlId: null, childDlIds: [],
    rect: { x: 0, y: 0, width: 200, height: 40 },
    styles: { fontFamily: 'Arial', fontSize: '32px', fontWeight: '700', lineHeight: '40px', letterSpacing: 'normal' },
    visible: true, currentSrc: null,
    pseudo: { before: { content: 'none', styles: {} }, after: { content: 'none', styles: {} } },
    ...overrides,
  };
}

function document(elements: ElementObservation[]): ObservationDocument {
  return {
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, width: 1440, height: 900,
    rootFontSize: '16px', fonts: { status: 'ready', failedFamilies: [] }, elements, complete: true, warnings: [],
  };
}

function composition(): FidelityComposition {
  return {
    schemaVersion: 1, boundaryPolicy: 'nearest-width-then-height', warnings: [],
    variants: [
      { captureId: 'desktop', viewport: { width: 1440, height: 900 }, media: '(min-width: 900px)', hostId: 'dl-10', rootId: 'dl-11', bodyId: 'dl-12' },
      { captureId: 'mobile', viewport: { width: 390, height: 844 }, media: '(max-width: 899px)', hostId: 'dl-30', rootId: 'dl-31', bodyId: 'dl-32' },
    ],
    elements: [
      { dlId: 'dl-20', captureId: 'desktop', sourceId: 'dl-1' },
      { dlId: 'dl-40', captureId: 'mobile', sourceId: 'dl-1' },
    ],
  };
}

describe('fidelity pixel comparison', () => {
  // why: an identical renderer must pass while preserving an inspectable full-resolution diff.
  it('passes identical pixels with the fixed comparison policy', () => {
    const compared = comparePng(png(20, 20), png(20, 20));
    expect(compared.comparison).toMatchObject({ status: 'pass', mismatchRatio: 0, limit: 0.005 });
    expect(compared.diff).toBeInstanceOf(Buffer);
    expect(FIDELITY_POLICY).toEqual({ threshold: 0.1, includeAA: false, imageMismatchRatio: 0.005, regionMismatchRatio: 0.01, geometryToleranceCssPx: 1 });
  });

  // why: resizing a shorter clone to source height would hide missing content below the fold.
  it('fails page height or width mismatches without resizing', () => {
    const compared = comparePng(png(30, 90), png(30, 89));
    expect(compared.comparison.status).toBe('fail');
    expect(compared.comparison.mismatchRatio).toBeNull();
    expect(compared.diff).toBeNull();
  });

  // why: small logos can fit the page-wide error budget; regional comparisons must still reject them.
  it('detects small missing artwork with the regional threshold', () => {
    expect(comparePng(png(100, 100), png(100, 100, 5)).comparison.status).toBe('pass');
    expect(comparePng(png(5, 5), png(5, 5, 5), FIDELITY_POLICY.regionMismatchRatio).comparison.status).toBe('fail');
  });
});

describe('capture-local semantic correspondence', () => {
  // why: identical text and capture-local IDs cannot replace authoritative recorded correspondence.
  it('uses recorded capture-qualified provenance while rejecting hidden or altered mapped elements', () => {
    const source = element();
    const metadata = composition();
    const first = element({ dlId: 'dl-20', rootPath: ['dl-10'], source: { captureId: 'desktop', dlId: 'dl-1' } });
    const second = element({ dlId: 'dl-40', rootPath: ['dl-30'], source: { captureId: 'mobile', dlId: 'dl-1' } });
    expect(matchObservation(source, [source], [first, second], 'mobile', metadata).element?.dlId).toBe('dl-40');
    expect(matchObservation(source, [source], [first, { ...second, text: 'Edited' }], 'mobile', metadata).reason).toContain('semantic');
    expect(matchObservation(source, [source], [first, { ...second, visible: false }], 'mobile', metadata).element).toBeNull();
    expect(matchObservation(source, [source], [first], 'mobile', metadata).reason).toContain('missing');
    expect(matchObservation(source, [source], [second, { ...second }], 'mobile', metadata).reason).toContain('ambiguous');
  });

  // why: removing every DOM provenance attribute must not enable fallback to another sampled tree.
  it('retains capture-qualified identity when DOM source attributes are stripped', () => {
    const source = element();
    const first = element({ dlId: 'dl-20', rootPath: ['dl-10'] });
    const second = element({ dlId: 'dl-40', rootPath: ['dl-30'] });
    expect(matchObservation(source, [source], [first, second], 'mobile', composition()).element?.dlId).toBe('dl-40');
    expect(matchObservation(source, [source], [first], 'mobile', composition()).element).toBeNull();
    expect(matchObservation(source, [source], [second], 'desktop', composition()).element).toBeNull();
  });

  // why: copying attributes, moving nodes, or forging a generated role must not bless an impostor.
  it('requires the recorded canonical ID, shadow host, and consistent optional DOM provenance', () => {
    const source = element();
    const candidate = element({ dlId: 'dl-40', rootPath: ['dl-30'], source: { captureId: 'mobile', dlId: 'dl-1' } });
    for (const changed of [
      { ...candidate, dlId: 'dl-41' }, { ...candidate, rootPath: ['dl-10'] }, { ...candidate, rootPath: [] },
      { ...candidate, generated: 'root' }, { ...candidate, source: { captureId: 'desktop', dlId: 'dl-1' } },
      { ...candidate, source: { captureId: 'mobile', dlId: 'dl-2' } },
    ]) expect(matchObservation(source, [source], [changed], 'mobile', composition()).element).toBeNull();
    const missing = composition();
    missing.elements = missing.elements.filter((entry) => entry.captureId !== 'mobile');
    expect(matchObservation(source, [source], [candidate], 'mobile', missing).reason).toContain('mapping is missing');
  });

  // why: source shadow hosts also change IDs, and matching only the outer variant hides reparenting.
  it('validates the complete translated path for nested source shadows', () => {
    const metadata = composition();
    metadata.elements.push({ dlId: 'dl-42', captureId: 'mobile', sourceId: 'dl-2' });
    const source = element({ rootPath: ['dl-2'] });
    const candidate = element({ dlId: 'dl-40', rootPath: ['dl-30', 'dl-42'] });
    expect(matchObservation(source, [source], [candidate], 'mobile', metadata).element).toBe(candidate);
    expect(matchObservation(source, [source], [{ ...candidate, rootPath: ['dl-30'] }], 'mobile', metadata).element).toBeNull();
    metadata.elements.pop();
    expect(matchObservation(source, [source], [candidate], 'mobile', metadata).element).toBeNull();
  });

  // why: generated proxy exemptions come from the manifest; source-provided attributes grant none.
  it('never maps recorded proxies and ignores untrusted exemptions in legacy semantic matching', () => {
    const source = element();
    const proxy = element({ dlId: 'dl-31', generated: 'root', rootPath: ['dl-30'] });
    expect(matchObservation(source, [source], [proxy], 'mobile', composition()).element).toBeNull();
    expect(compareObservations(document([source]), document([proxy]), 'mobile', composition())[0].status).toBe('fail');
    const legacy = element({ dlId: 'dl-80', generated: 'root', source: { captureId: 'spoof', dlId: 'dl-99' } });
    expect(matchObservation(source, [source], [legacy], 'desktop').element).toBe(legacy);
  });

  // why: a tiny pseudo-element logo can fit the page/header budgets but needs its own regional check.
  it('measures generated pseudo-element regions without adding every layout container', () => {
    const flex = element({ tag: 'div', semantic: 'flex', text: '' });
    expect(importantObservation(flex)).toBe(false);
    flex.pseudo.before.content = '""';
    expect(importantObservation(flex)).toBe(true);
    const grid = element({ tag: 'div', semantic: 'grid', text: '' });
    grid.pseudo.after.content = '""';
    expect(importantObservation(grid)).toBe(true);
    const graphic = element({ tag: 'aside', semantic: 'complementary', text: '' });
    graphic.pseudo.before.content = '""';
    expect(importantObservation(graphic)).toBe(true);
    const missing = structuredClone(graphic);
    missing.pseudo.before.content = 'none';
    expect(compareObservations(document([graphic]), document([missing]))[0].issues).toContain('before pseudo-element is missing or its content differs');
  });

  // why: localizing content:url(...) preserves the generated image but necessarily changes its URL.
  it('compares generated image content structure without requiring original network URLs', () => {
    const source = element();
    source.pseudo.before.content = 'url("http://127.0.0.1:4001/mark.svg") / "Brand"';
    const clone = structuredClone(source);
    clone.pseudo.before.content = 'url("http://127.0.0.1:5002/assets/mark.svg") / "Brand"';
    expect(compareObservations(document([source]), document([clone]))[0].status).toBe('pass');
    clone.pseudo.before.content = 'url("/assets/mark.svg") / "Wrong brand"';
    expect(compareObservations(document([source]), document([clone]))[0].status).toBe('fail');
  });

  // why: saved body and pseudo-element observations must not depend on a dead ephemeral serving port.
  it('normalizes URLs in body and pseudo-element styles as well as ordinary elements', () => {
    const origin = 'http://127.0.0.1:54321';
    const observed = document([element({ currentSrc: `${origin}/image.png` })]);
    observed.body = element({ tag: 'body', styles: { backgroundImage: `url("${origin}/body.png")` } });
    observed.body.pseudo.before.styles.backgroundImage = `url("${origin}/before.png")`;
    observed.elements[0].pseudo.after.styles.backgroundImage = `url("${origin}/after.png")`;
    const normalized = normalizeObservationUrls(observed, origin);
    expect(normalized.body?.styles.backgroundImage).toBe('url("/body.png")');
    expect(normalized.body?.pseudo.before.styles.backgroundImage).toBe('url("/before.png")');
    expect(normalized.elements[0].pseudo.after.styles.backgroundImage).toBe('url("/after.png")');
    expect(normalized.elements[0].currentSrc).toBe('/image.png');
  });

  // why: source numbering changes between viewports, so equality of dl-N is not identity.
  it('matches a heading whose stamped ID changed and rejects a different heading with the same ID', () => {
    const source = element();
    const clone = element({ dlId: 'dl-82' });
    expect(matchObservation(source, [source], [clone]).element?.dlId).toBe('dl-82');
    expect(matchObservation(source, [source], [element({ text: 'Different mobile heading' })]).element).toBeNull();
  });

  // why: repeated button text must not select the first convenient node and conceal absent content.
  it('rejects ambiguous candidates without unique structural evidence', () => {
    const source = element({ domPath: '' });
    const candidates = [element({ dlId: 'dl-8', domPath: '' }), element({ dlId: 'dl-9', domPath: '' })];
    expect(matchObservation(source, [source], candidates).reason).toContain('ambiguous');
  });

  // why: responsive source structure can genuinely differ; missing mobile nodes are a failure.
  it('fails a missing mobile-only visual element', () => {
    const source = element({ tag: 'nav', text: 'Mobile menu', semantic: 'navigation' });
    expect(compareObservations(document([source]), document([]))[0].status).toBe('fail');
  });

  // why: geometry defects can use very few changed pixels on sparse layouts.
  it('enforces the one CSS pixel tolerance independently of image score', () => {
    const source = element();
    const shifted = element({ rect: { ...source.rect, x: 2 } });
    const allowed = element({ rect: { ...source.rect, x: 1 } });
    expect(compareObservations(document([source]), document([shifted]))[0]).toMatchObject({ status: 'fail', maxGeometryDelta: 2 });
    expect(compareObservations(document([source]), document([allowed]))[0].status).toBe('pass');
  });

  // why: fonts with similar glyph metrics can otherwise pass the image error allowance.
  it('fails a changed font even when the geometry is unchanged', () => {
    const source = element();
    const changed = element({ styles: { ...source.styles, fontFamily: 'serif' } });
    expect(compareObservations(document([source]), document([changed]))[0].issues).toContain('fontFamily differs from the source observation');
  });

  // why: a blank or tiny broken image is a hard failure independently of its pixel contribution.
  it('fails visible images with zero natural dimensions', () => {
    const source = element({ tag: 'img', text: '', semantic: 'image' });
    const broken = element({ ...source, image: { complete: true, naturalWidth: 0, naturalHeight: 0 } });
    expect(compareObservations(document([source]), document([broken]))[0].issues).toContain('visible image failed to load');
  });

  // why: removing a face declaration keeps computed font-family unchanged while falling back.
  it('requires every loaded source font face to exist in the clone', () => {
    const source = { ...document([]), fontFaces: [{ family: 'Brand', style: 'normal', weight: '400', stretch: 'normal', status: 'loaded' }] };
    expect(missingLoadedFonts(source, document([]))).toHaveLength(1);
    expect(missingLoadedFonts(source, source)).toEqual([]);
    expect(missingLoadedFonts(source, { ...source, fontFaces: [{ ...source.fontFaces[0], status: 'unloaded' }] })).toHaveLength(1);
  });
});

describe('inert clone audit', () => {
  // why: visual agreement cannot excuse retained source scripts, event handlers, or navigation hooks.
  it('rejects scripts, handlers, obfuscated executable URLs, and refresh navigation', () => {
    const issues = activeContentIssues('<script>0</script><a onclick="0" href="java&#9;script:0">x</a><meta http-equiv="refresh" content="0">');
    expect(issues).toHaveLength(4);
  });

  // why: escaped iframe markup and declarative shadow templates sit outside ordinary DOM queries.
  it('finds executable hooks in srcdoc and shadow templates', () => {
    const issues = activeContentIssues('<iframe srcdoc="&lt;body onload=&quot;0&quot;&gt;"></iframe><template shadowrootmode="open"><script>0</script></template>');
    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.includes('srcdoc'))).toBe(true);
  });

  // why: SVG and data documents can retain active content even after the outer HTML is sanitized.
  it('audits encoded SVG and base64 embedded HTML while accepting ordinary image payloads', () => {
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="0"/>');
    const html = Buffer.from('<script>0</script>').toString('base64');
    expect(activeContentIssues(`<object data="data:image/svg+xml,${svg}"></object><iframe src="data:text/html;base64,${html}"></iframe>`)).toHaveLength(2);
    expect(activeContentIssues('<img src="data:image/png;base64,AAAA">')).toEqual([]);
  });
});


describe('responsive composition metadata validation', () => {
  // why: warnings alone are not proof that source IDs belong to a recorded sampled document.
  it('requires complete variants and a globally unique, capture-qualified element map', () => {
    expect(validateFidelityComposition(composition())).toEqual(composition());
    const wrongVariants = composition();
    wrongVariants.variants.push({ ...wrongVariants.variants[0] });
    const wrongCanonical = composition();
    wrongCanonical.elements[0].dlId = wrongCanonical.variants[0].hostId;
    const wrongSource = composition();
    wrongSource.elements.push({ ...wrongSource.elements[0], dlId: 'dl-90' });
    const unknownCapture = composition();
    unknownCapture.elements[0].captureId = 'absent';
    for (const invalid of [null, {}, { schemaVersion: 1, warnings: [] }, wrongVariants, wrongCanonical, wrongSource, unknownCapture]) {
      expect(() => validateFidelityComposition(invalid)).toThrow('invalid responsive composition metadata');
    }
  });

  // why: an invented or omitted capture must not select convenient evidence through valid-looking IDs.
  it('checks each variant viewport and capture identity against the evidence', () => {
    const captures = composition().variants.map((entry) => ({ id: entry.captureId, viewport: entry.viewport }));
    expect(validateFidelityComposition(composition(), captures)).toEqual(composition());
    expect(() => validateFidelityComposition(composition(), captures.slice(0, 1))).toThrow();
    captures[0].viewport.width -= 1;
    expect(() => validateFidelityComposition(composition(), captures)).toThrow();
  });
});
