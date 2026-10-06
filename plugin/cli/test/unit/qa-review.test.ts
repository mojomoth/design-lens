import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';

import { sha256 } from '../../src/capture/evidence.js';
import { decodePng } from '../../src/analyze/pixels.js';
import {
  BADGE_HEIGHT, BADGE_WIDTH, COMPARE_MAX_HEIGHT, REVIEW_CODE_ALPHABET, compareImages, generateReviewCode, hashReviewCode, normalizeReviewCode,
  placeBadges, planTiles, hashReviewProof, reviewPage, reviewProofValue, runQaConfirm, verifyReviewCode, type ReviewImage,
} from '../../src/analyze/qa-review.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function png(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(200);
  return PNG.sync.write(image);
}

async function qaDir(codes: string[]): Promise<{ dir: string; bytes: Buffer }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-qa-confirm-'));
  roots.push(dir);
  const images: ReviewImage[] = codes.map((code, index) => {
    const salt = `${index}`.padStart(32, 'a');
    return { path: `review/390x844-tile-0${index + 1}.png`, kind: 'tile', viewport: '390x844', top: index * 1688, bottom: (index + 1) * 1688, salt, hash: hashReviewCode(code, salt) };
  });
  const proofSalt = 'ff'.repeat(16);
  const proof = { salt: proofSalt, hash: hashReviewProof(reviewProofValue(codes), proofSalt) };
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, status: 'pass', review: { images, proof } }, null, 2)}\n`);
  await fs.writeFile(path.join(dir, 'qa.json'), bytes);
  return { dir, bytes };
}

describe('review codes', () => {
  // why: codes must avoid look-alike glyphs (0/O, 1/I/L) so a careful viewer can always read them.
  it('draws six characters from the unambiguous alphabet', () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generateReviewCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      for (const character of code) expect(REVIEW_CODE_ALPHABET).toContain(character);
    }
    expect(REVIEW_CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  // why: only a salted hash is stored; normalization lets "ab-c 12d" match "ABC12D" without ever storing the code.
  it('verifies normalized codes against the salted hash only', () => {
    const salt = '00112233445566778899aabbccddeeff';
    const image = { salt, hash: hashReviewCode('ABC234', salt) };
    expect(normalizeReviewCode('ab-c 234')).toBe('ABC234');
    expect(verifyReviewCode('ab-c 234', image)).toBe(true);
    expect(verifyReviewCode('ABC235', image)).toBe(false);
    expect(verifyReviewCode('ABC234', { salt, hash: 'zz' })).toBe(false);
    expect(image.hash).not.toContain('ABC234');
  });

  // why: tiles of ≤ 2 viewport heights keep text legible after a viewer downsamples them; coverage must be complete.
  it('slices a full page into tiles of at most two viewport heights', () => {
    expect(planTiles(4000, 900)).toEqual([{ top: 0, bottom: 1800 }, { top: 1800, bottom: 3600 }, { top: 3600, bottom: 4000 }]);
    expect(planTiles(500, 900)).toEqual([{ top: 0, bottom: 500 }]);
  });

  // why: one character per horizontal sixth at its own height means the whole image has to be looked at.
  it('places one badge per sixth inside the content box', () => {
    const placements = placeBadges('ABCDEF', 390, { top: 48, bottom: 1000 }, (limit) => limit - 1);
    placements.forEach((badge, index) => {
      expect(badge.character).toBe('ABCDEF'[index]);
      expect(badge.x).toBeGreaterThanOrEqual(Math.floor((index * 390) / 6));
      expect(badge.x + BADGE_WIDTH).toBeLessThanOrEqual(Math.ceil(((index + 1) * 390) / 6));
      expect(badge.y).toBeGreaterThanOrEqual(48);
      expect(badge.y + 52).toBeLessThanOrEqual(1000);
    });
  });

  // why: compare sheets downscale both full pages by one common factor (the taller page at most 1568 px), so a taller
  // build is not drawn smaller than the reference and its type sizes stay comparable side by side.
  it('scales reference and build by one factor so the taller is at most 1568 px', () => {
    const [left, right] = compareImages(png(80, 4000), png(40, 2000)).map((bytes) => decodePng(bytes));
    expect(left.height).toBe(COMPARE_MAX_HEIGHT);
    expect(right.height).toBe(Math.round(2000 / (4000 / COMPARE_MAX_HEIGHT)));
    expect(left.width).toBe(31);
    expect(right.width).toBe(16);
    const [short, tall] = compareImages(png(40, 961), png(40, 1230)).map((bytes) => decodePng(bytes));
    expect([short.width, short.height, tall.width, tall.height]).toEqual([40, 961, 40, 1230]);
  });

  // why: a 245 px last tile is fine, but a 20 px last tile or a 30 px-wide downscaled mobile compare column would cut
  // badges off or stack all six on top of each other, making the code unreadable and the run unconfirmable.
  it('pads short tiles and narrow compare sheets so every badge fits in its own sixth', () => {
    const tile = reviewPage({ file: 'review/t.png', kind: 'tile', viewport: '390x844', top: 0, bottom: 20, images: [] }, [{ width: 390, height: 20 }], []);
    expect(tile.height).toBeGreaterThanOrEqual(BADGE_HEIGHT);
    const sheet = reviewPage({ file: 'review/c.png', kind: 'compare', viewport: '390x844', top: 0, bottom: 20_000, images: [] }, [{ width: 30, height: 1568 }, { width: 28, height: 1568 }], []);
    expect(sheet.width / 6).toBeGreaterThanOrEqual(BADGE_WIDTH);
    expect(sheet.html.indexOf('BUILD')).toBeGreaterThan(0);
    expect(/left:(\d+)px">BUILD/.exec(sheet.html)?.[1]).toMatch(/^(1[5-9]\d|[2-9]\d\d)$/);
    for (const badge of placeBadges('ABCDEF', sheet.width, { top: 48, bottom: sheet.height })) expect(badge.y + BADGE_HEIGHT).toBeLessThanOrEqual(sheet.height);
  });
});

describe('qa-confirm', () => {
  // why: confirming with the codes seen on the images is the only way to mark a qa run reviewed; review.json binds
  // to the exact qa.json bytes so a later edit invalidates it.
  it('writes review.json when every code matches in order', async () => {
    const { dir, bytes } = await qaDir(['ABC234', 'XYZ789']);
    const result = await runQaConfirm(dir, ['abc234', 'XYZ-789'], () => new Date(Date.UTC(2026, 9, 6)));
    expect(result).toMatchObject({ confirmed: true, matched: 2, total: 2, unconfirmed: [] });
    const review = JSON.parse(await fs.readFile(path.join(dir, 'review.json'), 'utf8')) as Record<string, unknown>;
    expect(review).toEqual({ schemaVersion: 1, qaSha256: sha256(bytes), confirmed: true, images: 2, confirmedAt: new Date(Date.UTC(2026, 9, 6)).toISOString(), proof: reviewProofValue(['ABC234', 'XYZ789']) });
    expect(JSON.stringify(review)).not.toMatch(/ABC234|XYZ789/);
  });

  // why: codes in the wrong order, a missing code or an extra code must never confirm, and must write nothing.
  it('writes nothing unless every image is matched in order', async () => {
    const { dir } = await qaDir(['ABC234', 'XYZ789']);
    expect(await runQaConfirm(dir, ['XYZ789', 'ABC234'])).toMatchObject({ confirmed: false, matched: 0, unconfirmed: ['review/390x844-tile-01.png', 'review/390x844-tile-02.png'] });
    expect(await runQaConfirm(dir, ['ABC234'])).toMatchObject({ confirmed: false, matched: 1, unconfirmed: ['review/390x844-tile-02.png'] });
    expect(await runQaConfirm(dir, ['ABC234', 'XYZ789', 'EXTRA2'])).toMatchObject({ confirmed: false, matched: 2 });
    await expect(fs.access(path.join(dir, 'review.json'))).rejects.toThrow();
  });
});
