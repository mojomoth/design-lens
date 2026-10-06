/**
 * Enforced viewing of `qa` screenshots. Each review image carries six badge characters drawn
 * separately (one per horizontal sixth, random height), so a code can only be read by looking at
 * the whole image. Only a salted PBKDF2 hash of each code is stored; codes are never printed,
 * logged or written. `qa-confirm` checks the codes in `review.images` order.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Browser } from 'playwright';
import { PNG } from 'pngjs';

import { sha256 } from '../capture/evidence.js';
import { cropDevice, decodePng, downscale } from './pixels.js';

export const REVIEW_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REVIEW_CODE_LENGTH = 6;
export const REVIEW_PBKDF2_ITERATIONS = 20_000;
export const REVIEW_HOST = 'https://review.design-lens.invalid';
/** Compare sheets downscale both pages by one common factor so the taller is no taller than this. */
export const COMPARE_MAX_HEIGHT = 1568;

export type ReviewKind = 'tile' | 'viewport' | 'compare';
export interface ReviewImage {
  path: string;
  kind: ReviewKind;
  viewport: string;
  /** Document CSS px range of the build page this image shows. */
  top: number;
  bottom: number;
  salt: string;
  hash: string;
}

export function generateReviewCode(): string {
  let code = '';
  for (let index = 0; index < REVIEW_CODE_LENGTH; index += 1) code += REVIEW_CODE_ALPHABET[crypto.randomInt(REVIEW_CODE_ALPHABET.length)];
  return code;
}

export function normalizeReviewCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]+/g, '');
}

