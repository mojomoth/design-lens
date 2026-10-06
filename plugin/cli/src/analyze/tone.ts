import fs from 'node:fs/promises';
import path from 'node:path';

import type { PNG } from 'pngjs';

import { evidenceHash, readEvidence, resolveEvidencePath, sha256, type EvidenceDocument } from '../capture/evidence.js';
import { decodePng, luminance, luminanceForLightness } from './pixels.js';

export const TONE_THRESHOLDS = {
  darkLightness: 30,
  lightLightness: 70,
  bandEdgeRatio: 0.02,
  bandEdgeShare: 0.9,
  bandRowShare: 0.5,
  bandMinCssPx: 60,
  bandGapCssPx: 24,
  sampleStepDevicePx: 2,
} as const;
export type ToneThresholds = { [Key in keyof typeof TONE_THRESHOLDS]: number };

export type DarkUsage = 'none' | 'tiles' | 'bands' | 'mixed';
export const DARK_USAGES: readonly DarkUsage[] = ['none', 'tiles', 'bands', 'mixed'];
export interface ToneProfile {
  /** CSS px. */
  width: number;
  height: number;
  lightShare: number;
  midShare: number;
  darkShare: number;
  /** Sampled rows inside full-bleed dark bands / all sampled rows. */
  fullBleedDarkShare: number;
  /** Dark samples outside bands / all samples. */
  tileDarkShare: number;
  darkBandCount: number;
  /** CSS px, integers. */
  darkBands: Array<{ top: number; bottom: number }>;
  darkUsage: DarkUsage;
}
export const TONE_SHARE_METRICS = ['lightShare', 'midShare', 'darkShare', 'fullBleedDarkShare', 'tileDarkShare'] as const;
export const TONE_METRICS = [...TONE_SHARE_METRICS, 'darkBandCount', 'darkUsage'] as const;
export type ToneMetric = typeof TONE_METRICS[number];

export interface ToneCaptureReport {
  captureId: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  complete: boolean;
  /** Device px of the decoded image; 0 when it could not be decoded. */
  image: { path: string; sha256: string; width: number; height: number };
  profile: ToneProfile | null;
  reason?: string;
}
export interface ToneDocument {
  schemaVersion: 1;
  evidenceHash: string;
  thresholds: ToneThresholds;
  captures: ToneCaptureReport[];
}

function round4(value: number): number { return Math.round(value * 10_000) / 10_000; }

/**
 * Pixel-derived tone of a full-page screenshot. A sampled row is a full-bleed band row only when
 * both edge strips are dark and at least `bandRowShare` of the row is dark, so dark cards inside
 * a light frame stay tiles while light text inside a dark hero does not split the band.
 */
