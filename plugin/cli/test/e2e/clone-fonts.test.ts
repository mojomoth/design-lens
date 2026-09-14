import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { startStaticServer } from '../../src/lib/static-server.js';

const exec = promisify(execFile);
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));

// why: a font can be downloaded and localized successfully yet fail to decode in Chromium.
// If the clone renderer only prints that warning, reverse-design sees a clean saved report and
// mistakes fallback geometry for the reference's intended typography. Exercise the built CLI.
it('retains clone-render font failures in the report and warning count', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-font-report-'));
  const site = path.join(root, 'site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'broken.woff2'), 'invalid font bytes');
  fs.writeFileSync(path.join(site, 'index.html'), `<!doctype html><html><head><style>
    @font-face { font-family: BrokenEvidence; src: url('./broken.woff2') format('woff2'); }
    body { font-family: BrokenEvidence, sans-serif; }
  </style></head><body><h1>Font evidence</h1></body></html>`);
  const server = await startStaticServer(site);
  try {
    const result = await exec(process.execPath, [BUNDLE, 'clone', server.url('/index.html'),
      '--out', path.join(root, 'output'), '--project', 'font-check',
      '--no-block-cookies', '--no-scroll', '--settle', '0'], {
      cwd: root,
      env: { ...process.env, DESIGN_LENS_HOME: path.join(root, 'runtime') },
    });
    const output = JSON.parse(result.stdout) as { projectDir: string; warnings: number };
    const manifest = JSON.parse(fs.readFileSync(path.join(output.projectDir, 'manifest.json'), 'utf8')) as {
      stats: { warnings: number };
    };
    const report = fs.readFileSync(path.join(output.projectDir, 'REPORT.md'), 'utf8');
    expect(result.stderr).toContain('failed font families');
    expect(report).toContain('clone render: failed font families');
    expect(report).toContain('BrokenEvidence');
    expect(output.warnings).toBeGreaterThan(0);
    expect(manifest.stats.warnings).toBe(output.warnings);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