export function hashReviewCode(code: string, salt: string): string {
  return crypto.pbkdf2Sync(normalizeReviewCode(code), Buffer.from(salt, 'hex'), REVIEW_PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
}

/**
 * Opaque value derived from every code in review order. qa.json stores only its salted slow hash;
 * qa-confirm writes the value into review.json, so a hand-written review.json cannot pass
 * validate-design without the codes.
 */
export interface ReviewProof { salt: string; hash: string }
export function reviewProofValue(codes: readonly string[]): string {
  return crypto.createHash('sha256').update(`design-lens review proof v1\n${codes.map(normalizeReviewCode).join(',')}`).digest('hex');
}
export function hashReviewProof(value: string, salt: string): string {
  return crypto.pbkdf2Sync(value, Buffer.from(salt, 'hex'), REVIEW_PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
}

export function verifyReviewCode(code: string, image: Pick<ReviewImage, 'salt' | 'hash'>): boolean {
  if (!/^[0-9a-f]{64}$/.test(image.hash) || !/^[0-9a-f]+$/.test(image.salt)) return false;
  const actual = Buffer.from(hashReviewCode(code, image.salt), 'hex');
  return crypto.timingSafeEqual(actual, Buffer.from(image.hash, 'hex'));
}

/** Slices of a full page, each at most two viewport heights tall. */
export function planTiles(fullHeight: number, viewportHeight: number): Array<{ top: number; bottom: number }> {
  const step = Math.max(1, 2 * viewportHeight);
  const tiles: Array<{ top: number; bottom: number }> = [];
  for (let top = 0; top < fullHeight; top += step) tiles.push({ top, bottom: Math.min(fullHeight, top + step) });
  return tiles;
}

export interface BadgePlacement { character: string; x: number; y: number }
export const BADGE_WIDTH = 44;
export const BADGE_HEIGHT = 52;
/** Each sixth must hold a whole badge with a gap, and the image must hold a whole badge in height. */
export const REVIEW_MIN_WIDTH = REVIEW_CODE_LENGTH * (BADGE_WIDTH + 12);
export const REVIEW_MIN_CONTENT_HEIGHT = BADGE_HEIGHT + 8;

/** One character per horizontal sixth, each at its own random height inside the content box. */
export function placeBadges(code: string, width: number, content: { top: number; bottom: number }, random: (limit: number) => number = crypto.randomInt): BadgePlacement[] {
  const sixth = width / code.length;
  return [...code].map((character, index) => {
    const freeX = Math.max(0, Math.floor(sixth - BADGE_WIDTH));
    const freeY = Math.max(0, Math.floor(content.bottom - content.top - BADGE_HEIGHT));
    return {
      character,
      x: Math.round(index * sixth + (freeX > 0 ? random(freeX + 1) : Math.max(0, (sixth - BADGE_WIDTH) / 2))),
      y: Math.round(content.top + (freeY > 0 ? random(freeY + 1) : 0)),
    };
  });
}

export interface ReviewSpec {
  file: string;
  kind: ReviewKind;
  viewport: string;
  top: number;
  bottom: number;
  /** Tile/viewport: the image itself. Compare: reference (left) and build (right). */
  images: Buffer[];
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character);
}

/** HTML of one review image and the context size it is rendered at. */
export function reviewPage(spec: ReviewSpec, sizes: Array<{ width: number; height: number }>, placements: BadgePlacement[]): { html: string; width: number; height: number } {
  const badges = placements.map((badge) => `<div class="b" style="left:${badge.x}px;top:${badge.y}px">${escapeHtml(badge.character)}</div>`).join('');
  const style = '*{margin:0;padding:0;box-sizing:border-box}html,body{background:#fff}'
    + '.b{position:absolute;width:44px;height:52px;font:bold 40px/48px monospace;color:#000;background:#ffe600;border:2px solid #000;text-align:center;z-index:2}'
    + '.p{position:absolute;top:0}.l{position:absolute;top:8px;font:bold 24px/32px sans-serif;color:#000}img{display:block}';
  if (spec.kind !== 'compare') {
    const { width: imageWidth, height: imageHeight } = sizes[0];
    const width = Math.max(imageWidth, REVIEW_MIN_WIDTH);
    const height = Math.max(imageHeight, REVIEW_MIN_CONTENT_HEIGHT);
    return { width, height, html: `<!doctype html><html><head><style>${style}</style></head><body style="width:${width}px;height:${height}px"><div class="p" style="left:0;width:${imageWidth}px;height:${imageHeight}px"><img src="${REVIEW_HOST}/0.png" width="${imageWidth}" height="${imageHeight}"></div>${badges}</body></html>` };
  }
  const gap = 24;
  const labelHeight = 48;
  // Downscaled tall mobile pages can be a few dozen px wide; the sheet is padded so six badges never overlap.
  // The REFERENCE label is about 140 px wide; a narrower left column must not push BUILD onto it.
  const buildLeft = Math.max(sizes[0].width, 150) + gap;
  const width = Math.max(buildLeft + Math.max(sizes[1].width, 80), REVIEW_MIN_WIDTH);
  const height = labelHeight + Math.max(sizes[0].height, sizes[1].height, REVIEW_MIN_CONTENT_HEIGHT);
  const columns = [
    { left: 0, label: 'REFERENCE', size: sizes[0] },
    { left: buildLeft, label: 'BUILD', size: sizes[1] },
  ].map((column, index) => `<div class="l" style="left:${column.left}px">${column.label}</div><div class="p" style="left:${column.left}px;top:${labelHeight}px"><img src="${REVIEW_HOST}/${index}.png" width="${column.size.width}" height="${column.size.height}"></div>`).join('');
  return { width, height, html: `<!doctype html><html><head><style>${style}</style></head><body style="width:${width}px;height:${height}px">${columns}${badges}</body></html>` };
}

/**
 * Downscales reference and build full pages by ONE factor, so the taller is at most
 * {@link COMPARE_MAX_HEIGHT} and type sizes stay comparable; the sheet pads the shorter page.
 */
export function compareImages(reference: Buffer, build: Buffer): Buffer[] {
  const left = decodePng(reference);
  const right = decodePng(build);
  const factor = Math.max(1, Math.max(left.height, right.height) / COMPARE_MAX_HEIGHT);
  return [left, right].map((png) => PNG.sync.write(factor > 1 ? downscale(png, factor) : png));
}

/** Slices `full` into tile PNG buffers following {@link planTiles}. */
export function sliceTiles(full: Buffer, viewportHeight: number): Array<{ top: number; bottom: number; image: Buffer }> {
  const png = decodePng(full);
  return planTiles(png.height, viewportHeight).map((tile) => {
    const crop = cropDevice(png, { x: 0, y: tile.top, width: png.width, height: tile.bottom - tile.top });
    if (!crop) throw new Error(`review tile ${tile.top}-${tile.bottom} is outside the screenshot`);
    return { ...tile, image: PNG.sync.write(crop) };
  });
}

/**
 * Renders every review image in the qa browser (images are served through a routed host, not data
 * URIs) and returns the stored records. Files are written under `outDir`.
 */
export async function renderReviewImages(browser: Browser, outDir: string, specs: readonly ReviewSpec[]): Promise<{ images: ReviewImage[]; proof: ReviewProof | null }> {
  const records: ReviewImage[] = [];
  const codes: string[] = [];
  for (const spec of specs) {
    const sizes = spec.images.map((image) => {
      const png = decodePng(image);
      return { width: png.width, height: png.height };
    });
    const code = generateReviewCode();
    const contentTop = spec.kind === 'compare' ? 48 : 0;
    const provisional = reviewPage(spec, sizes, []);
    const placements = placeBadges(code, provisional.width, { top: contentTop, bottom: provisional.height });
    const page = reviewPage(spec, sizes, placements);
    const context = await browser.newContext({ viewport: { width: page.width, height: page.height }, deviceScaleFactor: 1 });
    try {
      const tab = await context.newPage();
      await tab.route(`${REVIEW_HOST}/**`, async (route) => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (name === 'index.html') { await route.fulfill({ status: 200, contentType: 'text/html', body: page.html }); return; }
        const index = Number(name.replace(/\.png$/, ''));
        const body = spec.images[index];
        if (!body) { await route.fulfill({ status: 404, body: '' }); return; }
        await route.fulfill({ status: 200, contentType: 'image/png', body });
      });
      await tab.goto(`${REVIEW_HOST}/index.html`, { waitUntil: 'load', timeout: 30_000 });
      const shot = await tab.screenshot({ type: 'png', fullPage: false, timeout: 30_000 });
      const file = path.join(outDir, spec.file);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, shot, { flag: 'wx' });
    } finally {
      await context.close();
    }
    const salt = crypto.randomBytes(16).toString('hex');
    records.push({ path: spec.file, kind: spec.kind, viewport: spec.viewport, top: spec.top, bottom: spec.bottom, salt, hash: hashReviewCode(code, salt) });
    codes.push(code);
  }
  if (codes.length === 0) return { images: records, proof: null };
  const proofSalt = crypto.randomBytes(16).toString('hex');
  return { images: records, proof: { salt: proofSalt, hash: hashReviewProof(reviewProofValue(codes), proofSalt) } };
}