export function toneProfile(png: PNG, deviceScaleFactor: number, thresholds: ToneThresholds = TONE_THRESHOLDS): ToneProfile {
  if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0) throw new RangeError('deviceScaleFactor must be positive');
  const step = Math.max(1, Math.round(thresholds.sampleStepDevicePx));
  const darkY = luminanceForLightness(thresholds.darkLightness);
  const lightY = luminanceForLightness(thresholds.lightLightness);
  const { width, height, data } = png;
  const edge = Math.max(2, Math.round(width * thresholds.bandEdgeRatio));
  const rowDark: number[] = [];
  const rowY: number[] = [];
  const rowBand: boolean[] = [];
  let dark = 0;
  let light = 0;
  let total = 0;
  for (let y = 0; y < height; y += step) {
    let rowDarkCount = 0;
    let count = 0;
    let leftDark = 0; let leftCount = 0;
    let rightDark = 0; let rightCount = 0;
    const base = y * width * 4;
    for (let x = 0; x < width; x += step) {
      const offset = base + x * 4;
      const value = luminance(data[offset], data[offset + 1], data[offset + 2]);
      const isDark = value < darkY;
      count += 1;
      if (isDark) rowDarkCount += 1;
      else if (value > lightY) light += 1;
      if (x < edge) { leftCount += 1; if (isDark) leftDark += 1; }
      if (x >= width - edge) { rightCount += 1; if (isDark) rightDark += 1; }
    }
    dark += rowDarkCount;
    total += count;
    rowY.push(y);
    rowDark.push(rowDarkCount);
    rowBand.push(leftCount > 0 && rightCount > 0 && leftDark / leftCount >= thresholds.bandEdgeShare
      && rightDark / rightCount >= thresholds.bandEdgeShare && rowDarkCount / count >= thresholds.bandRowShare);
  }
  const runs: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < rowY.length; index += 1) {
    if (!rowBand[index]) continue;
    const y = rowY[index];
    const current = runs[runs.length - 1];
    if (current && (y - current.end) / deviceScaleFactor <= thresholds.bandGapCssPx) current.end = Math.min(height, y + step);
    else runs.push({ start: y, end: Math.min(height, y + step) });
  }
  const bands = runs.filter((run) => (run.end - run.start) / deviceScaleFactor >= thresholds.bandMinCssPx);
  let bandRows = 0;
  let bandDark = 0;
  let cursor = 0;
  for (let index = 0; index < rowY.length; index += 1) {
    while (cursor < bands.length && bands[cursor].end <= rowY[index]) cursor += 1;
    if (cursor < bands.length && rowY[index] >= bands[cursor].start) { bandRows += 1; bandDark += rowDark[index]; }
  }
  const share = (part: number, whole: number): number => (whole > 0 ? round4(part / whole) : 0);
  const darkShare = share(dark, total);
  const fullBleedDarkShare = share(bandRows, rowY.length);
  const tileDarkShare = share(dark - bandDark, total);
  const darkUsage: DarkUsage = darkShare < 0.005 ? 'none'
    : fullBleedDarkShare >= 0.02 && tileDarkShare < 0.01 ? 'bands'
      : fullBleedDarkShare < 0.02 ? 'tiles' : 'mixed';
  return {
    width: Math.round(width / deviceScaleFactor),
    height: Math.round(height / deviceScaleFactor),
    lightShare: share(light, total),
    midShare: share(total - dark - light, total),
    darkShare,
    fullBleedDarkShare,
    tileDarkShare,
    darkBandCount: bands.length,
    darkBands: bands.map((band) => ({ top: Math.round(band.start / deviceScaleFactor), bottom: Math.round(band.end / deviceScaleFactor) })),
    darkUsage,
  };
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function ratio(value: unknown): boolean { return finite(value) && value >= 0 && value <= 1; }

function assertProfile(value: unknown, where: string): asserts value is ToneProfile {
  if (!object(value)) throw new Error(`${where}: profile must be an object or null`);
  for (const key of TONE_SHARE_METRICS) if (!ratio(value[key])) throw new Error(`${where}: ${key} must be a ratio in [0, 1]`);
  if (!finite(value.width) || !finite(value.height)) throw new Error(`${where}: profile size is invalid`);
  if (!Number.isSafeInteger(value.darkBandCount) || (value.darkBandCount as number) < 0) throw new Error(`${where}: darkBandCount is invalid`);
  if (!Array.isArray(value.darkBands) || !value.darkBands.every((band) => object(band) && finite(band.top) && finite(band.bottom))) throw new Error(`${where}: darkBands is invalid`);
  if (!DARK_USAGES.includes(value.darkUsage as DarkUsage)) throw new Error(`${where}: darkUsage is invalid`);
}

