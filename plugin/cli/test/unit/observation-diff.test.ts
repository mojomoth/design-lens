import { describe, expect, it } from 'vitest';

import { diffObservations, summarizeObservationDiff, type ElementObservation, type ObservationDocument } from '../../src/analyze/observations.js';

const pseudo = { content: 'none', styles: {} };
function element(dlId: string, overrides: Partial<ElementObservation> = {}): ElementObservation {
  return {
    dlId, tag: 'p', text: `Text ${dlId}`, semantic: 'paragraph', domPath: `body>p:nth-of-type(${dlId.slice(3)})`, rootPath: [],
    parentDlId: null, childDlIds: [], rect: { x: 0, y: 0, width: 100, height: 20 }, styles: { color: 'rgb(0, 0, 0)' },
    visible: true, currentSrc: null, pseudo: { before: pseudo, after: pseudo }, ...overrides,
  };
}
function document(elements: ElementObservation[], overrides: Partial<ObservationDocument> = {}): ObservationDocument {
  return {
    viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, width: 800, height: 600, rootFontSize: '16px',
    fonts: { status: 'ready', failedFamilies: [] }, elements, complete: true, warnings: [], ...overrides,
  };
}

// why: a state-consistency warning used to say only "changed"; capture attempts and users need to
// know WHICH measured facts moved (an image finishing, a ticking text, a font) to fix the page.
describe('diffObservations', () => {
  // why: an unchanged state must stop the capture attempts at the first one.
  it('reports equality for identical observations', () => {
    const diff = diffObservations(document([element('dl-1')]), document([element('dl-1')]));
    expect(diff).toEqual({ equal: true, document: [], changed: [], added: [], removed: [] });
    expect(summarizeObservationDiff(diff)).toBe('no measured difference');
  });

  // why: the warning summary is built from exactly these lists.
  it('names changed fields per element, added and removed IDs, and document keys', () => {
    const before = document([
      element('dl-1'), element('dl-2', { tag: 'img', image: { complete: false, naturalWidth: 0, naturalHeight: 0 }, currentSrc: null }),
      element('dl-3'),
    ]);
    const after = document([
      element('dl-1', { text: 'Text changed' }),
      element('dl-2', { tag: 'img', image: { complete: true, naturalWidth: 10, naturalHeight: 10 }, currentSrc: 'https://example.com/a.png' }),
      element('dl-4'),
    ], { fontFaces: [{ family: 'Brand', status: 'loaded', style: 'normal', weight: '400', stretch: 'normal' }] });
    const diff = diffObservations(before, after);
    expect(diff.equal).toBe(false);
    expect(diff.changed).toEqual([{ dlId: 'dl-1', fields: ['text'] }, { dlId: 'dl-2', fields: ['image', 'currentSrc'] }]);
    expect(diff.added).toEqual(['dl-4']);
    expect(diff.removed).toEqual(['dl-3']);
    expect(diff.document).toEqual(['fontFaces']);
    expect(summarizeObservationDiff(diff)).toBe('2 elements: text dl-1; image dl-2; currentSrc dl-2; added dl-4; removed dl-3; document: fontFaces');
  });

  // why: a reorder alone is a state change, and a long list must not flood the warning.
  it('detects reordering and bounds long ID lists', () => {
    const ids = Array.from({ length: 9 }, (_, index) => `dl-${index + 1}`);
    const reordered = diffObservations(document(ids.map((id) => element(id))), document([...ids].reverse().map((id) => element(id))));
    expect(reordered.document).toEqual(['element order']);
    const moved = diffObservations(document(ids.map((id) => element(id))), document(ids.map((id) => element(id, { rect: { x: 1, y: 0, width: 100, height: 20 } }))));
    expect(summarizeObservationDiff(moved, 3)).toBe('9 elements: rect dl-1, dl-2, dl-3, …');
  });
});
