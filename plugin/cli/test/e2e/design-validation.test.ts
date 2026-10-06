import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evidenceHash, hashTree, sha256 } from '../../src/capture/evidence.js';
import { parseBuildContract } from '../../src/analyze/build-contract.js';
import type { DesignValidationReport } from '../../src/analyze/design-validation.js';
import { hashReviewProof, reviewProofValue } from '../../src/analyze/qa-review.js';
import { DEFAULT_ROWS, design, evidence, fidelityTable, toneReport, TYPEFACE_ROWS, variations } from '../fixtures/design-validation-fixture.js';

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
    const tone = toneReport(source);
    tone.captures[0].image = { path: 'evidence/desktop/full.png', sha256: sha256(pixel), width: 1, height: 1 };
    await fs.writeFile(path.join(template, 'tone.json'), JSON.stringify(tone));
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

  // why: source correspondence edits change comparison meaning even when clone bytes stay intact.
  it('rejects stale clone claims after composition metadata changes', async () => {
    const directory = await project('stale-composition');
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.composition = { schemaVersion: 1, warnings: [] };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const fidelityPath = path.join(directory, 'fidelity.json');
    const saved = JSON.parse(await fs.readFile(fidelityPath, 'utf8'));
    saved.compositionHash = sha256(JSON.stringify(manifest.composition));
    await fs.writeFile(fidelityPath, JSON.stringify(saved));
    await fs.writeFile(path.join(directory, 'DESIGN.md'), design([...DEFAULT_ROWS,
      '| observed-clone | desktop | 1440x900 | dl-1 | styles.fontWeight | 700 | unitless | 0 |']));
    const before = await runCli(['validate-design', directory, '--json']);
    expect(before.code, before.stdout).toBe(0);
    manifest.composition.warnings.push('root style transformation incomplete');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const stale = await runCli(['validate-design', directory, '--json']);
    expect(stale.code, stale.stdout).toBe(1);
    expect(JSON.parse(stale.stdout).status).toBe('unverified');
    expect(stale.stdout).toContain('responsive composition changed');
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

  // why: the experiment's display face was recorded as a family name only; the bundle must reject that and a missing display row.
  it('fails a typeface table without a display row or with family-only form features', async () => {
    const directory = await project('typeface-forms');
    const familyOnly = design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('Closed apertures, uniform stroke, flat terminals, upright caps', '"Arial"')] });
    await fs.writeFile(path.join(directory, 'DESIGN.md'), familyOnly);
    await fs.writeFile(path.join(directory, 'VARIATIONS.md'), variations(familyOnly));
    const named = await runCli(['validate-design', directory, '--json']);
    expect(named.code).toBe(1);
    const namedReport = JSON.parse(named.stdout) as DesignValidationReport;
    expect(namedReport.checks.find((check) => check.id.startsWith('typeface:line-'))?.detail).toContain('only names the family Arial');
    const bodyOnly = design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('| Display heading |', '| Body copy |')] });
    await fs.writeFile(path.join(directory, 'DESIGN.md'), bodyOnly);
    await fs.writeFile(path.join(directory, 'VARIATIONS.md'), variations(bodyOnly));
    const noDisplay = await runCli(['validate-design', directory, '--json']);
    expect(noDisplay.code).toBe(1);
    const noDisplayReport = JSON.parse(noDisplay.stdout) as DesignValidationReport;
    expect(noDisplayReport.checks.find((check) => check.id === 'typeface-forms')).toMatchObject({ status: 'fail' });
    expect(noDisplayReport.checks.find((check) => check.id === 'typeface-forms')?.detail).toContain('Role names the display face');
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

  // why: tone.json must describe the saved screenshots; a profile of other pixels cannot verify tone rows.
  it('marks tone.json with a foreign screenshot hash unverified', async () => {
    const directory = await project('foreign-tone');
    const file = path.join(directory, 'tone.json');
    const tone = JSON.parse(await fs.readFile(file, 'utf8'));
    tone.captures[0].image.sha256 = 'f'.repeat(64);
    await fs.writeFile(file, JSON.stringify(tone));
    const result = await runCli(['validate-design', directory, '--json']);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout) as DesignValidationReport;
    expect(report.status).toBe('unverified');
    expect(report.checks.find((check) => check.id === 'tone-report')?.detail).toContain('run design-lens tone');
  });

  // why: reference fidelity is bound to the newest saved QA run and its confirmed review (a hand-written review.json
  // without the code-derived proof is not a confirmation), read from disk without writing.
  it('binds reference fidelity to the newest confirmed QA run on disk', async () => {
    const directory = await project('qa-runs');
    const run = 'qa-1700000000000-0123abcd';
    await fs.writeFile(path.join(directory, 'VARIATIONS.md'), variations(design(), { extra: fidelityTable(run) }));
    await fs.mkdir(path.join(directory, 'qa', run), { recursive: true });
    const proof = reviewProofValue(['ABC234', 'XYZ789']);
    const salt = '00112233445566778899aabbccddeeff';
    const qa = Buffer.from(JSON.stringify({
      schemaVersion: 1, status: 'pass', project: directory, skipped: [], signatureChecks: [{ rank: 2, pass: true }, { rank: 3, pass: true }],
      review: { images: [], proof: { salt, hash: hashReviewProof(proof, salt) } },
    }));
    await fs.writeFile(path.join(directory, 'qa', run, 'qa.json'), qa);
    await fs.writeFile(path.join(directory, 'qa', run, 'review.json'), JSON.stringify({ schemaVersion: 1, qaSha256: sha256(qa), confirmed: true, images: 2 }));
    const handWritten = await runCli(['validate-design', directory, '--json']);
    expect(handWritten.code).toBe(1);
    expect(handWritten.stdout).toContain('run design-lens qa-confirm');
    await fs.writeFile(path.join(directory, 'qa', run, 'review.json'), JSON.stringify({ schemaVersion: 1, qaSha256: sha256(qa), confirmed: true, images: 2, proof }));
    const before = await hashTree(directory);
    const confirmed = await runCli(['validate-design', directory, '--json']);
    expect(confirmed.code, confirmed.stdout).toBe(0);
    expect((JSON.parse(confirmed.stdout) as DesignValidationReport).referenceFidelity).toEqual({ required: true, score: 0.967, qaRun: run });
    expect(await hashTree(directory)).toEqual(before);
    await fs.appendFile(path.join(directory, 'qa', run, 'qa.json'), '\n');
    const edited = await runCli(['validate-design', directory, '--json']);
    expect(edited.code).toBe(1);
    expect(edited.stdout).toContain('run design-lens qa-confirm');
    await fs.writeFile(path.join(directory, 'qa', run, 'qa.json'), qa);
    await fs.mkdir(path.join(directory, 'qa', 'qa-1800000000000-89abcdef'));
    await fs.writeFile(path.join(directory, 'qa', 'qa-1800000000000-89abcdef', 'qa.json'), qa);
    const newer = await runCli(['validate-design', directory, '--json']);
    expect(newer.code).toBe(1);
    expect(JSON.parse(newer.stdout).status).toBe('fail');
    expect(newer.stdout).toContain('a newer QA run exists');
    await fs.rm(path.join(directory, 'qa', 'qa-1800000000000-89abcdef'), { recursive: true });
    const unbound = Buffer.from(JSON.stringify({ schemaVersion: 1, status: 'pass', project: null, skipped: [], signatureChecks: [], review: { images: [], proof: { salt, hash: hashReviewProof(proof, salt) } } }));
    await fs.writeFile(path.join(directory, 'qa', run, 'qa.json'), unbound);
    await fs.writeFile(path.join(directory, 'qa', run, 'review.json'), JSON.stringify({ schemaVersion: 1, qaSha256: sha256(unbound), confirmed: true, images: 2, proof }));
    const withoutProject = await runCli(['validate-design', directory, '--json']);
    expect(withoutProject.code).toBe(1);
    expect(withoutProject.stdout).toContain('ran without --project');
  });

  // why: the cited run must have checked the Build contract VARIATIONS.md states now; a contract edited after qa
  // (mode, selectors) kept passing with fidelity verdicts measured against the old contract.
  it('fails reference fidelity whose QA run checked an older Build contract', async () => {
    const directory = await project('qa-contract');
    const run = 'qa-1700000000000-4567cdef';
    const document = variations(design(), { extra: fidelityTable(run) });
    await fs.writeFile(path.join(directory, 'VARIATIONS.md'), document);
    await fs.mkdir(path.join(directory, 'qa', run), { recursive: true });
    const contract = parseBuildContract(document).contract!;
    const proof = reviewProofValue(['ABC234']);
    const salt = 'ffeeddccbbaa99887766554433221100';
    const write = async (checked: typeof contract): Promise<void> => {
      const qa = Buffer.from(JSON.stringify({
        schemaVersion: 1, status: 'pass', project: directory, mode: checked.mode, contract: checked, skipped: [], signatureChecks: [{ rank: 2, pass: true }, { rank: 3, pass: true }],
        review: { images: [], proof: { salt, hash: hashReviewProof(proof, salt) } },
      }));
      await fs.writeFile(path.join(directory, 'qa', run, 'qa.json'), qa);
      await fs.writeFile(path.join(directory, 'qa', run, 'review.json'), JSON.stringify({ schemaVersion: 1, qaSha256: sha256(qa), confirmed: true, images: 1, proof }));
    };
    await write(contract);
    const current = await runCli(['validate-design', directory, '--json']);
    expect(current.code, current.stdout).toBe(0);
    await write({ ...contract, checks: contract.checks.map((item) => ({ ...item, selector: 'main button' })) });
    const stale = await runCli(['validate-design', directory, '--json']);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain(`the Build contract changed after qa/${run}; rerun qa and cite the new run`);
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