/** Structural validation of a saved tone.json; source binding is checked by the caller. */
export function parseToneDocument(value: unknown): ToneDocument {
  if (!object(value) || value.schemaVersion !== 1) throw new Error('unsupported tone.json schemaVersion');
  if (typeof value.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.evidenceHash)) throw new Error('tone.json evidenceHash is invalid');
  if (!object(value.thresholds) || !Object.keys(TONE_THRESHOLDS).every((key) => finite((value.thresholds as Record<string, unknown>)[key]))) throw new Error('tone.json thresholds are invalid');
  if (!Array.isArray(value.captures)) throw new Error('tone.json captures must be an array');
  const ids = new Set<string>();
  for (const [index, capture] of value.captures.entries()) {
    const where = `tone.json capture ${index}`;
    if (!object(capture) || typeof capture.captureId !== 'string' || ids.has(capture.captureId)) throw new Error(`${where}: missing or duplicate captureId`);
    ids.add(capture.captureId);
    if (!object(capture.viewport) || !finite(capture.viewport.width) || !finite(capture.viewport.height)) throw new Error(`${where}: viewport is invalid`);
    if (!finite(capture.deviceScaleFactor) || typeof capture.complete !== 'boolean') throw new Error(`${where}: capture metadata is invalid`);
    const image = capture.image;
    if (!object(image) || typeof image.path !== 'string' || typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256)
        || !finite(image.width) || !finite(image.height)) throw new Error(`${where}: image is invalid`);
    if (capture.profile !== null) assertProfile(capture.profile, where);
    if (capture.reason !== undefined && typeof capture.reason !== 'string') throw new Error(`${where}: reason must be a string`);
  }
  return value as unknown as ToneDocument;
}

export interface ToneRunResult { document: ToneDocument; out: string; json: string; profiles: number; warnings: string[] }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Every screenshot hash is verified before tone.json is written; a mismatch writes nothing. */
export async function runTone(projectDir: string, onPhase: (name: string, ms: number) => void = () => undefined): Promise<ToneRunResult> {
  const root = path.resolve(projectDir);
  // Phase totals for the caller's run log: reading and hashing, decoding and profiling, writing.
  let readMs = 0;
  let profileMs = 0;
  let mark = performance.now();
  const lap = (): number => {
    const now = performance.now();
    const elapsed = now - mark;
    mark = now;
    return elapsed;
  };
  let evidence: EvidenceDocument;
  try { evidence = await readEvidence(root); } catch (error) {
    throw new Error(`tone requires source evidence (evidence.json); recapture with clone-reference (${errorMessage(error)})`);
  }
  const captures: ToneCaptureReport[] = [];
  const warnings: string[] = [];
  for (const capture of evidence.captures) {
    if (capture.fullScreenshot === '') continue;
    const entry = capture.files.find((file) => file.path === capture.fullScreenshot);
    if (!entry) throw new Error(`full screenshot of ${capture.id} is not integrity protected: ${capture.fullScreenshot}`);
    const bytes = await fs.readFile(await resolveEvidencePath(root, capture.fullScreenshot));
    if (sha256(bytes) !== entry.sha256) throw new Error(`full screenshot hash mismatch for ${capture.id}: ${capture.fullScreenshot}; recapture with clone-reference`);
    readMs += lap();
    const report: ToneCaptureReport = {
      captureId: capture.id,
      viewport: { width: capture.viewport.width, height: capture.viewport.height },
      deviceScaleFactor: capture.deviceScaleFactor,
      complete: capture.complete && capture.observations.complete,
      image: { path: capture.fullScreenshot, sha256: entry.sha256, width: 0, height: 0 },
      profile: null,
    };
    try {
      const png = decodePng(bytes);
      report.image.width = png.width;
      report.image.height = png.height;
      report.profile = toneProfile(png, capture.deviceScaleFactor);
    } catch (error) {
      report.reason = `full screenshot could not be profiled: ${errorMessage(error)}`;
      warnings.push(`${capture.id}: ${report.reason}`);
    }
    profileMs += lap();
    captures.push(report);
  }
  readMs += lap();
  onPhase('read', readMs);
  onPhase('profile', profileMs);
  const document: ToneDocument = { schemaVersion: 1, evidenceHash: evidenceHash(evidence), thresholds: { ...TONE_THRESHOLDS }, captures };
  const json = `${JSON.stringify(document, null, 2)}\n`;
  const out = path.join(root, 'tone.json');
  const temporary = path.join(root, `.tone.json.${process.pid}.tmp`);
  await fs.writeFile(temporary, json, { flag: 'wx' });
  try { await fs.rename(temporary, out); } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  onPhase('write', lap());
  return { document, out, json, profiles: captures.filter((capture) => capture.profile !== null).length, warnings };
}