export interface QaConfirmResult {
  confirmed: boolean;
  matched: number;
  total: number;
  unconfirmed: string[];
  review?: { schemaVersion: 1; qaSha256: string; confirmed: true; images: number; confirmedAt: string; proof: string };
  out?: string;
}

function reviewImages(value: unknown): ReviewImage[] {
  const review = value !== null && typeof value === 'object' ? (value as { review?: unknown }).review : undefined;
  const images = review !== null && typeof review === 'object' ? (review as { images?: unknown }).images : undefined;
  if (!Array.isArray(images)) throw new Error('qa.json has no review.images list');
  return images.map((image, index) => {
    if (image === null || typeof image !== 'object') throw new Error(`qa.json review image ${index} is invalid`);
    const record = image as Record<string, unknown>;
    if (typeof record.path !== 'string' || typeof record.salt !== 'string' || typeof record.hash !== 'string') throw new Error(`qa.json review image ${index} is invalid`);
    return record as unknown as ReviewImage;
  });
}

/** Writes `review.json` only when every code matches its image, in `review.images` order. */
export async function runQaConfirm(qaDir: string, codes: readonly string[], now: () => Date = () => new Date()): Promise<QaConfirmResult> {
  const root = path.resolve(qaDir);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(root, 'qa.json'));
  } catch (error) {
    throw new Error(`cannot read ${path.join(root, 'qa.json')}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  const images = reviewImages(parsed);
  if (images.length === 0) throw new Error('qa run has no review images to confirm');
  const unconfirmed: string[] = [];
  images.forEach((image, index) => {
    const code = codes[index];
    if (code === undefined || !verifyReviewCode(code, image)) unconfirmed.push(image.path);
  });
  const matched = images.length - unconfirmed.length;
  if (unconfirmed.length > 0 || codes.length !== images.length) {
    return { confirmed: false, matched, total: images.length, unconfirmed };
  }
  const proof = reviewProofValue(codes);
  const stored = (parsed as { review?: { proof?: unknown } }).review?.proof;
  if (stored !== null && typeof stored === 'object') {
    const { salt, hash } = stored as Record<string, unknown>;
    if (typeof salt !== 'string' || typeof hash !== 'string' || hashReviewProof(proof, salt) !== hash) throw new Error('qa.json review proof does not match its review images; run design-lens qa again');
  }
  const review = { schemaVersion: 1 as const, qaSha256: sha256(bytes), confirmed: true as const, images: images.length, confirmedAt: now().toISOString(), proof };
  const out = path.join(root, 'review.json');
  const temporary = path.join(root, `.review.json.${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  try { await fs.rename(temporary, out); } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return { confirmed: true, matched, total: images.length, unconfirmed, review, out };
}
