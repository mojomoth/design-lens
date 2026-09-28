/// <reference lib="dom" />
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';

import { comparePng } from '../../src/analyze/fidelity.js';
import { observePage } from '../../src/analyze/observations.js';
import type { PlaywrightModule } from '../../src/capture/browser.js';
import { evidenceHash, hashTree, type SourceCapture } from '../../src/capture/evidence.js';
import { runVerify } from '../../src/commands/verify.js';
import { loadRuntimeDep } from '../../src/lib/runtime-deps.js';
import { startStaticServer } from '../../src/lib/static-server.js';
import { buildManifest, manifestJson, resourceEntry, type Manifest } from '../../src/output/manifest.js';
import { provenanceComment } from '../../src/output/provenance.js';
import { composeResponsiveClone } from '../../src/output/responsive.js';

const FONT_DIR = fileURLToPath(new URL('../fixtures/sites/cdn/fonts/', import.meta.url));
const viewports = [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];

async function rootLayoutCase(browser: Browser, css: string): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-responsive-roots-'));
  const captures: SourceCapture[] = [];
  const expected: Array<{ viewport: Buffer; rootHeight: number; mainHeight: number }> = [];
  try {
    for (const width of [640, 800]) {
      const viewport = { width, height: 480 };
      const captureId = `v${width}`;
      const prefix = `evidence/${captureId}`;
      const clone = path.join(root, prefix, 'clone');
      await fs.mkdir(path.join(clone, 'assets'), { recursive: true });
      const html = `${provenanceComment('2026-09-28T00:00:00.000Z')}\n<!doctype html><html><head><style>${css}</style><link rel="stylesheet" href="assets/dl-overrides.css"></head><body><main data-dl-id="dl-1">Short</main></body></html>`;
      await fs.writeFile(path.join(clone, 'index.html'), html);
      await fs.writeFile(path.join(clone, 'assets/dl-overrides.css'), '');
      const manifest = buildManifest({ playwrightVersion: '1.61.1', source: {
        url: 'https://source.example/', finalUrl: 'https://source.example/', title: 'Roots', capturedAt: '2026-09-28T00:00:00.000Z', viewport, userAgent: 'fixture', robotsDisallowed: false },
      resources: [], stats: { elementsStamped: 1, styleRules: 1, fonts: 0, images: 0, cssFiles: 0, warnings: 0 } });
      await fs.writeFile(path.join(root, prefix, 'manifest.json'), manifestJson(manifest));
      const source = await startStaticServer(clone);
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(source.url('/index.html'));
        const observations = await observePage(page);
        Object.assign(observations, { rootStyles: await page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          return { backgroundColor: styles.backgroundColor, backgroundImage: styles.backgroundImage,
            overflowX: styles.overflowX, overflowY: styles.overflowY };
        }) });
        expected.push({ viewport: await page.screenshot(), rootHeight: await page.locator('html').evaluate((element) => element.getBoundingClientRect().height),
          mainHeight: await page.locator('main').evaluate((element) => element.getBoundingClientRect().height) });
        captures.push({ id: captureId, viewport, deviceScaleFactor: 1, capturedAt: manifest.source.capturedAt,
          browserVersion: browser.version(), userAgent: 'fixture', sourceUrl: manifest.source.url, finalUrl: manifest.source.finalUrl,
          policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [] }, observations,
          viewportScreenshot: '', fullScreenshot: '', snapshot: `${prefix}/clone/index.html`,
          files: (await hashTree(path.join(root, prefix))).map((file) => ({ ...file, path: `${prefix}/${file.path}` })), complete: false, warnings: ['test compares browser pixels directly'] });
      } finally { await page.close(); await source.close(); }
      if (width === 640) {
        await fs.cp(clone, path.join(root, 'clone'), { recursive: true });
        await fs.writeFile(path.join(root, 'manifest.json'), manifestJson(manifest));
      }
    }
    expect((await composeResponsiveClone(root, captures)).warnings).toEqual([]);
    const server = await startStaticServer(path.join(root, 'clone'));
    try {
      for (const [index, capture] of captures.entries()) {
        const page = await browser.newPage({ viewport: capture.viewport });
        try {
          await page.goto(server.url('/index.html'));
          expect(comparePng(expected[index].viewport, await page.screenshot()).comparison.status).toBe('pass');
          const host = page.locator(`dl-variant[data-dl-source-capture="${capture.id}"]`);
          expect(await host.locator('dl-root').evaluate((element) => element.getBoundingClientRect().height)).toBe(expected[index].rootHeight);
          expect(await host.locator('main').evaluate((element) => element.getBoundingClientRect().height)).toBe(expected[index].mainHeight);
        } finally { await page.close(); }
      }
    } finally { await server.close(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

describe('editable sampled responsive DOM composition', () => {
  let root: string;
  let browser: Browser;
  let captures: SourceCapture[];
  let originalHash: string;
  let server: Awaited<ReturnType<typeof startStaticServer>>;
  let manifest: Manifest;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-responsive-'));
    browser = await loadRuntimeDep<PlaywrightModule>('playwright').chromium.launch({ headless: true });
    captures = [];
    for (const [index, viewport] of viewports.entries()) {
      const captureId = `v${viewport.width}`;
      const prefix = `evidence/${captureId}`;
      const captureRoot = path.join(root, prefix);
      const clone = path.join(captureRoot, 'clone');
      await fs.mkdir(path.join(clone, 'assets/source/css'), { recursive: true });
      await fs.mkdir(path.join(clone, 'assets/source/fonts'), { recursive: true });
      const font = await fs.readFile(path.join(FONT_DIR, index === 1 ? 'cdn-serif.woff2' : 'cdn-sans.woff2'));
      const color = ['#ebf2ff', '#fff2dd', '#e5faee'][index];
      const mainCss = `@import "nested.css" layer(base) supports(display:block) screen;
      :root{--paper:${color};font-size:${16 + index}px}html.theme{background:var(--paper);overflow-x:hidden}
      *{box-sizing:border-box;margin:0}body{display:flex;flex-direction:column;min-height:100vh;font-family:VariantFont,monospace;color:#122131}
      header{height:70px;padding:20px;background:#162339;color:white}body>main{flex:1;min-height:1200px;padding:30px}
      h1{font-size:2rem;line-height:1.2;margin:0 0 24px}h1>.line{display:block}nav{font-size:17px}
      footer{padding:24px}img{width:24px;height:24px}html.theme body>main>p{color:#345} .fixed{position:fixed;right:10px;bottom:10px;width:12px;height:12px;background:tomato}
      html:not(:defined) h1{color:red}.unused::before{content:"</style><script>window.injected=1</script>"}`;
      const nested = '@font-face{font-family:VariantFont;src:url(../fonts/shared.woff2) format("woff2");font-weight:400}';
      const image = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="${['red', 'green', 'blue'][index]}" d="M0 0h24v24H0z"/></svg>`;
      const sourceAssets: Array<[string, string | Buffer, string]> = [
        ['assets/source/css/main.css', mainCss, 'text/css'], ['assets/source/css/nested.css', nested, 'text/css'],
        ['assets/source/fonts/shared.woff2', font, 'font/woff2'], ['assets/source/mark.svg', image, 'image/svg+xml'],
      ];
      const html = `${provenanceComment('2026-09-28T00:00:00.000Z')}\n<!doctype html><html class="theme v${index}" style="--vh:${viewport.height / 100}px"><head><meta charset="utf-8"><link rel="stylesheet" href="assets/source/css/main.css"><link rel="stylesheet" href="assets/dl-overrides.css"></head><body class="sample-${index}">
      <header data-dl-id="dl-1"><nav data-dl-id="dl-2">${index === 0 ? 'Desktop navigation' : 'Compact navigation'}</nav></header>
      <main data-dl-id="dl-3"><h1 data-dl-id="dl-4"><span class="line" data-dl-id="dl-5">${index === 0 ? 'A wide sampled heading' : 'A narrow heading'}</span><span class="line" data-dl-id="dl-6">${index === 2 ? 'Three sampled states' : 'Preserved DOM'}</span></h1>
      <p data-dl-id="dl-7">Viewport ${viewport.width} keeps its own font and image.</p><img data-dl-id="dl-8" src="assets/source/mark.svg" alt="Sample mark">
      <aside data-dl-id="dl-9"><template shadowrootmode="open" data-dl-id="dl-10"><style>@font-face{font-family:NativeShadowOnly;src:url(assets/source/fonts/shared.woff2)}:host{display:block;margin-top:20px}span{color:purple;font-family:NativeShadowOnly,monospace}</style><span data-dl-id="dl-11">Native shadow content</span></template></aside></main>
      <footer data-dl-id="dl-12">Footer ${index}</footer><div class="fixed" data-dl-id="dl-13"></div></body></html>`;
      const resources = [];
      for (const [relative, bytes, contentType] of sourceAssets) {
        await fs.writeFile(path.join(clone, relative), bytes);
        resources.push(resourceEntry(Buffer.from(bytes), { assetPath: relative,
          originalUrl: `https://source.example/${relative}`, contentType, via: 'network' }));
      }
      await fs.writeFile(path.join(clone, 'index.html'), html);
      await fs.writeFile(path.join(clone, 'assets/dl-overrides.css'), '');
      const sourceManifest = buildManifest({ playwrightVersion: '1.61.1',
        source: { url: 'https://source.example/', finalUrl: 'https://source.example/', title: 'Sample',
          capturedAt: '2026-09-28T00:00:00.000Z', viewport, userAgent: 'fixture', robotsDisallowed: false },
        resources, stats: { elementsStamped: 13, styleRules: 15, fonts: 1, images: 1, cssFiles: 2, warnings: 0 } });
      await fs.writeFile(path.join(captureRoot, 'manifest.json'), manifestJson(sourceManifest));
      const sourceServer = await startStaticServer(clone);
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        await page.goto(sourceServer.url('/index.html'));
        await page.evaluate(async () => { await document.fonts.ready; });
        const observations = await observePage(page);
        Object.assign(observations, { rootStyles: await page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          return { backgroundColor: styles.backgroundColor, overflowX: styles.overflowX, overflowY: styles.overflowY };
        }) });
        await fs.writeFile(path.join(captureRoot, 'viewport.png'), await page.screenshot());
        await fs.writeFile(path.join(captureRoot, 'full.png'), await page.screenshot({ fullPage: true }));
        captures.push({ id: captureId, viewport, deviceScaleFactor: 1, capturedAt: sourceManifest.source.capturedAt,
          browserVersion: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), sourceUrl: 'https://source.example/', finalUrl: 'https://source.example/',
          policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [] }, observations,
          viewportScreenshot: `${prefix}/viewport.png`, fullScreenshot: `${prefix}/full.png`, snapshot: `${prefix}/clone/index.html`,
          files: (await hashTree(captureRoot)).map((file) => ({ ...file, path: `${prefix}/${file.path}` })), complete: true, warnings: [] });
      } finally { await context.close(); await sourceServer.close(); }
      if (index === 0) {
        await fs.cp(clone, path.join(root, 'clone'), { recursive: true });
        manifest = sourceManifest;
      }
    }
    originalHash = evidenceHash({ schemaVersion: 1, captures });
    manifest.evidenceHash = originalHash;
    await fs.writeFile(path.join(root, 'manifest.json'), manifestJson(manifest));
    await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify({ schemaVersion: 1, captures }));
    const result = await composeResponsiveClone(root, captures);
    expect(result.warnings).toEqual([]);
    manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    server = await startStaticServer(path.join(root, 'clone'), { contentSecurityPolicy: "script-src 'none'" });
  });

  afterAll(async () => { await server?.close(); await browser?.close(); if (root) await fs.rm(root, { recursive: true, force: true }); });

  it('reproduces all sampled layouts and viewport pixels offline, including root rem and native shadow content', async () => {
    for (const capture of captures) {
      const context = await browser.newContext({ viewport: capture.viewport });
      try {
        await context.route('**/*', async (route) => {
          if (new URL(route.request().url()).origin === server.origin) await route.continue();
          else await route.abort();
        });
        const page = await context.newPage();
        await page.goto(server.url('/index.html'));
        await page.evaluate(async () => { await document.fonts.ready; });
        const source = await fs.readFile(path.join(root, capture.viewportScreenshot));
        const actual = await page.screenshot();
        expect(comparePng(source, actual).comparison, capture.id).toMatchObject({ status: 'pass' });
        const sourceFull = await fs.readFile(path.join(root, capture.fullScreenshot));
        expect(comparePng(sourceFull, await page.screenshot({ fullPage: true })).comparison, capture.id).toMatchObject({ status: 'pass' });
        const header = page.locator(`dl-variant[data-dl-source-capture="${capture.id}"] nav`);
        await expect(header.innerText()).resolves.toContain(capture.viewport.width === 1440 ? 'Desktop' : 'Compact');
        expect(await page.locator(`dl-variant[data-dl-source-capture="${capture.id}"] aside span`).innerText()).toBe('Native shadow content');
      } finally { await context.close(); }
    }
  });

  it('selects exactly one editable tree at boundaries and intermediate widths', async () => {
    for (const [width, expected] of [[375, 'v390'], [578, 'v390'], [579, 'v768'], [580, 'v768'], [820, 'v768'], [1103, 'v768'], [1104, 'v1440'], [1105, 'v1440'], [1280, 'v1440']] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.goto(server.url('/index.html'));
        const selected = await page.evaluate(() => Array.from(document.querySelectorAll('dl-variant'))
          .filter((element) => getComputedStyle(element).display !== 'none').map((element) => element.getAttribute('data-dl-source-capture')));
        expect(selected).toEqual([expected]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      } finally { await page.close(); }
    }
  });

  it('keeps provenance and unique IDs while copying colliding same-URL resource bytes independently', async () => {
    expect((await runVerify(root)).report.ok).toBe(true);
    expect(manifest.composition?.elements).toHaveLength(39);
    const ids = manifest.composition!.elements.map((element) => element.dlId);
    expect(new Set(ids).size).toBe(ids.length);
    const imageResources = manifest.resources.filter((entry) => entry.originalUrl.endsWith('/mark.svg'));
    expect(new Set(imageResources.map((entry) => entry.sha256)).size).toBe(3);
    expect(new Set(imageResources.map((entry) => entry.localPath)).size).toBe(4);
    expect(evidenceHash(JSON.parse(await fs.readFile(path.join(root, 'evidence.json'), 'utf8')))).toBe(originalHash);
    for (const capture of captures) {
      const actual = (await hashTree(path.join(root, 'evidence', capture.id))).map((file) => ({ ...file, path: `evidence/${capture.id}/${file.path}` }));
      expect(actual).toEqual(capture.files);
    }
  });

  it('applies the shared override file inside the active shadow without source evidence changes', async () => {
    const mapped = manifest.composition!.elements.find((element) => element.captureId === 'v390' && element.sourceId === 'dl-4')!;
    await fs.writeFile(path.join(root, 'clone/assets/dl-overrides.css'), `[data-dl-id="${mapped.dlId}"]{color:rgb(21, 77, 153)!important}`);
    const page = await browser.newPage({ viewport: viewports[2] });
    try {
      await page.goto(server.url('/index.html'));
      expect(await page.locator(`[data-dl-id="${mapped.dlId}"]`).evaluate((element) => getComputedStyle(element).color)).toBe('rgb(21, 77, 153)');
      expect(evidenceHash(JSON.parse(await fs.readFile(path.join(root, 'evidence.json'), 'utf8')))).toBe(originalHash);
    } finally { await page.close(); }
  });

  it('keeps unavailable source states explicit and never fabricates a missing variant', async () => {
    const partial = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-responsive-partial-'));
    try {
      await fs.cp(path.join(root, 'evidence'), path.join(partial, 'evidence'), { recursive: true });
      await fs.cp(path.join(root, 'evidence/v1440/clone'), path.join(partial, 'clone'), { recursive: true });
      await fs.copyFile(path.join(root, 'evidence/v1440/manifest.json'), path.join(partial, 'manifest.json'));
      const missing = { ...captures[2], snapshot: '', viewportScreenshot: '', fullScreenshot: '', files: [], complete: false, warnings: ['navigation unavailable'] };
      const result = await composeResponsiveClone(partial, [captures[0], captures[1], missing]);
      expect(result.composition?.variants.map((variant) => variant.captureId)).toEqual(['v1440', 'v768']);
      expect(result.warnings).toContain('v390: source snapshot unavailable; no variant was fabricated');
      expect(await fs.readFile(path.join(partial, 'clone/index.html'), 'utf8')).not.toContain('data-dl-source-capture="v390"');
    } finally { await fs.rm(partial, { recursive: true, force: true }); }
  });

  it('rejects altered source bytes before changing the canonical HTML', async () => {
    const altered = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-responsive-altered-'));
    try {
      await fs.cp(path.join(root, 'evidence'), path.join(altered, 'evidence'), { recursive: true });
      await fs.cp(path.join(root, 'evidence/v1440/clone'), path.join(altered, 'clone'), { recursive: true });
      await fs.copyFile(path.join(root, 'evidence/v1440/manifest.json'), path.join(altered, 'manifest.json'));
      const before = await fs.readFile(path.join(altered, 'clone/index.html'), 'utf8');
      await fs.appendFile(path.join(altered, 'evidence/v768/clone/assets/source/css/main.css'), 'body{color:red}');
      await expect(composeResponsiveClone(altered, captures)).rejects.toThrow('capture asset hash differs');
      expect(await fs.readFile(path.join(altered, 'clone/index.html'), 'utf8')).toBe(before);
    } finally { await fs.rm(altered, { recursive: true, force: true }); }
  });

  it('preserves percentage-height document layout through the generated root chain', async () => {
    await rootLayoutCase(browser, 'html,body{height:100%;margin:0}main{height:100%;background:red}');
  });

  it('keeps short bordered roots content-sized rather than imposing a viewport-sized proxy', async () => {
    await rootLayoutCase(browser, 'html{border:2px solid red}body{margin:8px}');
  });

  it('lets authored cascade layers override generated root and body UA defaults', async () => {
    await rootLayoutCase(browser, '@layer reset{*{margin:0}}');
  });
});
