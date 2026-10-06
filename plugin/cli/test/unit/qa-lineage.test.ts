import { describe, expect, it } from 'vitest';

import { cloneIdsAt, htmlDlIds, lcsLength, retainedRatio, selectCaptureId, skeletonSimilarity } from '../../src/analyze/qa-lineage.js';

const COMPOSITION = {
  schemaVersion: 1 as const,
  boundaryPolicy: 'nearest-width-then-height' as const,
  variants: [
    { captureId: 'desktop', viewport: { width: 1440, height: 900 }, media: '', hostId: 'dl-1', rootId: 'dl-2', bodyId: 'dl-3' },
    { captureId: 'tablet', viewport: { width: 768, height: 1024 }, media: '', hostId: 'dl-4', rootId: 'dl-5', bodyId: 'dl-6' },
    { captureId: 'mobile', viewport: { width: 390, height: 844 }, media: '', hostId: 'dl-7', rootId: 'dl-8', bodyId: 'dl-9' },
  ],
  elements: [
    { dlId: 'dl-10', captureId: 'desktop', sourceId: 'dl-1' },
    { dlId: 'dl-11', captureId: 'desktop', sourceId: 'dl-2' },
    { dlId: 'dl-12', captureId: 'mobile', sourceId: 'dl-1' },
  ],
  warnings: [],
};

describe('lineage', () => {
  // why: composed clones keep variants in declarative shadow templates; ids there must count as build markup.
  it('collects data-dl-id values including template contents', () => {
    const html = '<div data-dl-id="dl-1"><template shadowrootmode="open"><p data-dl-id="dl-2">x</p></template></div><template><i data-dl-id="dl-3"></i></template><b data-dl-id="dl-1"></b>';
    expect([...htmlDlIds(html)].sort()).toEqual(['dl-1', 'dl-2', 'dl-3']);
  });

  // why: the variant a viewport uses decides which clone ids it can retain; ties go to the larger capture.
  it('selects the nearest captured width with ties to the larger one', () => {
    expect(selectCaptureId(COMPOSITION.variants, 1280)).toBe('desktop');
    expect(selectCaptureId(COMPOSITION.variants, 579)).toBe('tablet');
    expect(selectCaptureId([COMPOSITION.variants[1], { ...COMPOSITION.variants[2], viewport: { width: 568, height: 900 } }], 668)).toBe('tablet');
    expect([...cloneIdsAt(COMPOSITION, new Set(['dl-10', 'dl-11', 'dl-12']), 1440)]).toEqual(['dl-10', 'dl-11']);
    expect([...cloneIdsAt(undefined, new Set(['dl-1', 'dl-2']), 390)]).toEqual(['dl-1', 'dl-2']);
  });

  // why: retained ratio is the measured (not self-described) share of clone markup a clone-base build kept.
  it('computes the retained ratio to four decimals', () => {
    expect(retainedRatio(new Set(['dl-1', 'dl-3']), new Set(['dl-1', 'dl-2', 'dl-3']))).toEqual({ retained: 2, ratio: 0.6667 });
    expect(retainedRatio(new Set(['dl-1']), new Set())).toEqual({ retained: 0, ratio: 0 });
  });

  // why: skeleton similarity compares section column sequences in order; LCS tolerates inserted sections.
  it('compares section skeletons by LCS over column counts', () => {
    expect(lcsLength([1, 3, 2, 1], [1, 2, 1])).toBe(3);
    const tokens = (columns: number[]): Array<{ columns: number; height: number }> => columns.map((count) => ({ columns: count, height: 400 }));
    expect(skeletonSimilarity(tokens([1, 3, 2, 1]), tokens([1, 2, 1]))).toBe(0.75);
    expect(skeletonSimilarity([], [])).toBe(1);
    expect(skeletonSimilarity(tokens([1]), [])).toBe(0);
  });
});
