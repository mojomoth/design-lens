import { PNG } from 'pngjs';

export interface DeviceRect { x: number; y: number; width: number; height: number }
export interface LightnessHistogramOptions {
  buckets?: number;
  /** Fraction of the width (and height) removed from each side before counting. */
  insetRatio?: number;
  alphaCutoff?: number;
  /** When given, every pixel is alpha-composited onto this opaque color before classification. */
  background?: readonly [number, number, number];
}
export interface LightnessHistogram { buckets: number[]; transparent: number; total: number; modalShare: number }

const LINEAR = new Float64Array(256);
for (let index = 0; index < 256; index += 1) {
  const channel = index / 255;
  LINEAR[index] = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance Y of an sRGB color (0–1). */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAR[r & 255] + 0.7152 * LINEAR[g & 255] + 0.0722 * LINEAR[b & 255];
}

export function lightnessFromLuminance(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27;
}

/** Inverse of the CIE L* curve, so per-pixel classification compares Y without a cube root. */
export function luminanceForLightness(lightnessValue: number): number {
  return lightnessValue > 8 ? ((lightnessValue + 16) / 116) ** 3 : (lightnessValue * 27) / 24389;
}

/** CIE L* (0–100) of an sRGB color. */
export function lightness(r: number, g: number, b: number): number {
  return lightnessFromLuminance(luminance(r, g, b));
}

export const DARK_Y = luminanceForLightness(30);
export const LIGHT_Y = luminanceForLightness(70);
export function isDarkY(y: number, threshold = DARK_Y): boolean { return y < threshold; }
export function isLightY(y: number, threshold = LIGHT_Y): boolean { return y > threshold; }

export function decodePng(bytes: Buffer | Uint8Array): PNG {
  return PNG.sync.read(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** Device-pixel crop clamped to the image; null when nothing of the rect lies inside it. */
export function cropDevice(png: PNG, rect: DeviceRect): PNG | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(png.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(png.height, Math.ceil(rect.y + rect.height));
  if (right <= x || bottom <= y) return null;
  const crop = new PNG({ width: right - x, height: bottom - y });
  PNG.bitblt(png, crop, x, y, right - x, bottom - y, 0, 0);
  return crop;
}

/**
 * L* histogram over equal-width buckets of 0–100. Without a background, pixels below the alpha
 * cutoff land in `transparent`, which competes for the modal share like any bucket.
 */
export function lightnessHistogram(png: PNG, options: LightnessHistogramOptions = {}): LightnessHistogram {
  const bucketCount = options.buckets ?? 16;
  const insetRatio = options.insetRatio ?? 0;
  const alphaCutoff = options.alphaCutoff ?? 128;
  if (!Number.isInteger(bucketCount) || bucketCount < 1) throw new RangeError('buckets must be a positive integer');
  if (!(insetRatio >= 0 && insetRatio < 0.5)) throw new RangeError('insetRatio must be in [0, 0.5)');
  const background = options.background;
  const buckets = new Array<number>(bucketCount).fill(0);
  let transparent = 0;
  let total = 0;
  const insetX = Math.floor(png.width * insetRatio);
  const insetY = Math.floor(png.height * insetRatio);
  const { data, width } = png;
  for (let y = insetY; y < png.height - insetY; y += 1) {
    for (let x = insetX; x < width - insetX; x += 1) {
      const offset = (y * width + x) * 4;
      let r = data[offset];
      let g = data[offset + 1];
      let b = data[offset + 2];
      const alpha = data[offset + 3];
      total += 1;
      if (background) {
        const weight = alpha / 255;
        r = Math.round(r * weight + background[0] * (1 - weight));
        g = Math.round(g * weight + background[1] * (1 - weight));
        b = Math.round(b * weight + background[2] * (1 - weight));
      } else if (alpha < alphaCutoff) { transparent += 1; continue; }
      const bucket = Math.min(bucketCount - 1, Math.max(0, Math.floor((lightness(r, g, b) / 100) * bucketCount)));
      buckets[bucket] += 1;
    }
  }
  const modal = Math.max(transparent, ...buckets);
  return { buckets, transparent, total, modalShare: total > 0 ? modal / total : 0 };
}

function weights(source: number, target: number): Array<Array<[number, number]>> {
  const scale = source / target;
  const result: Array<Array<[number, number]>> = [];
  for (let index = 0; index < target; index += 1) {
    const start = index * scale;
    const end = Math.min(source, start + scale);
    const taps: Array<[number, number]> = [];
    for (let pixel = Math.floor(start); pixel < Math.ceil(end); pixel += 1) {
      const weight = Math.min(end, pixel + 1) - Math.max(start, pixel);
      if (weight > 0) taps.push([pixel, weight / (end - start)]);
    }
    result.push(taps);
  }
  return result;
}

/**
 * Area-average reduction by `factor` (≥ 1, fractional allowed): output is
 * `max(1, round(width / factor))` × `max(1, round(height / factor))`. Color is averaged
 * alpha-premultiplied so transparent pixels do not darken edges.
 */
export function downscale(png: PNG, factor: number): PNG {
  if (!Number.isFinite(factor) || factor < 1) throw new RangeError('downscale factor must be a finite number ≥ 1');
  const width = Math.max(1, Math.round(png.width / factor));
  const height = Math.max(1, Math.round(png.height / factor));
  const columns = weights(png.width, width);
  const rows = weights(png.height, height);
  const horizontal = new Float32Array(width * png.height * 4);
  const source = png.data;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (const [column, weight] of columns[x]) {
        const offset = (y * png.width + column) * 4;
        const alpha = source[offset + 3] * weight;
        r += source[offset] * alpha; g += source[offset + 1] * alpha; b += source[offset + 2] * alpha; a += alpha;
      }
      const target = (y * width + x) * 4;
      horizontal[target] = r; horizontal[target + 1] = g; horizontal[target + 2] = b; horizontal[target + 3] = a;
    }
  }
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (const [row, weight] of rows[y]) {
        const offset = (row * width + x) * 4;
        r += horizontal[offset] * weight; g += horizontal[offset + 1] * weight; b += horizontal[offset + 2] * weight; a += horizontal[offset + 3] * weight;
      }
      const target = (y * width + x) * 4;
      output.data[target] = a > 0 ? Math.round(r / a) : 0;
      output.data[target + 1] = a > 0 ? Math.round(g / a) : 0;
      output.data[target + 2] = a > 0 ? Math.round(b / a) : 0;
      output.data[target + 3] = Math.round(a);
    }
  }
  return output;
}
