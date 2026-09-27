import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evidenceHash, hashTree, sha256 } from '../../src/capture/evidence.js';
import type { DesignValidationReport } from '../../src/analyze/design-validation.js';
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

describe('read-only design evidence validation', () => {
  let root: string;
  let template: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-design-validation-'));
    template = path.join(root, 'template');
    await fs.mkdir(path.join(template, 'clone'), { recursive: true });
    await fs.mkdir(path.join(template, 'evidence/desktop'), { recursive: true });
    const html = '<!doctype html><html><body><h1 data-dl-id="dl-1">Evidence title</h1></body></html>';
    await fs.writeFile(path.join(template, 'clone/index.html'), html);
    const source = evidence();
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=', 'base64');
    for (const [name, bytes] of [['index.html', Buffer.from(html)], ['full.png', pixel], ['viewport.png', pixel]] as const) {
      const relative = `evidence/desktop/${name}`;
      await fs.writeFile(path.join(template, relative), bytes);
      source.captures[0].files.push({ path: relative, sha256: sha256(bytes) });
    }
    await fs.writeFile(path.join(template, 'evidence.json'), JSON.stringify(source));
    const sourceHash = evidenceHash(source);
    await fs.writeFile(path.join(template, 'manifest.json'), JSON.stringify({ evidenceHash: sourceHash }));
    await fs.writeFile(path.join(template, 'fidelity.json'), JSON.stringify({
      schemaVersion: 1, status: 'pass', evidenceHash: sourceHash,
      cloneHash: sha256(JSON.stringify(await hashTree(path.join(template, 'clone')))),
      captures: [{ captureId: 'desktop', status: 'pass', observations: source.captures[0].observations }],
    }));
    await fs.writeFile(path.join(template, 'DESIGN.md'), design());
    await fs.writeFile(path.join(template, 'VARIATIONS.md'), variations());
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function project(name: string): Promise<string> {
    const directory = path.join(root, name);
    await fs.cp(template, directory, { recursive: true });
    return directory;
  }

  // why: successful validation must neither rerender the clone nor rewrite analysis/evidence artifacts.
  it('passes a complete measured blueprint without changing any project bytes', async () => {
    const directory = await project('valid');
    const before = await hashTree(directory);
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(result.stdout) as DesignValidationReport;
    expect(report.status).toBe('pass');
    expect(report.measurements.every((measurement) => measurement.status === 'pass')).toBe(true);
    expect(await hashTree(directory)).toEqual(before);
  });

  // why: cloning can change after a report is written; those stored clone values must become stale.
  it('rejects stale clone measurements while keeping reference-only analysis valid', async () => {
    const directory = await project('stale-clone');
    await fs.writeFile(path.join(directory, 'clone/extra.css'), 'h1{color:red}');
    const reference = await runCli(['validate-design', directory, '--json']);
    expect(reference.code, reference.stdout).toBe(0);
    await fs.writeFile(path.join(directory, 'DESIGN.md'), design([...DEFAULT_ROWS,
      '| observed-clone | desktop | 1440x900 | dl-1 | styles.fontWeight | 700 | unitless | 0 |']));
    const stale = await runCli(['validate-design', directory, '--json']);
    expect(stale.code).toBe(1);
    expect(JSON.parse(stale.stdout).status).toBe('unverified');
    expect(stale.stdout).toContain('clone changed');
  });

  // why: a cached source ID and plausible number cannot legitimize a modified source snapshot.
  it('marks modified source assets unverified', async () => {
    const directory = await project('source-file');
    await fs.appendFile(path.join(directory, 'evidence/desktop/index.html'), '<p>changed</p>');
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe('unverified');
    expect(result.stdout).toContain('hash mismatch');
  });

  // why: inline observations are protected by the capture manifest baseline, not just asset hashes.
  it('marks changed source measurements unverified', async () => {
    const directory = await project('source-observation');
    const file = path.join(directory, 'evidence.json');
    const source = JSON.parse(await fs.readFile(file, 'utf8')) as ReturnType<typeof evidence>;
    source.captures[0].observations.rootFontSize = '20px';
    await fs.writeFile(file, JSON.stringify(source));
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe('unverified');
    expect(result.stdout).toContain('established baseline');
  });

  // why: formatted design prose must not mask a measured numerical claim that disagrees with evidence.
  it('fails fabricated measurements with their line number and expected value', async () => {
    const directory = await project('bad-claim');
    await fs.writeFile(path.join(directory, 'DESIGN.md'), design([DEFAULT_ROWS[0].replace('| 320 |', '| 999 |'), ...DEFAULT_ROWS.slice(1)]));
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe('fail');
    expect(result.stdout).toContain('expected 320 px');
    expect(result.stdout).toContain('line ');
  });

  // why: source-backed analysis is independent of an unreadable optional clone-comparison report.
  it('retains valid manifest-anchored reference claims when the clone report is unreadable', async () => {
    const directory = await project('broken-clone-report');
    await fs.writeFile(path.join(directory, 'fidelity.json'), '{broken');
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code, result.stdout).toBe(0);
  });

  // why: legacy evidence without a capture anchor cannot establish trustworthy numeric design claims.
  it('marks evidence without an established baseline unverified', async () => {
    const directory = await project('no-anchor');
    await fs.unlink(path.join(directory, 'manifest.json'));
    await fs.unlink(path.join(directory, 'fidelity.json'));
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe('unverified');
  });

  // why: a missing direction document is an incomplete deliverable, not a successful design review.
  it('fails missing artifacts and reserves stdout for --json', async () => {
    const directory = await project('missing-variations');
    await fs.unlink(path.join(directory, 'VARIATIONS.md'));
    const result = await runCli(['validate-design', directory]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('VARIATIONS.md is missing');
  });
});
