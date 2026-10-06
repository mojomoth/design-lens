import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { parseToneDocument, TONE_THRESHOLDS, toneProfile } from '../../src/analyze/tone.js';
import { toneReport } from '../fixtures/design-validation-fixture.js';

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [10, 10, 10];

function page(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) png.data.set([...paint(x, y), 255], (y * width + x) * 4);
  }
  return png;
}

describe('tone profile', () => {
  // why: an all-light reference page must report no dark usage at all.
  it('reports a light page as darkUsage none', () => {
    const profile = toneProfile(page(200, 400, () => WHITE), 1);
    expect(profile).toMatchObject({ width: 200, height: 400, lightShare: 1, darkShare: 0, fullBleedDarkShare: 0, darkBandCount: 0, darkUsage: 'none' });
  });

  // why: the motivating builds added edge-to-edge dark sections; they must be measured as full-bleed bands.
  it('measures an edge-to-edge dark section as one full-bleed band', () => {
    const profile = toneProfile(page(200, 1000, (_, y) => (y >= 200 && y < 400 ? BLACK : WHITE)), 1);
    expect(profile.darkBandCount).toBe(1);
    expect(profile.darkBands).toEqual([{ top: 200, bottom: 400 }]);
    expect(profile.fullBleedDarkShare).toBe(0.2);
    expect(profile.tileDarkShare).toBe(0);
    expect(profile.darkUsage).toBe('bands');
  });

  // why: light headline rows inside a dark hero must not split the band (edge strips stay dark).
  it('keeps a dark hero with light text in the middle as a single band', () => {
    const profile = toneProfile(page(200, 1000, (x, y) => {
      if (y < 300) return y >= 100 && y < 140 && x >= 60 && x < 140 ? WHITE : BLACK;
      return WHITE;
    }), 1);
    expect(profile.darkBands).toEqual([{ top: 0, bottom: 300 }]);
  });

  // why: dark cards inside a light frame are tiles, not full-bleed bands (the reference used dark only this way).
  it('classifies framed dark cards as tiles', () => {
    const profile = toneProfile(page(400, 1000, (x, y) => (y >= 100 && y < 400 && x >= 16 && x < 384 ? BLACK : WHITE)), 1);
    expect(profile.fullBleedDarkShare).toBe(0);
    expect(profile.darkBandCount).toBe(0);
    expect(profile.tileDarkShare).toBeGreaterThan(0.25);
    expect(profile.darkUsage).toBe('tiles');
  });

  // why: short dark strips (rules, nav bars under 60 CSS px) are not bands, and gaps ≤ 24 CSS px merge.
  it('applies the minimum height and gap merge in CSS px under device scale factors', () => {
    const strip = toneProfile(page(200, 1000, (_, y) => (y >= 100 && y < 140 ? BLACK : WHITE)), 1);
    expect(strip.darkBandCount).toBe(0);
    const merged = toneProfile(page(200, 1000, (_, y) => ((y >= 100 && y < 140) || (y >= 160 && y < 200) ? BLACK : WHITE)), 1);
    expect(merged.darkBands).toEqual([{ top: 100, bottom: 200 }]);
    const retina = toneProfile(page(200, 2000, (_, y) => (y >= 400 && y < 800 ? BLACK : WHITE)), 2);
    expect(retina).toMatchObject({ width: 100, height: 1000, darkBands: [{ top: 200, bottom: 400 }], fullBleedDarkShare: 0.2 });
  });

  // why: validate-design trusts tone.json only after structural validation at the I/O boundary.
  it('validates tone.json structure', () => {
    const document = toneReport();
    expect(parseToneDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(() => parseToneDocument({ ...document, schemaVersion: 2 })).toThrow('schemaVersion');
    const broken = JSON.parse(JSON.stringify(document));
    broken.captures[0].profile.darkShare = 2;
    expect(() => parseToneDocument(broken)).toThrow('darkShare');
    expect(Object.keys(TONE_THRESHOLDS)).toHaveLength(8);
  });
});
