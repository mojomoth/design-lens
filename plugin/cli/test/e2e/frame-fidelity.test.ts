import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as cheerio from 'cheerio';
import { expect, it } from 'vitest';

import { runFidelity } from '../../src/analyze/fidelity.js';
import { readEvidence } from '../../src/capture/evidence.js';
import { runClone } from '../../src/commands/clone.js';
import { startStaticServer } from '../../src/lib/static-server.js';

// A tiny required image in a large frame fits below both page and frame pixel tolerances. Without
// scoped frame observations, neither a healthy capture nor this damaged clone may claim a pass.
it('preserves an editable iframe while explicitly withholding unmeasured child fidelity', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-frame-fidelity-'));
  const source = path.join(directory, 'source');
  await fs.mkdir(source);
  const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>')}`;
  const frame = `<html><head><style>body{margin:0;background:white}</style></head><body><img id="tiny-logo" width="10" height="10" src="${svg}"></body></html>`;
  const escaped = frame.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  await fs.writeFile(path.join(source, 'index.html'), `<!doctype html><html><head><style>
    body{margin:0;background:white}iframe{width:800px;height:600px;border:0;display:block}
    </style></head><body><iframe srcdoc="${escaped}"></iframe></body></html>`);
  const server = await startStaticServer(source);
  try {
    const captured = await runClone(server.url('/index.html'), {
      out: directory, project: 'capture', viewport: { width: 800, height: 600 }, dsf: 1,
      timeoutMs: 30_000, settleMs: 0, removeSelectors: [], noScroll: true,
      blockCookies: false, maxAssetBytes: 25 * 1024 * 1024, includeMedia: false,
    });
    expect(captured.fidelity).toBe('unverified');
    const evidence = await readEvidence(captured.projectDir);
    expect(evidence.captures[0].complete).toBe(false);
    expect(evidence.captures[0].warnings.join(' ')).toContain('frame-scoped element and font coverage is unverified');
    const index = path.join(captured.projectDir, 'clone/index.html');
    const $ = cheerio.load(await fs.readFile(index, 'utf8'));
    const child = cheerio.load($('iframe').attr('srcdoc')!);
    expect(child('#tiny-logo')).toHaveLength(1);
    child('#tiny-logo').remove();
    $('iframe').attr('srcdoc', child.html());
    await fs.writeFile(index, $.html());
    const damaged = await runFidelity(captured.projectDir);
    expect(damaged.report.status).toBe('unverified');
    expect(damaged.report.captures[0].issues.join(' ')).toContain('frame-scoped');
    expect(await readEvidence(captured.projectDir)).toEqual(evidence);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
