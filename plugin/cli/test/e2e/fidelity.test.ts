/// <reference lib="dom" />

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';

import type { FidelityComposition, FidelityReport } from '../../src/analyze/fidelity.js';
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

  async function composedProject(name: string, warnings: string[] = []): Promise<string> {
    const directory = await project(name);
    const evidence = JSON.parse(await fs.readFile(path.join(directory, 'evidence.json'), 'utf8')) as { captures: SourceCapture[] };
    const composition: FidelityComposition = { schemaVersion: 1, boundaryPolicy: 'nearest-width-then-height', variants: [], elements: [], warnings };
    let ordinal = 0;
    const id = (): string => `dl-${++ordinal}`;
    const selection: string[] = [];
    const variants: string[] = [];
    for (const capture of evidence.captures) {
      const hostId = id(); const rootId = id(); const bodyId = id();
      const media = capture.viewport.width === 1440 ? '(min-width:1104px)' : capture.viewport.width === 768 ? '(min-width:579px) and (max-width:1103.999px)' : '(max-width:578.999px)';
      composition.variants.push({ captureId: capture.id, viewport: capture.viewport, media, hostId, rootId, bodyId });
      selection.push(`@media ${media}{[data-dl-id="${hostId}"]{display:contents}}`);
      const body = HTML.match(/<body>([\s\S]*)<\/body>/)![1].replace(/data-dl-id="(dl-[0-9]+)"/g, (_, sourceId: string) => {
        const dlId = id();
        composition.elements.push({ dlId, captureId: capture.id, sourceId });
        return `data-dl-id="${dlId}" data-dl-source-capture="${capture.id}" data-dl-source-id="${sourceId}"`;
      });
      const css = HTML.match(/<style>([\s\S]*)<\/style>/)![1].replace(/body\{/g, 'dl-body{');
      variants.push(`<dl-variant data-dl-id="${hostId}" data-dl-generated="host" data-dl-source-capture="${capture.id}"><template shadowrootmode="open"><style>dl-root,dl-body{display:block}${css}</style><dl-root data-dl-id="${rootId}" data-dl-generated="root" data-dl-original-tag="html" data-dl-source-capture="${capture.id}"><dl-body data-dl-id="${bodyId}" data-dl-generated="body" data-dl-original-tag="body" data-dl-source-capture="${capture.id}">${body}</dl-body></dl-root></template></dl-variant>`);
    }
    await fs.writeFile(path.join(directory, 'clone/index.html'), `<!doctype html><html><head><style>body{margin:0}dl-variant{display:none}${selection.join('')}</style></head><body>${variants.join('')}</body></html>`);
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ composition }));
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

  // why: incomplete captures used to return no useful measurements; diagnostics must never bless them.
  it('renders intact incomplete evidence diagnostically without allowing a pass', async () => {
    const directory = await project('incomplete-diagnostics', (html) => html.replace(/<img[^>]+>/, ''));
    const evidencePath = path.join(directory, 'evidence.json');
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as { captures: SourceCapture[] };
    evidence.captures[0].complete = false;
    evidence.captures[0].warnings.push('fixture source had a continuing timer');
    await fs.writeFile(evidencePath, JSON.stringify(evidence));
    const original = await fs.readFile(evidencePath, 'utf8');
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('unverified');
    expect(report.captures[0]).toMatchObject({ status: 'unverified', diagnosticOnly: true });
    expect(report.captures[0].screenshots?.viewport).toBeTruthy();
    expect(report.captures[0].viewportImage).toBeDefined();
    expect(report.captures[0].elements.some((element) => element.sourceId === 'dl-2' && element.status === 'fail')).toBe(true);
    expect(await fs.readFile(evidencePath, 'utf8')).toBe(original);
  });

  // why: unsupported composition transforms stay uncertified even when current raster samples match.
  it('propagates composition limitations into diagnostic capture results', async () => {
    const directory = await composedProject('composition-limitation', ['unsupported root writing mode']);
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('unverified');
    expect(report.captures).toHaveLength(3);
    expect(report.captures.every((capture) => capture.status === 'unverified' && capture.diagnosticOnly)).toBe(true);
    expect(report.captures[0].viewportImage?.status).toBe('pass');
    expect(report.issues).toContain('responsive composition: unsupported root writing mode');
  });

  // why: DOM source markers are optional hints; removing them must retain manifest-qualified matches.
  it('verifies a recorded composition with and without DOM source attributes', async () => {
    const directory = await composedProject('composition-provenance');
    const baseline = await runCli(['fidelity', directory, '--json']);
    expect(baseline.code, baseline.stdout).toBe(0);
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')) as { composition: FidelityComposition };
    expect((JSON.parse(baseline.stdout) as FidelityReport).compositionHash).toBe(hash(JSON.stringify(metadata.composition)));
    const html = await fs.readFile(path.join(directory, 'clone/index.html'), 'utf8');
    await fs.writeFile(path.join(directory, 'clone/index.html'), html.replace(/ data-dl-source-(?:capture|id)="[^"]*"/g, ''));
    const stripped = await runCli(['fidelity', directory, '--json']);
    expect(stripped.code, stripped.stdout).toBe(0);
    const report = JSON.parse(stripped.stdout) as FidelityReport;
    for (const capture of report.captures) {
      expect(capture.observations?.activeCaptureId).toBe(capture.captureId);
      for (const element of capture.elements) expect(metadata.composition.elements).toContainEqual({
        dlId: element.cloneId, captureId: capture.captureId, sourceId: element.sourceId,
      });
    }
  });

  // why: source-looking markers and generated flags cannot grant correspondence or exclusions alone.
  it('rejects partial source claims and forged generated exemptions in a legacy clone', async () => {
    const directory = await project('legacy-provenance-spoof', (html) => html.replace('<h1 ', '<h1 data-dl-source-id="dl-5" data-dl-generated="root" '));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('unverified');
    expect(report.captures[0].viewportImage?.status).toBe('pass');
    expect(report.captures[0].issues).toContain('unrecorded DOM provenance claim: dl-5');
  });

  // why: matching semantic content and pixels must not excuse invalid canonical or shadow provenance.
  it.each(['source-claim', 'canonical-id', 'recorded-map', 'host-path', 'generated-role'] as const)('rejects a composed provenance defect: %s', async (defect) => {
    const directory = await composedProject(`composition-${defect}`);
    const file = path.join(directory, 'clone/index.html');
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { composition: FidelityComposition };
    const target = manifest.composition.elements.find((entry) => entry.captureId === 'v390' && entry.sourceId === 'dl-5')!;
    let html = await fs.readFile(file, 'utf8');
    const marker = `data-dl-id="${target.dlId}"`;
    if (defect === 'source-claim') html = html.replace(`${marker} data-dl-source-capture="v390"`, `${marker} data-dl-source-capture="v1440"`);
    if (defect === 'canonical-id') html = html.replace(marker, 'data-dl-id="dl-99999"');
    if (defect === 'generated-role') html = html.replace(marker, `${marker} data-dl-generated="root"`);
    if (defect === 'host-path') {
      const targetElement = html.match(new RegExp(`<h1 ${marker}[^>]*>[^<]*</h1>`))![0];
      html = html.replace(targetElement, '').replace('</body>', `${targetElement}</body>`);
    }
    if (defect === 'recorded-map') {
      manifest.composition.elements = manifest.composition.elements.filter((entry) => entry.dlId !== target.dlId);
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
    }
    await fs.writeFile(file, html);
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).not.toBe('pass');
    expect(report.captures.find((entry) => entry.captureId === 'v390')?.elements.find((entry) => entry.sourceId === 'dl-5')?.status).toBe('fail');
  });

  // why: a failed source capture has no variant, but intact siblings still need honest diagnostics.
  it('validates available variants and retains diagnostics when another source snapshot is missing', async () => {
    const directory = await composedProject('composition-partial', ['v390: source snapshot is unavailable']);
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { composition: FidelityComposition };
    const unavailable = manifest.composition.variants.find((entry) => entry.captureId === 'v390')!;
    manifest.composition.variants = manifest.composition.variants.filter((entry) => entry.captureId !== 'v390');
    manifest.composition.elements = manifest.composition.elements.filter((entry) => entry.captureId !== 'v390');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const htmlPath = path.join(directory, 'clone/index.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    await fs.writeFile(htmlPath, html.replace(new RegExp(`<dl-variant data-dl-id="${unavailable.hostId}"[\\s\\S]*?</dl-variant>`), ''));
    const evidencePath = path.join(directory, 'evidence.json');
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as { captures: SourceCapture[] };
    const missing = evidence.captures.find((capture) => capture.id === 'v390')!;
    missing.snapshot = ''; missing.viewportScreenshot = ''; missing.fullScreenshot = ''; missing.complete = false;
    missing.observations.complete = false;
    missing.warnings.push('source capture did not finish');
    await fs.writeFile(evidencePath, JSON.stringify(evidence));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('unverified');
    expect(report.captures).toHaveLength(3);
    expect(report.captures[0].viewportImage?.status).toBe('pass');
    expect(report.captures[0].diagnosticOnly).toBe(true);
    expect(report.captures[2].viewportImage).toBeUndefined();
    expect(report.captures[2].issues).toContain('source images are unavailable; no image comparison was performed');
    expect(report.issues).not.toContain('invalid responsive composition metadata');
  });

  // why: warnings-only metadata must not silently activate trusted responsive matching.
  it('keeps malformed composition metadata unverified', async () => {
    const directory = await project('composition-invalid');
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ composition: { schemaVersion: 1, warnings: [] } }));
    const result = await runCli(['fidelity', directory, '--json']);
    const report = JSON.parse(result.stdout) as FidelityReport;
    expect(result.code).toBe(1);
    expect(report.status).toBe('unverified');
    expect(report.issues).toContain('invalid responsive composition metadata');
  });

  // why: no reference image is not a blank reference; do not manufacture comparisons or a pass.
  it('keeps missing source captures explicitly unavailable', async () => {
    const directory = await project('unavailable-source');
    const evidencePath = path.join(directory, 'evidence.json');
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as { captures: SourceCapture[] };
    evidence.captures[0].complete = false;
    evidence.captures[0].viewportScreenshot = '';
    evidence.captures[0].fullScreenshot = '';
    await fs.writeFile(evidencePath, JSON.stringify(evidence));
    const result = await runCli(['fidelity', directory, '--json']);
    const capture = (JSON.parse(result.stdout) as FidelityReport).captures[0];
    expect(result.code).toBe(1);
    expect(capture.status).toBe('unverified');
    expect(capture.viewportImage).toBeUndefined();
    expect(capture.screenshots).toBeUndefined();
    expect(capture.issues).toContain('source images are unavailable; no image comparison was performed');
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
