/// <reference lib="dom" />

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';

import type { FidelityReport } from '../../src/analyze/fidelity.js';
import type { SourceCapture } from '../../src/capture/evidence.js';
import type { PlaywrightModule } from '../../src/capture/browser.js';
import { loadRuntimeDep } from '../../src/lib/runtime-deps.js';
import { startStaticServer } from '../../src/lib/static-server.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:white;color:#101010;font-family:Arial,sans-serif}
header{height:80px;display:flex;align-items:center;padding:24px;gap:24px}img{width:12px;height:12px}
h1{margin:30px 24px;font-size:32px;line-height:40px}p{margin:24px;line-height:24px}
.desktop{display:block}.mobile{display:none}article{height:1100px;margin:24px;background:#eee}
.pseudo-brand{display:flex;width:12px;height:12px}.pseudo-brand::before{content:'';display:block;width:12px;height:12px;background:#d90000}
.url-brand{display:flex;width:12px;height:12px}.url-brand::before{content:url('./pseudo.svg');display:block;width:12px;height:12px}
@media(max-width:600px){.desktop{display:none}.mobile{display:block}h1{font-size:24px;line-height:32px}}
</style></head><body>
<header data-dl-id="dl-1"><img data-dl-id="dl-2" alt="Mark" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Cpath fill='red' d='M0 0h12v12H0z'/%3E%3C/svg%3E"><div data-dl-id="dl-8" class="pseudo-brand"></div><div data-dl-id="dl-9" class="url-brand"></div><nav data-dl-id="dl-3" class="desktop">Read issue</nav><nav data-dl-id="dl-4" class="mobile">Menu</nav></header>
<h1 data-dl-id="dl-5">Exact measured typography</h1><p data-dl-id="dl-6">A responsive reference with a small mark.</p><article data-dl-id="dl-7"></article>
</body></html>`;
const PSEUDO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path fill="#0055ee" d="M0 0h12v12H0z"/></svg>';

function hash(bytes: string | Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

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

describe('offline fidelity against an independently rendered fixture', () => {
  let root: string;
  let template: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-fidelity-'));
    template = path.join(root, 'template');
    await fs.mkdir(path.join(template, 'clone'), { recursive: true });
    await fs.writeFile(path.join(template, 'clone/index.html'), HTML);
    await fs.writeFile(path.join(template, 'clone/pseudo.svg'), PSEUDO_SVG);
    const server = await startStaticServer(path.join(template, 'clone'));
    let browser: Browser | undefined;
    try {
      browser = await loadRuntimeDep<PlaywrightModule>('playwright').chromium.launch({ headless: true });
      const captures: SourceCapture[] = [];
      for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
        const id = `v${viewport.width}`;
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
        const page = await context.newPage();
        await page.goto(server.url('/index.html'), { waitUntil: 'load' });
        await page.evaluate(async () => { await document.fonts.ready; });
        // Fixture evidence intentionally uses its own small probe instead of the production probe.
        const observed = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('[data-dl-id]')).map((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            const tag = element.tagName.toLowerCase();
            const roles: Record<string, string> = { header: 'header', img: 'image', nav: 'navigation', h1: 'heading', p: 'paragraph', article: 'article', div: 'flex' };
            const ancestors: string[] = [];
            let node: Element | null = element;
            while (node && node !== document.body) {
              const parent: Element | null = node.parentElement;
              const peers: Element[] = parent ? Array.from(parent.children).filter((peer) => peer.tagName === node?.tagName) : [];
              ancestors.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node) + 1})`);
              node = parent;
            }
            const image = element instanceof HTMLImageElement ? element : null;
            const pseudo = (side: string): { content: string; styles: Record<string, string> } => {
              const observed = getComputedStyle(element, side);
              return { content: observed.content, styles: { display: observed.display, visibility: observed.visibility, opacity: observed.opacity, backgroundColor: observed.backgroundColor } };
            };
            return {
              dlId: element.getAttribute('data-dl-id')!, tag, semantic: roles[tag],
              text: ((element as HTMLElement).innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim(),
              domPath: `body>${ancestors.join('>')}`, rootPath: [],
              parentDlId: element.parentElement?.getAttribute('data-dl-id') ?? null,
              childDlIds: Array.from(element.children).map((child) => child.getAttribute('data-dl-id')).filter((id): id is string => id !== null),
              visible: box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
              rect: { x: box.x, y: box.y, width: box.width, height: box.height },
              styles: { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing },
              currentSrc: image?.currentSrc ?? null,
              ...(image ? { image: { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } } : {}),
              pseudo: { before: pseudo('::before'), after: pseudo('::after') },
            };
          });
          return {
            userAgent: navigator.userAgent,
            observations: {
              viewport: { width: innerWidth, height: innerHeight }, deviceScaleFactor: devicePixelRatio,
              width: document.documentElement.scrollWidth, height: Math.max(innerHeight, document.documentElement.scrollHeight),
              rootFontSize: getComputedStyle(document.documentElement).fontSize,
              fonts: { status: 'ready' as const, failedFamilies: [] }, complete: true, warnings: [], elements,
            },
          };
        });
        const prefix = `evidence/${id}`;
        await fs.mkdir(path.join(template, prefix), { recursive: true });
        const files: SourceCapture['files'] = [];
        for (const [name, bytes] of [
          ['viewport.png', await page.screenshot({ fullPage: false })],
          ['full.png', await page.screenshot({ fullPage: true })],
          ['index.html', Buffer.from(HTML)],
          ['pseudo.svg', Buffer.from(PSEUDO_SVG)],
        ] as const) {
          const relative = `${prefix}/${name}`;
          await fs.writeFile(path.join(template, relative), bytes);
          files.push({ path: relative, sha256: hash(bytes) });
        }
        captures.push({
          id, viewport, deviceScaleFactor: 1, capturedAt: new Date().toISOString(), browserVersion: browser.version(),
          userAgent: observed.userAgent, sourceUrl: server.url('/index.html'), finalUrl: server.url('/index.html'),
          policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [] },
          observations: observed.observations, viewportScreenshot: `${prefix}/viewport.png`, fullScreenshot: `${prefix}/full.png`,
          snapshot: `${prefix}/index.html`, files, complete: true, warnings: [],
        });
        await context.close();
      }
      await fs.writeFile(path.join(template, 'evidence.json'), JSON.stringify({ schemaVersion: 1, captures }));
    } finally {
      if (browser) await browser.close();
      await server.close();
    }
  });

  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function project(name: string, edit?: (html: string) => string): Promise<string> {
    const directory = path.join(root, name);
    await fs.cp(template, directory, { recursive: true });
    if (edit) await fs.writeFile(path.join(directory, 'clone/index.html'), edit(HTML));
    return directory;
  }

  // why: proves the bundled comparator can render offline and bind a pass to three viewport captures.
  it('passes identical responsive layouts and preserves previous comparison PNGs', async () => {
    const directory = await project('identical');
    const first = await runCli(['fidelity', directory, '--json']);
    expect(first.code, first.stderr || first.stdout).toBe(0);
    const report = JSON.parse(first.stdout) as FidelityReport;
    expect(report.status).toBe('pass');
    expect(report.captures).toHaveLength(3);
    expect(report.cloneFiles.map((file) => file.path)).toContain('index.html');
    const second = await runCli(['fidelity', directory, '--json']);
    expect(second.code, second.stdout).toBe(0);
    const refreshed = JSON.parse(second.stdout) as FidelityReport;
    expect(refreshed.cloneHash).toBe(report.cloneHash);
    expect(refreshed.evidenceHash).toBe(report.evidenceHash);
    expect(refreshed.captures[0].screenshots?.full).not.toBe(report.captures[0].screenshots?.full);
    await expect(fs.access(path.join(directory, report.captures[0].screenshots!.full))).resolves.toBeUndefined();
  });

  // why: a small missing brand mark must fail even when total changed pixels meet the global threshold.
  it('rejects a missing small logo', async () => {
    const directory = await project('logo', (html) => html.replace(/<img[^>]+>/, ''));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('fail');
    expect(report.captures[0].elements.some((element) => element.sourceId === 'dl-2' && element.status === 'fail')).toBe(true);
  });

  // why: a tiny logo painted by CSS can disappear while both whole-page and header scores still pass.
  it('rejects a missing tiny pseudo-element logo within a flex container', async () => {
    const directory = await project('pseudo-logo');
    const baseline = await runCli(['fidelity', directory, '--json']);
    expect(baseline.code, baseline.stdout).toBe(0);
    await fs.writeFile(path.join(directory, 'clone/index.html'), HTML.replace('background:#d90000', 'background:transparent'));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('fail');
    for (const capture of report.captures) {
      expect(capture.viewportImage?.status).toBe('pass');
      expect(capture.fullImage?.status).toBe('pass');
      expect(capture.elements.find((element) => element.sourceId === 'dl-1')?.image?.status).toBe('pass');
      expect(capture.elements.find((element) => element.sourceId === 'dl-8')?.image?.status).toBe('fail');
    }
    await fs.writeFile(path.join(directory, 'clone/index.html'), HTML.replace("content:''", 'content:none'));
    const removed = await runCli(['fidelity', directory, '--json']);
    expect(removed.code).toBe(1);
    expect(JSON.parse(removed.stdout).status).toBe('fail');
    expect(removed.stdout).toContain('before pseudo-element is missing');
  });

  // why: hashing only the descendants permits an apparently portable clone backed by an external tree.
  it('marks a symlinked clone root unverified', async () => {
    const directory = await project('symlink-root');
    const external = path.join(root, 'external-clone');
    await fs.rename(path.join(directory, 'clone'), external);
    await fs.symlink(external, path.join(directory, 'clone'));
    const result = await runCli(['fidelity', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe('unverified');
    expect(result.stdout).toContain('root contains symlink');
  });

  // why: independent mobile source captures must expose desktop-only reproduction defects.
  it('rejects a missing mobile structure while desktop still passes', async () => {
    const directory = await project('mobile', (html) => html.replace('.mobile{display:block}', '.mobile{display:none}'));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.captures.find((capture) => capture.viewport.width === 1440)?.status).toBe('pass');
    expect(report.captures.find((capture) => capture.viewport.width === 390)?.status).toBe('fail');
  });

  // why: replacing a font can preserve rough geometry, yet it changes the design and must fail.
  it('rejects changed typography', async () => {
    const directory = await project('font', (html) => html.replace('font-family:Arial,sans-serif', 'font-family:serif'));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.captures[0].elements.some((element) => element.issues.some((issue) => issue.includes('fontFamily')))).toBe(true);
  });

  // why: evidence edits invalidate the baseline rather than silently redefining what success means.
  it('marks a modified source screenshot unverified and returns nonzero', async () => {
    const directory = await project('changed-evidence');
    await fs.appendFile(path.join(directory, 'evidence/v1440/full.png'), 'changed');
    const result = await runCli(['fidelity', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'unverified', captures: [] });
    expect(result.stdout).toContain('hash mismatch');
  });

  // why: changing inline measurements must not silently establish a new source baseline on rerun.
  it('keeps the original source hash after repeated attempts with modified observations', async () => {
    const directory = await project('changed-observation');
    const first = await runCli(['fidelity', directory, '--json']);
    expect(first.code, first.stdout).toBe(0);
    const baseline = (JSON.parse(first.stdout) as FidelityReport).evidenceHash;
    const evidenceFile = path.join(directory, 'evidence.json');
    const evidence = JSON.parse(await fs.readFile(evidenceFile, 'utf8')) as { captures: SourceCapture[] };
    evidence.captures[0].observations.rootFontSize = '18px';
    await fs.writeFile(evidenceFile, JSON.stringify(evidence));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await runCli(['fidelity', directory, '--json']);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'unverified', evidenceHash: baseline });
      expect(result.stdout).toContain('source evidence changed');
    }
  });

  // why: the root capture manifest anchors first-run evidence even before any fidelity report exists.
  it('checks the capture manifest baseline before accepting source evidence', async () => {
    const directory = await project('manifest-anchor');
    const expectedHash = 'a'.repeat(64);
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ evidenceHash: expectedHash }));
    const result = await runCli(['fidelity', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'unverified', evidenceHash: expectedHash });
  });

  // why: old clones remain usable but cannot claim pixel verification without a source baseline.
  it('marks legacy projects without evidence unverified', async () => {
    const directory = await project('legacy');
    await fs.unlink(path.join(directory, 'evidence.json'));
    const result = await runCli(['fidelity', directory, '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe('unverified');
  });

  // why: validation cannot silently fetch a missing clone asset from its former host.
  it('blocks requests outside the exact clone server origin', async () => {
    const directory = await project('offline', (html) => html.replace('src="data:image/svg+xml,', 'src="http://127.0.0.1:9/'));
    const result = await runCli(['fidelity', directory, '--json']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('external request blocked');
  });

  // why: a script may leave the correct pixels yet violate the inert clone contract or mutate identity.
  it('does not execute injected scripts and rejects them despite matching pixels', async () => {
    const directory = await project('active-script', (html) => html.replace('</body>', `<script>
      document.querySelector('h1').setAttribute('data-dl-id','executed');document.currentScript.remove();
    </script></body>`));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('fail');
    expect(report.inertIssues.some((issue) => issue.includes('<script>'))).toBe(true);
    expect(report.captures.every((capture) => capture.fullImage?.status === 'pass')).toBe(true);
    expect(report.captures[0].observations?.elements.some((element) => element.dlId === 'executed')).toBe(false);
    expect(report.captures[0].observations?.elements.some((element) => element.dlId === 'dl-5')).toBe(true);
  });

  // why: external SVG/HTML and escaped iframe documents require the same inert audit as index.html.
  it('rejects active nested documents and SVG assets with unchanged rendered pixels', async () => {
    const directory = await project('active-nested', (html) => html.replace('</head>', '<template><iframe srcdoc="&lt;script&gt;0&lt;/script&gt;"></iframe></template></head>'));
    await fs.writeFile(path.join(directory, 'clone', 'asset.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="0"/>');
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.inertIssues.some((issue) => issue.includes('srcdoc'))).toBe(true);
    expect(report.inertIssues.some((issue) => issue.includes('asset.svg'))).toBe(true);
  });
});
