import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evidenceHash, hashFile, hashTree, readEvidence, resolveEvidencePath, sha256, type EvidenceDocument } from '../../src/capture/evidence.js';

describe('immutable capture evidence', () => {
  let directory: string;
  let evidence: EvidenceDocument;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-evidence-'));
    const snapshot = 'evidence/desktop/clone/index.html';
    const viewportScreenshot = 'evidence/desktop/viewport.png';
    const fullScreenshot = 'evidence/desktop/full.png';
    await fs.mkdir(path.join(directory, 'evidence/desktop/clone'), { recursive: true });
    for (const file of [snapshot, viewportScreenshot, fullScreenshot]) await fs.writeFile(path.join(directory, file), file);
    evidence = {
      schemaVersion: 1,
      captures: [{
        id: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
        capturedAt: '2026-09-27T00:00:00.000Z', browserVersion: 'test', userAgent: 'test',
        sourceUrl: 'http://127.0.0.1/', finalUrl: 'http://127.0.0.1/',
        policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [] },
        observations: {
          viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, width: 1440, height: 900,
          rootFontSize: '16px', fonts: { status: 'ready', failedFamilies: [] }, elements: [], complete: true, warnings: [],
        },
        snapshot, viewportScreenshot, fullScreenshot,
        files: await Promise.all([snapshot, viewportScreenshot, fullScreenshot].map(async (file) => ({ path: file, sha256: await hashFile(path.join(directory, file)) }))),
        complete: true, warnings: [],
      }],
    };
    await save();
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  async function save(): Promise<void> { await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(evidence)); }

  it('reads a complete capture only after checking every protected byte', async () => {
    expect(await readEvidence(directory)).toEqual(evidence);
    await fs.writeFile(path.join(directory, evidence.captures[0].snapshot), 'changed');
    await expect(readEvidence(directory)).rejects.toThrow('file hash mismatch');
  });

  it('allows an explicit failed viewport alongside valid evidence', async () => {
    const failed = structuredClone(evidence.captures[0]);
    Object.assign(failed, { id: 'mobile', complete: false, warnings: ['navigation failed'], files: [], snapshot: '', viewportScreenshot: '', fullScreenshot: '' });
    failed.observations.complete = false;
    failed.observations.elements = [];
    failed.observations.fonts.status = 'unavailable';
    evidence.captures.push(failed);
    await save();
    expect((await readEvidence(directory)).captures).toHaveLength(2);
  });

  it('does not let incomplete status bypass integrity checks of existing files', async () => {
    evidence.captures[0].complete = false;
    await save();
    await fs.writeFile(path.join(directory, evidence.captures[0].fullScreenshot), 'changed');
    await expect(readEvidence(directory)).rejects.toThrow('file hash mismatch');
  });

  it('requires referenced screenshots and DOM to belong to the integrity inventory', async () => {
    evidence.captures[0].files.pop();
    await save();
    await expect(readEvidence(directory)).rejects.toThrow('not integrity protected');
  });

  it('rejects duplicate capture IDs and mismatched observation dimensions', async () => {
    evidence.captures.push(structuredClone(evidence.captures[0]));
    await save();
    await expect(readEvidence(directory)).rejects.toThrow('duplicate capture ID');
    evidence.captures.pop();
    evidence.captures[0].observations.viewport.width = 390;
    await save();
    await expect(readEvidence(directory)).rejects.toThrow('viewport differ');
  });

  it('rejects traversal, absolute and ambiguous file paths before reading', async () => {
    for (const file of ['../outside', '/tmp/file', 'evidence/../evidence.json', 'evidence//file', 'evidence\\file', './evidence.json']) {
      await expect(resolveEvidencePath(directory, file)).rejects.toThrow('invalid evidence path');
    }
  });

  it('rejects symlink files and symlink directories even within the project', async () => {
    await fs.symlink(path.join(directory, 'evidence.json'), path.join(directory, 'alias.json'));
    await fs.symlink(path.join(directory, 'evidence/desktop'), path.join(directory, 'alias'));
    await expect(resolveEvidencePath(directory, 'alias.json')).rejects.toThrow('symlink');
    await expect(resolveEvidencePath(directory, 'alias/full.png')).rejects.toThrow('symlink');
    await expect(hashTree(directory)).rejects.toThrow('symlink');
  });

  // why: checking descendants alone allows clone/ itself to point outside the self-contained project.
  it('rejects a symlink tree root while accepting symlink ancestors and ordinary directories', async () => {
    const alias = path.join(directory, 'alias');
    const real = path.join(directory, 'evidence');
    await fs.symlink(real, alias);
    await expect(hashTree(alias)).rejects.toThrow('root contains symlink');
    await expect(hashTree(`${alias}/`)).rejects.toThrow('root contains symlink');
    expect(await hashTree(path.join(alias, 'desktop'))).toEqual(await hashTree(path.join(real, 'desktop')));
    await expect(hashTree(path.join(directory, 'evidence.json'))).rejects.toThrow('not a directory');
  });

  it('hashes nested asset bytes and returns deterministic relative paths', async () => {
    const files = await hashTree(path.join(directory, 'evidence/desktop'));
    expect(files.map((file) => file.path)).toEqual(['clone/index.html', 'full.png', 'viewport.png']);
    expect(files[0].sha256).toBe(sha256('evidence/desktop/clone/index.html'));
    expect(await hashTree(path.join(directory, 'evidence/desktop'))).toEqual(files);
  });

  it('canonical evidence hashes ignore formatting and key order, but retain values', () => {
    const reordered = { captures: evidence.captures, schemaVersion: 1 as const };
    expect(evidenceHash(reordered)).toBe(evidenceHash(evidence));
    const modified = structuredClone(evidence);
    modified.captures[0].observations.rootFontSize = '18px';
    expect(evidenceHash(modified)).not.toBe(evidenceHash(evidence));
  });

  it('rejects malformed font readiness instead of treating it as measured data', async () => {
    const invalid = JSON.parse(JSON.stringify(evidence)) as { captures: Array<{ observations: { fonts: unknown } }> };
    invalid.captures[0].observations.fonts = { status: 'ready' };
    await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(invalid));
    await expect(readEvidence(directory)).rejects.toThrow('font readiness');
  });

  it('does not silently synthesize evidence for a legacy project', async () => {
    await fs.unlink(path.join(directory, 'evidence.json'));
    await expect(readEvidence(directory)).rejects.toThrow();
  });

  it('validates optional measured font faces without inventing them for older evidence', async () => {
    expect((await readEvidence(directory)).captures[0].observations.fontFaces).toBeUndefined();
    evidence.captures[0].observations.fontFaces = [{ family: 'MeasuredFace', status: 'loaded', style: 'normal', weight: 'normal', stretch: 'normal' }];
    await save();
    expect((await readEvidence(directory)).captures[0].observations.fontFaces).toEqual(evidence.captures[0].observations.fontFaces);
    evidence.captures[0].observations.fontFaces[0].status = 'ready';
    await save();
    await expect(readEvidence(directory)).rejects.toThrow('font face observations');
  });

  it('validates optional body evidence without inserting an inventory ID', async () => {
    const pseudo = { content: 'none', styles: {} };
    evidence.captures[0].observations.body = {
      tag: 'body', text: 'Body evidence', semantic: 'body', domPath: 'body', rootPath: [],
      parentDlId: null, childDlIds: [], rect: { x: 0, y: 0, width: 1440, height: 900 },
      styles: { fontFamily: 'sans-serif', backgroundColor: 'rgb(255, 255, 255)' },
      visible: true, currentSrc: null, pseudo: { before: pseudo, after: pseudo },
    };
    await save();
    const read = await readEvidence(directory);
    expect(read.captures[0].observations.body).toEqual(evidence.captures[0].observations.body);
    expect(read.captures[0].observations.body).not.toHaveProperty('dlId');
    const malformed = JSON.parse(JSON.stringify(evidence));
    malformed.captures[0].observations.body.rect.width = '1440px';
    await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(malformed));
    await expect(readEvidence(directory)).rejects.toThrow('invalid element rectangle');
  });

  // why: the stabilization record is optional (older evidence stays readable) but, when present,
  // it must be well-formed: disclosures and substitutions are reported as facts about the capture,
  // so a malformed record must fail closed exactly like malformed observations.
  it('validates the optional stabilization record and hidden image observations', async () => {
    expect((await readEvidence(directory)).captures[0].stabilization).toBeUndefined();
    evidence.captures[0].observations.hiddenUnloadedImages = ['dl-4'];
    evidence.captures[0].stabilization = {
      policy: { media: 'poster', lazyImages: 'eager', freezeTimers: false, readiness: { timeoutMs: 5000, retries: 2 }, captureAttempts: 2 },
      readiness: [{ attempt: 0, windowMs: 5000, elapsedMs: 12, fonts: 'ready', images: { total: 3, pendingVisible: [], pendingHidden: ['dl-4'], failedVisible: [], failedHidden: [] } }],
      stateAttempts: [{ attempt: 1, ms: 250, consistent: false, changed: '1 element: text dl-1' }, { attempt: 2, ms: 240, consistent: true }],
      frozen: { animations: 2, unsupported: 0, raf: true, timers: { frozen: false, suppressed: 0 }, media: 1, smil: 0, marquee: 0 },
      substitutions: [{ kind: 'video-frame', referencedBy: 'dl-2', urls: ['http://127.0.0.1/a.webm'], stillFrom: 'captured-frame', currentTime: 1.2, lost: ['motion'] }],
      disclosures: [{ code: 'hidden-images-unloaded', detail: '1 hidden images did not load', dlIds: ['dl-4'] }],
    };
    await save();
    const read = await readEvidence(directory);
    expect(read.captures[0].stabilization).toEqual(evidence.captures[0].stabilization);
    expect(read.captures[0].observations.hiddenUnloadedImages).toEqual(['dl-4']);
    const cases: Array<[(value: Record<string, unknown>) => void, string]> = [
      [(value) => { value.policy = { ...(value.policy as object), media: 'frames' }; }, 'invalid stabilization policy'],
      [(value) => { value.readiness = [{ attempt: 0 }]; }, 'invalid stabilization readiness attempts'],
      [(value) => { value.stateAttempts = [{ attempt: 0, ms: 1, consistent: true }]; }, 'invalid stabilization state attempts'],
      [(value) => { value.frozen = { ...(value.frozen as object), smil: -1 }; }, 'invalid stabilization freeze record'],
      [(value) => { value.substitutions = [{ kind: 'video-frame', referencedBy: 'dl-2', urls: [], stillFrom: 'captured-frame', lost: ['pixels'] }]; }, 'invalid stabilization substitutions'],
      [(value) => { value.disclosures = [{ code: 'made-up', detail: 'x' }]; }, 'invalid stabilization disclosures'],
    ];
    for (const [mutate, message] of cases) {
      const malformed = JSON.parse(JSON.stringify(evidence));
      mutate(malformed.captures[0].stabilization);
      await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(malformed));
      await expect(readEvidence(directory)).rejects.toThrow(message);
    }
    const hidden = JSON.parse(JSON.stringify(evidence));
    hidden.captures[0].observations.hiddenUnloadedImages = [4];
    await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(hidden));
    await expect(readEvidence(directory)).rejects.toThrow('invalid hidden image observations');
  });
});
