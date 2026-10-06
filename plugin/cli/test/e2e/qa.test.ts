/**
 * WHY this suite exists: `qa` is the build gate for the defects screenshots alone missed in the 4-way experiment
 * (dead span tabs, `#footer` stand-in links, a fixed button over a CTA, a white-square icon, a masked 5 px card
 * overflow and invented numbers). Every in-page probe is minified into the bundle, so only a spawned `dist` run
 * proves the probes still work. The qa-study fixture reproduces the experiment markup exactly.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { QaReport } from '../../src/analyze/qa-run.js';
import type { BuildLineage } from '../../src/analyze/qa-lineage.js';
import { startStaticServer } from '../../src/lib/static-server.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const SITE = fileURLToPath(new URL('../fixtures/sites/qa-study', import.meta.url));
const CONTENT = path.join(SITE, 'CONTENT.md');

interface CliResult { code: number; stdout: string; stderr: string }

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], { cwd, env: { ...process.env, DESIGN_LENS_HOME: path.join(cwd, '.home') } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readReport(out: string): Promise<QaReport> {
  return JSON.parse(await fs.readFile(path.join(out, 'qa.json'), 'utf8')) as QaReport;
}

function findings(report: QaReport, check: string): QaReport['viewports'][number]['findings'] {
  return report.viewports.flatMap((viewport) => viewport.findings.filter((finding) => finding.check === check));
}

let root: string;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-qa-e2e-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('qa on the defective study page', () => {
  let run: CliResult;
  let report: QaReport;
  let out: string;

  beforeAll(async () => {
    out = path.join(root, 'defective');
    run = await runCli(['qa', '--dir', path.join(SITE, 'defective'), '--content', CONTENT, '--brand', 'Acme Labs', '--viewports', '390x844', '--out', out], root);
    report = await readReport(out);
  });

  // why: the run must fail with every defect class of the fixture; dropping any probe from the bundle (or breaking
  // its self-contained page function) removes its check id here.
  it('fails with each defect check id', () => {
    expect(run.code, run.stderr).toBe(1);
    expect(report.status).toBe('fail');
    const ids = new Set(report.viewports[0].findings.filter((finding) => finding.severity === 'fail').map((finding) => finding.check));
    for (const id of ['dead-control', 'stand-in-link', 'fixed-overlap', 'clipped-content', 'solid-icon', 'unsourced-number', 'broken-image', 'request-failed', 'brand-residue']) {
      expect(ids, id).toContain(id);
    }
    const warns = new Set(report.viewports[0].findings.filter((finding) => finding.severity === 'warn').map((finding) => finding.check));
    expect(warns).toContain('inaccessible-control');
    expect(warns).toContain('console-error');
    const stdout = JSON.parse(run.stdout) as { status: string; out: string; counts: { fail: number; warn: number }; review: string[] };
    expect(run.stdout.endsWith('\n') && run.stdout.trim().split('\n')).toHaveLength(1);
    expect(stdout).toMatchObject({ status: 'fail', out, counts: report.counts });
    expect(run.stderr).toContain('design-lens: fail dead-control 390x844');
  });

  // why: these are the experiment's false negatives; each assertion pins the rule that catches it.
  it('catches the experiment defects precisely', () => {
    const dead = findings(report, 'dead-control').map((finding) => finding.selector);
    expect(dead).toEqual([
      'section#news > div.filter-list:nth-of-type(1) > span:nth-of-type(2)',
      'section#news > div.filter-list:nth-of-type(1) > span:nth-of-type(3)',
      'section#news > div.filter-list.pointer:nth-of-type(2) > span:nth-of-type(2)',
      'section#news > div.filter-list.pointer:nth-of-type(2) > span:nth-of-type(3)',
    ]);
    expect(findings(report, 'inaccessible-control').map((finding) => finding.selector)).toEqual(['section#news > span.like']);
    // The per-viewport summary makes clean control results auditable (every clicked candidate is live or dead).
    const controls = report.viewports[0].controls;
    expect(controls.dead).toBe(4);
    expect(controls.clicked).toBe(controls.live + controls.dead);
    expect(controls.candidates).toBe(controls.clicked + controls.skipped);
    expect(findings(report, 'console-error').map((finding) => finding.detail)).toContainEqual(expect.stringMatching(/^qa-study: deliberate console error \(at \/app\.js:11:\d+\)$/));
    const standIn = findings(report, 'stand-in-link').map((finding) => finding.detail);
    expect(standIn).toContain('5 distinct labels share the in-page target #footer: "privacy", "terms", "email policy", "directions", "sitemap"');
    expect(standIn.some((detail) => detail.includes('E-BOOK ↗'))).toBe(true);
    expect(standIn.some((detail) => detail.startsWith('href="#" goes nowhere'))).toBe(true);
    expect(report.viewports[0].links).toEqual({ total: 9, inPage: 8, standIn: 7 });
    const overlap = findings(report, 'fixed-overlap');
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toMatchObject({ severity: 'fail', selector: 'body > header.hero > a.cta' });
    expect(overlap[0].detail).toContain('coveredRatio 0.177');
    expect(overlap[0].detail).not.toContain('centre');
    expect(findings(report, 'clipped-content').map((finding) => [finding.severity, finding.detail.split(' past')[0]])).toEqual([
      ['fail', 'extends 5px (1.3% of its 377px width)'], ['fail', 'extends 5px (1.3% of its 377px width)'],
    ]);
    expect(findings(report, 'horizontal-overflow')).toEqual([]);
    expect(findings(report, 'solid-icon').map((finding) => finding.selector)).toEqual(['section#program > div.step-icon:nth-of-type(2) > img']);
    expect(findings(report, 'unsourced-number').map((finding) => `${finding.severity}:${finding.text}`)).toEqual([
      'fail:09 MONTHS', 'fail:11 MONTHS', 'fail:11기', 'fail:15기',
    ]);
  });

  // why: qa.json is the artifact validate-design and qa-confirm read; its shape and paths are part of the contract.
  it('writes screenshots, tone, review images and a complete qa.json', async () => {
    const viewport = report.viewports[0];
    expect(viewport).toMatchObject({ viewport: '390x844', screenshots: { viewport: 'screenshots/390x844-viewport.png', full: 'screenshots/390x844-full.png' }, referenceTone: null });
    expect(viewport.tone?.darkUsage).toBeDefined();
    expect(viewport.fonts.status).toBe('ready');
    expect(Object.keys(viewport.timings)).toEqual(expect.arrayContaining(['navigate', 'probes', 'screenshots', 'controls', 'total']));
    for (const file of [viewport.screenshots.viewport!, viewport.screenshots.full!]) await expect(fs.stat(path.join(out, file))).resolves.toBeTruthy();
    expect(report).toMatchObject({ schemaVersion: 1, dir: path.join(SITE, 'defective'), project: null, mode: null, lineage: null, contract: null, signatureChecks: [] });
    expect(report.content).toEqual([{ path: CONTENT, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(report.review.images.length).toBeGreaterThan(0);
    expect(report.review.proof).toEqual({ salt: expect.stringMatching(/^[0-9a-f]{32}$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    for (const image of report.review.images) {
      expect(image).toMatchObject({ kind: 'tile', viewport: '390x844', salt: expect.stringMatching(/^[0-9a-f]{32}$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      await expect(fs.stat(path.join(out, image.path))).resolves.toBeTruthy();
    }
    const stdout = JSON.parse(run.stdout) as { review: string[] };
    expect(stdout.review).toEqual(report.review.images.map((image) => path.join(out, image.path)));
  });

  // why: a wrong code must never mark the run reviewed, and the failure must not reveal the expected codes.
  it('qa-confirm rejects wrong codes and writes nothing', async () => {
    const codes = report.review.images.map(() => 'AAAAAA').join(',');
    const result = await runCli(['qa-confirm', out, '--codes', codes], root);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`matched 0 of ${report.review.images.length} review images; unconfirmed: ${report.review.images[0].path}`);
    await expect(fs.access(path.join(out, 'review.json'))).rejects.toThrow();
  });
});

describe('qa on the clean study page', () => {
  // why: a correct build with its content file must pass (exit 0); otherwise qa could never gate a release.
  it('passes and prints the whole report with --json', async () => {
    const out = path.join(root, 'clean');
    const result = await runCli(['qa', '--dir', path.join(SITE, 'clean'), '--content', CONTENT, '--viewports', '390x844', '--out', out, '--json'], root);
    expect(result.code, result.stderr).toBe(0);
    const printed = JSON.parse(result.stdout) as QaReport;
    expect(printed).toEqual(await readReport(out));
    expect(printed.status).toBe('pass');
    expect(printed.counts).toEqual({ fail: 0, warn: 0 });
    expect(printed.skipped.filter((entry) => entry.affectsStatus)).toEqual([]);
  });

  // why: without --content numbers cannot be verified, so a clean page is unverified (exit 1), never pass.
  it('is unverified without content', async () => {
    const result = await runCli(['qa', '--dir', path.join(SITE, 'clean'), '--viewports', '390x844', '--max-clicks', '0', '--out', path.join(root, 'no-content')], root);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'unverified' });
    expect(result.stderr).toContain('skipped unsourced-number');
  });

  // why: work cut by --timeout must be listed in skipped and keep the run from passing; a silent cut would let an
  // unchecked build pass the gate.
  it('is unverified when the deadline cuts the checks', async () => {
    const out = path.join(root, 'deadline');
    const result = await runCli(['qa', '--dir', path.join(SITE, 'clean'), '--content', CONTENT, '--viewports', '390x844', '--timeout', '1', '--out', out], root);
    expect(result.code).toBe(1);
    const report = await readReport(out);
    expect(report.status).toBe('unverified');
    expect(report.skipped.filter((entry) => entry.affectsStatus).map((entry) => entry.reason).join('\n')).toMatch(/deadline/);
  });
});

describe('qa on working interactions that mutate no DOM', () => {
  let report: QaReport;
  let code: number;

  beforeAll(async () => {
    const out = path.join(root, 'interactive');
    const result = await runCli(['qa', '--dir', path.join(SITE, 'interactive'), '--content', CONTENT, '--viewports', '390x844', '--max-clicks', '10', '--out', out], root);
    code = result.code;
    report = await readReport(out);
  });

  // why: a carousel button that only scrolls its track and a popover button change no DOM and no pixels
  // inside their own box; counting only mutations and clip pixels called both working controls dead.
  it('does not call scroll or popover controls dead', () => {
    expect(findings(report, 'dead-control')).toEqual([]);
  });

  // why: hash-routed SPAs link to #/about; a route is a destination, while an unscripted #id into a shadow
  // root really goes nowhere and must say why (a scripted one that scrolls must pass).
  it('accepts hash routes and scripted shadow links but explains an unreachable shadow target', () => {
    const standIn = findings(report, 'stand-in-link');
    expect(standIn.map((finding) => finding.severity)).toEqual(['fail']);
    expect(standIn[0].detail).toContain('in-page target #notes is inside a shadow root');
    expect(code).toBe(1);
    expect(report.counts.fail).toBe(1);
  });

  // why: a fixed cookie bar or an overlay painted over an icon was photographed as a flat tone and failed
  // solid-icon although the icon renders correctly; covered icons are skipped, the rest are measured.
  it('measures icons only where they are on top', () => {
    expect(findings(report, 'solid-icon')).toEqual([]);
    expect(report.skipped.filter((entry) => entry.check === 'solid-icon').map((entry) => entry.reason)).toEqual([
      expect.stringMatching(/icon covered by .*div\.cover/),
    ]);
    expect(report.skipped.find((entry) => entry.check === 'solid-icon')?.affectsStatus).toBe(false);
  });
});

describe('qa --url on an error page', () => {
  // why: qa ignored the main document's HTTP status, so a 404 page passed (exit 0) as if it were the build.
  it('fails when the main document returns HTTP 404', async () => {
    const server = await startStaticServer(path.join(SITE, 'clean'));
    try {
      const out = path.join(root, 'not-found');
      const result = await runCli(['qa', '--url', server.url('/does-not-exist.html'), '--content', CONTENT, '--viewports', '390x844', '--max-clicks', '0', '--out', out], root);
      expect(result.code).toBe(1);
      const report = await readReport(out);
      expect(report.status).toBe('fail');
      expect(findings(report, 'navigation')).toEqual([expect.objectContaining({ severity: 'fail', detail: expect.stringContaining('main document returned HTTP 404') })]);
    } finally {
      await server.close();
    }
  });
});

describe('qa flag validation', () => {
  // why: bad flags must fail fast with empty stdout and create nothing, before a server or Chromium starts.
  it('rejects bad flags before any work', async () => {
    for (const args of [
      ['qa', '--dir', path.join(SITE, 'clean'), '--url', 'http://127.0.0.1:9/'],
      ['qa', '--dir', path.join(SITE, 'clean'), '--mode', 'derive'],
      ['qa', '--dir', path.join(SITE, 'clean'), '--max-clicks', '500'],
      ['qa', '--dir', SITE],
    ]) {
      const result = await runCli([...args, '--out', path.join(root, 'never')], root);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/^error: /);
    }
    await expect(fs.access(path.join(root, 'never'))).rejects.toThrow();
  });
});

describe('qa with --project', () => {
  let project: string;
  let build: string;

  beforeAll(async () => {
    const server = await startStaticServer(path.join(SITE, 'reference'));
    try {
      const clone = await runCli(['clone', server.url('/index.html'), '--out', path.join(root, 'projects'), '--project', 'reference',
        '--viewport', '390x844', '--no-block-cookies', '--no-scroll', '--settle', '0'], root);
      expect(clone.code, clone.stderr).toBe(0);
    } finally {
      await server.close();
    }
    project = path.join(root, 'projects', 'reference');
    build = path.join(root, 'clone-copy');
    await fs.cp(path.join(project, 'clone'), build, { recursive: true });
    await fs.writeFile(path.join(project, 'VARIATIONS.md'), [
      '# Variations', '', '## Selected direction', '- **Direction:** Variation A', '', '### Build contract',
      '| Contract | Value | Source |', '| --- | --- | --- |', '| mode | derive | build-from-design default |',
      '| fonts | Inter | Typeface forms substitutes |', '| display-fonts | Inter | Typeface forms display row |',
      '| dark-share-max | 0.5 | tone.json |', '| full-bleed-dark-max | 0.1 | tone.json |',
      '| check:1 | h1 :: font-size >= 20px | Signature priority rank 1 |', '| check:2 | .no-such-device :: count >= 1 | Signature priority rank 2 |', '',
    ].join('\n'));
  });

  // why: in derive mode a build made from clone markup is the copy-then-discard failure; lineage, reference assets,
  // reference copy and the Build contract must all be measured, and the run lands in <project>/qa/<runId>.
  it('measures lineage, reuse and the Build contract in derive mode', async () => {
    const result = await runCli(['qa', '--dir', build, '--project', project, '--max-clicks', '3'], root);
    expect(result.code).toBe(1);
    const { out } = JSON.parse(result.stdout) as { out: string };
    expect(path.relative(project, out)).toMatch(/^qa\/qa-\d+-[0-9a-f]{8}$/);
    const report = await readReport(out);
    expect(report).toMatchObject({ project, mode: 'derive', status: 'fail', contract: { mode: 'derive', fonts: ['Inter'] } });
    expect(report.viewports.map((viewport) => viewport.viewport)).toEqual(['390x844']);
    expect(findings(report, 'lineage')).toEqual([expect.objectContaining({ severity: 'fail', detail: expect.stringContaining('derived build contains clone markup ids') })]);
    expect(findings(report, 'source-asset').map((finding) => [finding.severity, finding.detail.split(': ')[1]])).toEqual(expect.arrayContaining([
      ['fail', 'reference image copied into the build'], ['fail', 'reference stylesheet copied into a derived build'],
    ]));
    expect(findings(report, 'source-text').length).toBeGreaterThan(0);
    expect(findings(report, 'font-drift').some((finding) => finding.severity === 'fail' && finding.detail.includes('h1/h2'))).toBe(true);
    expect(report.signatureChecks.map((check) => [check.rank, check.pass])).toEqual([[1, true], [2, false]]);
    expect(findings(report, 'signature-check')).toHaveLength(1);
    expect(report.viewports[0].referenceTone).toMatchObject({ captureId: expect.any(String) });
    expect(report.review.images.map((image) => image.kind)).toEqual(expect.arrayContaining(['tile', 'compare']));
    const lineage = JSON.parse(await fs.readFile(path.join(out, 'build-lineage.json'), 'utf8')) as BuildLineage;
    expect(lineage).toEqual(report.lineage);
    expect(lineage).toMatchObject({ schemaVersion: 1, mode: 'derive', build: { dlIdCount: lineage.clone.dlIdCount } });
    expect(lineage.viewports).toEqual([{ viewport: '390x844', cloneIds: lineage.clone.dlIdCount, retainedIds: lineage.clone.dlIdCount, retainedRatio: 1 }]);
  });

  // why: clone-base keeps captured markup by design: lineage must pass on retained ids, the skeleton is compared by
  // rendering the clone, and a retained stylesheet is a warning with the reuse-rights note.
  it('accepts retained markup in clone-base mode', async () => {
    const out = path.join(root, 'clone-base');
    const result = await runCli(['qa', '--dir', build, '--project', project, '--mode', 'clone-base', '--max-clicks', '3', '--out', out], root);
    expect(result.code).toBe(1);
    const report = await readReport(out);
    expect(report.mode).toBe('clone-base');
    expect(findings(report, 'lineage')).toEqual([]);
    expect(report.lineage?.viewports[0]).toMatchObject({ retainedRatio: 1, skeleton: { similarity: 1 } });
    expect(findings(report, 'source-asset')).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warn', detail: expect.stringContaining('reference stylesheet retained; rewrite it or confirm reuse rights before deploying') }),
    ]));
    expect(report.issues).toContain('--mode clone-base overrides the Build contract mode derive');
  });

  // why: a Hangul heading under a Latin-only display face renders every glyph in a system fallback while the
  // computed stack still resolves to the display family; only the CDP glyph measurement exposes it.
  it('fails display headings whose glyphs fall back to a platform font', async () => {
    const korean = path.join(root, 'projects', 'korean');
    await fs.cp(project, korean, { recursive: true });
    await fs.rm(path.join(korean, 'qa'), { recursive: true, force: true });
    const variations = await fs.readFile(path.join(project, 'VARIATIONS.md'), 'utf8');
    await fs.writeFile(path.join(korean, 'VARIATIONS.md'), variations
      .replace('| fonts | Inter | Typeface forms substitutes |', '| fonts | Codicon; Inter | Typeface forms substitutes |')
      .replace('| display-fonts | Inter | Typeface forms display row |', '| display-fonts | Codicon | Typeface forms display row |'));
    // A real font file whose cmap has no Hangul: the icon font that ships inside playwright-core.
    const viewer = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'lib', 'vite', 'traceViewer');
    const fontFile = (await fs.readdir(viewer)).find((name) => /^codicon.*\.ttf$/.test(name));
    expect(fontFile, 'playwright-core no longer ships codicon*.ttf; pick another font without Hangul').toBeDefined();
    const site = path.join(root, 'korean-build');
    await fs.mkdir(site, { recursive: true });
    await fs.copyFile(path.join(viewer, fontFile!), path.join(site, 'display.ttf'));
    await fs.writeFile(path.join(site, 'index.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>@font-face{font-family:Codicon;src:url(display.ttf)}h1{font-family:Codicon,serif}body{font-family:Inter,sans-serif}</style></head><body><h1>디자인 연구소</h1></body></html>');
    const out = path.join(root, 'korean-run');
    const result = await runCli(['qa', '--dir', site, '--project', korean, '--content', CONTENT, '--max-clicks', '0', '--out', out], root);
    expect(result.code).toBe(1);
    const report = await readReport(out);
    expect(report.viewports[0].resolvedFonts.map((use) => use.family)).toContain('Codicon');
    expect(findings(report, 'font-drift')).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'fail', selector: 'body > h1', detail: expect.stringMatching(/glyphs in 1 h1\/h2 heading\(s\) resolved to display font "Codicon" render in platform fallback font/) }),
    ]));
  });

  // why: `stylesheets: rewritten` was an unchecked self-description; a composed clone inlines its captured CSS
  // as style[data-dl-captured-styles], which matched no reference file hash, so qa never noticed it was kept.
  it('fails a clone-base build that claims rewritten stylesheets but keeps captured style blocks', async () => {
    const claimed = path.join(root, 'projects', 'rewritten');
    await fs.cp(project, claimed, { recursive: true });
    await fs.rm(path.join(claimed, 'qa'), { recursive: true, force: true });
    const variations = await fs.readFile(path.join(project, 'VARIATIONS.md'), 'utf8');
    await fs.writeFile(path.join(claimed, 'VARIATIONS.md'), variations.replace('| mode | derive | build-from-design default |', '| mode | clone-base | User asked to build on the clone |\n| stylesheets | rewritten | rewritten for the target |'));
    const kept = path.join(root, 'kept-styles');
    await fs.cp(build, kept, { recursive: true });
    const index = path.join(kept, 'index.html');
    await fs.writeFile(index, (await fs.readFile(index, 'utf8')).replace('</head>', '<style data-dl-captured-styles="viewport-390x844">h1{letter-spacing:0}</style></head>'));
    const out = path.join(root, 'kept-styles-run');
    const result = await runCli(['qa', '--dir', kept, '--project', claimed, '--max-clicks', '0', '--out', out], root);
    expect(result.code).toBe(1);
    const report = await readReport(out);
    expect(report.mode).toBe('clone-base');
    expect(findings(report, 'source-asset')).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'fail', selector: 'style[data-dl-captured-styles]', detail: expect.stringContaining('the Build contract says stylesheets rewritten, but 1 captured reference style block(s)') }),
    ]));
    expect(report.lineage?.build.capturedStyleBlocks).toBe(1);
  });
});
