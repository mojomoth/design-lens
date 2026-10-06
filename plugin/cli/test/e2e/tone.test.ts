import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evidenceHash, hashTree, sha256 } from '../../src/capture/evidence.js';
import type { DesignValidationReport } from '../../src/analyze/design-validation.js';
import type { ToneDocument } from '../../src/analyze/tone.js';
import { DEFAULT_ROWS, design, evidence, variations } from '../fixtures/design-validation-fixture.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** 200x1000 light page with one edge-to-edge dark section at y 200–400. */
function bandedPage(): Buffer {
  const png = new PNG({ width: 200, height: 1000 });
  for (let y = 0; y < 1000; y += 1) {
    for (let x = 0; x < 200; x += 1) png.data.set(y >= 200 && y < 400 ? [12, 12, 12, 255] : [250, 250, 250, 255], (y * 200 + x) * 4);
  }
  return PNG.sync.write(png);
}

describe('tone command', () => {
  let root: string;
  let template: string;
  let full: Buffer;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-tone-'));
    template = path.join(root, 'template');
    await fs.mkdir(path.join(template, 'evidence/desktop'), { recursive: true });
    await fs.mkdir(path.join(template, 'clone'), { recursive: true });
    await fs.writeFile(path.join(template, 'clone/index.html'), '<!doctype html><h1 data-dl-id="dl-1">Evidence title</h1>');
    full = bandedPage();
    const source = evidence();
    for (const [name, bytes] of [['index.html', Buffer.from('<h1>Evidence title</h1>')], ['full.png', full], ['viewport.png', full]] as const) {
      const relative = `evidence/desktop/${name}`;
      await fs.writeFile(path.join(template, relative), bytes);
      source.captures[0].files.push({ path: relative, sha256: sha256(bytes) });
    }
    await fs.writeFile(path.join(template, 'evidence.json'), JSON.stringify(source));
    await fs.writeFile(path.join(template, 'manifest.json'), JSON.stringify({ evidenceHash: evidenceHash(source) }));
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function project(name: string): Promise<string> {
    const directory = path.join(root, name);
    await fs.cp(template, directory, { recursive: true });
    return directory;
  }

  // why: tone.json is the pixel-derived reference budget validate-design and qa compare against.
  it('profiles every full screenshot into tone.json bound to the evidence', async () => {
    const directory = await project('measured');
    const result = await runCli(['tone', directory]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.endsWith('\n') && result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({ out: path.join(directory, 'tone.json'), captures: 1 });
    expect(result.stderr).toContain('design-lens: tone desktop (1440x900): darkShare 0.2, fullBleedDarkShare 0.2, 1 dark band(s), darkUsage bands');
    const tone = JSON.parse(await fs.readFile(path.join(directory, 'tone.json'), 'utf8')) as ToneDocument;
    const source = JSON.parse(await fs.readFile(path.join(directory, 'evidence.json'), 'utf8')) as ReturnType<typeof evidence>;
    expect(tone).toMatchObject({ schemaVersion: 1, evidenceHash: evidenceHash(source) });
    expect(tone.captures).toEqual([{
      captureId: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, complete: true,
      image: { path: 'evidence/desktop/full.png', sha256: sha256(full), width: 200, height: 1000 },
      profile: { width: 200, height: 1000, lightShare: 0.8, midShare: 0, darkShare: 0.2, fullBleedDarkShare: 0.2, tileDarkShare: 0, darkBandCount: 1, darkBands: [{ top: 200, bottom: 400 }], darkUsage: 'bands' },
    }]);
    const json = await runCli(['tone', directory, '--json']);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(tone);
  });

  // why: the tone budget written from tone.json must validate end to end through the bundle.
  it('feeds validate-design tone rows', async () => {
    const directory = await project('validated');
    expect((await runCli(['tone', directory])).code).toBe(0);
    const document = design(DEFAULT_ROWS, { tone: ['| desktop | 1440x900 | darkShare | 0.2 | ratio | 2 |', '| desktop | 1440x900 | fullBleedDarkShare | 0.2 | ratio | 2 |'] });
    await fs.writeFile(path.join(directory, 'DESIGN.md'), document);
    await fs.writeFile(path.join(directory, 'VARIATIONS.md'), variations(document));
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code, result.stdout).toBe(0);
    const report = JSON.parse(result.stdout) as DesignValidationReport;
    expect(report.checks.filter((check) => check.id.startsWith('tone')).every((check) => check.status === 'pass')).toBe(true);
  });

  // why: a modified screenshot must never be profiled into a trusted tone.json.
  it('writes nothing when a screenshot no longer matches its evidence hash', async () => {
    const directory = await project('tampered');
    await fs.appendFile(path.join(directory, 'evidence/desktop/full.png'), Buffer.from([0]));
    const before = await hashTree(directory);
    const result = await runCli(['tone', directory]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: tone requires source evidence (evidence.json); recapture with clone-reference');
    expect(result.stderr).toContain('hash mismatch');
    expect(await hashTree(directory)).toEqual(before);
  });

  // why: tone has no meaning without source evidence; the message tells the agent how to recover.
  it('fails without evidence.json', async () => {
    const directory = await project('no-evidence');
    await fs.unlink(path.join(directory, 'evidence.json'));
    const result = await runCli(['tone', directory]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('tone requires source evidence (evidence.json); recapture with clone-reference');
  });
});
