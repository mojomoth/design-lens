import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvidenceDocument } from '../../src/capture/evidence.js';
import type { FidelityReport } from '../../src/analyze/fidelity.js';
import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/sites/fidelity-study/', import.meta.url));
function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE, ...args]);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
function diagnostics(report: FidelityReport): string {
  return JSON.stringify({ issues: report.issues, captures: report.captures.map((capture) => ({
    viewport: capture.viewport, status: capture.status, issues: capture.issues,
    full: capture.fullImage, view: capture.viewportImage,
    elements: capture.elements.filter((element) => element.status !== 'pass').slice(0, 8),
  })) });
}

// why: single-viewport inspection cannot prove preservation of source CSS/JS responsive states.
// These exercise the built capture pipeline, immutable evidence, and one automatically composed editable HTML.
describe('source-to-clone responsive fidelity', () => {
  let root: string; let server: StaticServer;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-responsive-capture-'));
    server = await startStaticServer(FIXTURE);
  });
  afterAll(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });

  async function clone(name: string): Promise<string> {
    const result = await cli(['clone', server.url(`/${name}.html`), '--out', root, '--project', name,
      '--viewports', '1440x900,768x1024,390x844', '--settle', '0', '--no-scroll', '--no-block-cookies']);
    expect(result.code, result.stderr).toBe(0);
    return (JSON.parse(result.stdout) as { projectDir: string }).projectDir;
  }

  for (const name of ['marketing', 'editorial', 'dashboard', 'components']) {
    it(`preserves ${name} pixels and measured regions across three independent source loads`, async () => {
      const dir = await clone(name);
      const evidence = JSON.parse(await fs.readFile(path.join(dir, 'evidence.json'), 'utf8')) as EvidenceDocument;
      const report = JSON.parse(await fs.readFile(path.join(dir, 'fidelity.json'), 'utf8')) as FidelityReport;
      expect(evidence.captures.map((capture) => capture.viewport.width)).toEqual([1440, 768, 390]);
      expect(evidence.captures.every((capture) => capture.complete), JSON.stringify(evidence.captures.map((capture) => capture.warnings))).toBe(true);
      expect(report.status, diagnostics(report)).toBe('pass');
      const sourceFile = path.join(dir, evidence.captures[0].snapshot);
      const before = await fs.readFile(sourceFile, 'utf8');
      await fs.appendFile(path.join(dir, 'clone/assets/dl-overrides.css'), '\nbody { color: red; }\n');
      expect(await fs.readFile(sourceFile, 'utf8')).toBe(before);
      const changed = await cli(['fidelity', dir, '--json']);
      expect(changed.code).toBe(1);
      expect((JSON.parse(changed.stdout) as FidelityReport).cloneHash).not.toBe(report.cloneHash);
    });
  }

  it('preserves JS mobile structure automatically and rejects removed menu or image content', async () => {
    const dir = await clone('responsive');
    const originalEvidence = await fs.readFile(path.join(dir, 'evidence.json'), 'utf8');
    const evidence = JSON.parse(originalEvidence) as EvidenceDocument;
    const sourceFiles = await Promise.all(evidence.captures.map(async (capture) => ({
      snapshot: capture.snapshot, bytes: await fs.readFile(path.join(dir, capture.snapshot)),
    })));
    const before = JSON.parse(await fs.readFile(path.join(dir, 'fidelity.json'), 'utf8')) as FidelityReport;
    expect(before.status, diagnostics(before)).toBe('pass');
    expect(before.captures.every((capture) => capture.status === 'pass')).toBe(true);
    const mobileCapture = evidence.captures.find((capture) => capture.viewport.width === 390)!;
    const htmlPath = path.join(dir, 'clone/index.html');
    const intactHtml = await fs.readFile(htmlPath, 'utf8');
    for (const selector of ['button', 'img.logo']) {
      const $ = cheerio.load(intactHtml, { xml: { xmlMode: false } });
      const host = $(`[data-dl-generated="host"][data-dl-source-capture="${mobileCapture.id}"]`);
      const removed = host.find(selector);
      expect(removed.length, selector).toBe(1);
      removed.remove();
      await fs.writeFile(htmlPath, $.html());
      const after = await cli(['fidelity', dir, '--json']);
      const report = JSON.parse(after.stdout) as FidelityReport;
      expect(after.code, diagnostics(report)).toBe(1);
      expect(report.status, diagnostics(report)).toBe('fail');
      expect(report.captures.find((capture) => capture.viewport.width === 390)?.status).toBe('fail');
      expect(report.captures.filter((capture) => capture.viewport.width !== 390).every((capture) => capture.status === 'pass'), diagnostics(report)).toBe(true);
      expect(await fs.readFile(path.join(dir, 'evidence.json'), 'utf8')).toBe(originalEvidence);
      for (const source of sourceFiles) {
        expect(await fs.readFile(path.join(dir, source.snapshot))).toEqual(source.bytes);
      }
    }
    await fs.writeFile(htmlPath, intactHtml);
    const restored = await cli(['fidelity', dir, '--json']);
    expect(restored.code, restored.stdout).toBe(0);
  });

  it('rejects ambiguous viewport options before navigating', async () => {
    const result = await cli(['clone', server.url('/marketing.html'), '--viewport', '1440x900', '--viewports', '390x844']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--viewport and --viewports cannot be used together');
    expect(result.stdout).toBe('');
  });
});
