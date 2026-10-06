import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import {
  cropDevice, DARK_Y, decodePng, downscale, isDarkY, isLightY, LIGHT_Y, lightness, lightnessHistogram, luminance,
} from '../../src/analyze/pixels.js';

function solid(width: number, height: number, rgba: [number, number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.set(rgba, offset);
  return png;
}

describe('pixel helpers', () => {
  // why: tone and solid-icon thresholds are CIE L* values; a wrong curve shifts every dark/light share.
  it('computes CIE L* and the precomputed dark/light luminance thresholds', () => {
    expect(lightness(0, 0, 0)).toBe(0);
    expect(lightness(255, 255, 255)).toBeCloseTo(100, 6);
    expect(lightness(119, 119, 119)).toBeCloseTo(50, 0);
    expect(DARK_Y).toBeCloseTo(0.0624, 4);
    expect(LIGHT_Y).toBeCloseTo(0.4075, 4);
    expect(isDarkY(luminance(60, 60, 60))).toBe(true);
    expect(isDarkY(luminance(80, 80, 80))).toBe(false);
    expect(isLightY(luminance(200, 200, 200))).toBe(true);
  });

  // why: element crops come from device-pixel rects that may extend past the screenshot.
  it('crops device rects with clamping and returns null outside the image', () => {
    const png = solid(10, 10, [0, 0, 0, 255]);
    const crop = cropDevice(png, { x: 8, y: -2, width: 5, height: 4 })!;
    expect([crop.width, crop.height]).toEqual([2, 2]);
    expect(cropDevice(png, { x: 20, y: 0, width: 5, height: 5 })).toBeNull();
    expect(cropDevice(png, { x: 0, y: 0, width: 0, height: 5 })).toBeNull();
  });

  // why: a glyph on a transparent PNG must not look like one solid colour unless the caller composites it.
  it('counts transparent pixels separately unless a background is given', () => {
    const png = solid(10, 10, [0, 0, 0, 0]);
    for (let x = 0; x < 3; x += 1) png.data.set([0, 0, 0, 255], x * 4);
    const plain = lightnessHistogram(png);
    expect(plain.transparent).toBe(97);
    expect(plain.total).toBe(100);
    expect(plain.modalShare).toBeCloseTo(0.97, 6);
    const composited = lightnessHistogram(png, { background: [255, 255, 255] });
    expect(composited.transparent).toBe(0);
    expect(composited.buckets[15]).toBe(97);
    expect(composited.buckets[0]).toBe(3);
    expect(lightnessHistogram(png, { insetRatio: 0.2 }).total).toBe(36);
  });

  // why: compare sheets downscale full-page PNGs in Node; averaging must preserve area colour and alpha.
  it('downscales by area average and round-trips PNG bytes', () => {
    const png = solid(4, 4, [255, 255, 255, 255]);
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) if ((x + y) % 2 === 0) png.data.set([0, 0, 0, 255], (y * 4 + x) * 4);
    const small = downscale(png, 2);
    expect([small.width, small.height]).toEqual([2, 2]);
    expect([...small.data.subarray(0, 4)]).toEqual([128, 128, 128, 255]);
    const half = downscale(solid(3, 3, [10, 20, 30, 255]), 1.5);
    expect([half.width, half.height, ...half.data.subarray(0, 4)]).toEqual([2, 2, 10, 20, 30, 255]);
    expect(() => downscale(png, 0.5)).toThrow(RangeError);
    const decoded = decodePng(new Uint8Array(PNG.sync.write(png)));
    expect([decoded.width, decoded.height]).toEqual([4, 4]);
  });
});
