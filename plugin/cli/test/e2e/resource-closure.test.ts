/// <reference lib="dom" />
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

const exec = promisify(execFile);
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const CSS = `body{margin:0;background:white}main{display:flex;gap:8px;flex-wrap:wrap}
  .patch{display:block;width:64px;height:64px;background-size:64px 64px}
  :root{--hero:url(../images/hero.svg)}#hero{background-image:var(--hero)}
  #density{background-image:image-set("../images/one.svg" 1x,"../images/two.svg" 2x)}
  iframe{display:block;width:128px;height:128px;border:0}`;
const INTEGRITY = `sha384-${createHash('sha384').update(CSS).digest('base64')}`;
const svg = (color: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`;
const escapeAttr = (html: string): string => html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const NESTED = '<body style="margin:0"><div style="width:48px;height:48px;background:#f59e0b"></div></body>';
const FRAME = `<body style="margin:0"><div id="paint" style="width:64px;height:64px;background:red"></div>
  <iframe style="width:48px;height:48px;border:0" srcdoc="${escapeAttr(NESTED)}"></iframe>
  <script>window.frameExecuted=true;document.querySelector('#paint').style.background='#2563eb'</script></body>`;
const INLINE = `<body style="margin:0"><img width="64" height="64" src="inline.svg">
  <div id="inline-paint" style="width:32px;height:32px;background:red"></div>
  <script>window.frameExecuted=true;document.querySelector('#inline-paint').style.background='#7c3aed'</script></body>`;

function pixels(png: Buffer): Buffer { return PNG.sync.read(png).data; }
function firstPixel(png: Buffer): number[] { return [...pixels(png).subarray(0, 4)]; }

describe('built CLI resource closure and offline rendered output', () => {
  let temp: string;
  let projectDir: string;
  let original: http.Server;
  let clone: StaticServer;
  let browser: Browser;
  let clonePage: Page;
  let originalUrl: string;
  const expected = new Map<string, Buffer>();
  const blockedRequests: string[] = [];
  const responseFailures: string[] = [];
  const selectors = ['#hero', '#density', '#symbol', '#base-image', '#script-frame', '#inline-frame'];

  beforeAll(async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-resource-closure-'));
    original = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (pathname === '/base/redirect.css') {
        response.writeHead(302, { location: '/cdn/styles/main.css' }); response.end(); return;
      }
      let body: string | undefined;
      let type = 'text/html';
      if (pathname === '/index.html') {
        body = `<!doctype html><html><head><meta charset="utf-8">
          <base href="${originalUrl}/base/">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${originalUrl} 'unsafe-inline'; img-src ${originalUrl} data:; frame-src ${originalUrl} about:; script-src 'unsafe-inline'">
          <link rel="preload" as="image" href="leaf.svg">
          <link rel="stylesheet" href="redirect.css" integrity="${INTEGRITY}">
          </head><body><main>
          <div class="patch" id="hero"></div><div class="patch" id="density"></div>
          <svg id="symbol" width="64" height="64"><use href="sprite.svg#mark"/></svg>
          <img id="base-image" width="64" height="64" src="leaf.svg">
          <iframe id="script-frame" src="../frame"></iframe>
          <iframe id="inline-frame" srcdoc="${escapeAttr(INLINE)}"></iframe>
          </main></body></html>`;
      } else if (pathname === '/cdn/styles/main.css') { body = CSS; type = 'text/css'; }
      else if (pathname === '/frame') body = FRAME;
      else if (pathname === '/base/sprite.svg') {
        body = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="mark" viewBox="0 0 64 64"><rect width="64" height="64" fill="#dc2626"/></symbol></svg>';
        type = 'image/svg+xml';
      } else {
        const colors: Record<string, string> = {
          '/cdn/images/hero.svg': '#059669', '/cdn/images/one.svg': '#db2777',
          '/cdn/images/two.svg': '#4f46e5', '/base/leaf.svg': '#0891b2', '/base/inline.svg': '#eab308',
        };
        if (colors[pathname]) { body = svg(colors[pathname]); type = 'image/svg+xml'; }
      }
      response.writeHead(body === undefined ? 404 : 200, { 'content-type': type });
      response.end(body ?? 'missing');
    });
    await new Promise<void>((resolve) => original.listen(0, '127.0.0.1', resolve));
    const address = original.address();
    if (!address || typeof address === 'string') throw new Error('loopback server did not bind');
    originalUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const sourcePage = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await sourcePage.goto(`${originalUrl}/index.html`);
    await sourcePage.frameLocator('#script-frame').locator('#paint').waitFor();
    await sourcePage.frameLocator('#inline-frame').locator('#inline-paint').waitFor();
    for (const selector of selectors) expected.set(selector, await sourcePage.locator(selector).screenshot());
    await sourcePage.close();

    const result = await exec(process.execPath, [BUNDLE, 'clone', `${originalUrl}/index.html`,
      '--out', path.join(temp, 'output'), '--project', 'closure', '--viewport', '800x600',
      '--no-block-cookies', '--no-scroll', '--settle', '0'], {
      cwd: temp, env: { ...process.env, DESIGN_LENS_HOME: path.join(temp, 'runtime') },
    });
    projectDir = (JSON.parse(result.stdout) as { projectDir: string }).projectDir;
    await new Promise<void>((resolve, reject) => original.close((error) => error ? reject(error) : resolve()));

    clone = await startStaticServer(path.join(projectDir, 'clone'));
    clonePage = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const origin = new URL(clone.url('/')).origin;
    await clonePage.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('http') && new URL(url).origin !== origin) {
        blockedRequests.push(url); await route.abort();
      } else await route.continue();
    });
    clonePage.on('response', (response) => {
      if (response.status() >= 400) responseFailures.push(response.url());
    });
    await clonePage.goto(clone.url('/index.html'));
  });

  afterAll(async () => {
    await browser?.close();
    await clone?.close();
    if (original?.listening) await new Promise<void>((resolve) => original.close(() => resolve()));
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  });

  // Why: string-localized paths can still render blank due to base/SRI/CSP/redirect errors; compare actual pixels.
  it('reproduces source asset pixels after the original server is shut down', async () => {
    expect(firstPixel(expected.get('#hero')!)).toEqual([5, 150, 105, 255]);
    expect(firstPixel(expected.get('#density')!)).toEqual([219, 39, 119, 255]);
    expect(firstPixel(expected.get('#symbol')!)).toEqual([220, 38, 38, 255]);
    expect(firstPixel(expected.get('#base-image')!)).toEqual([8, 145, 178, 255]);
    for (const selector of selectors) {
      expect(pixels(await clonePage.locator(selector).screenshot()), selector).toEqual(pixels(expected.get(selector)!));
    }
    expect(blockedRequests).toEqual([]);
    expect(responseFailures).toEqual([]);
  });

  // Why: preserving the original frame response loses JS-rendered state, while retaining its scripts executes code offline.
  it('retains rendered frame and nested srcdoc state without executing frame programs', async () => {
    const frame = clonePage.frameLocator('#script-frame');
    expect(await frame.locator('#paint').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(37, 99, 235)');
    expect(await frame.locator('body').evaluate(() => 'frameExecuted' in window)).toBe(false);
    expect(await frame.frameLocator('iframe').locator('div').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(245, 158, 11)');
    const inline = clonePage.frameLocator('#inline-frame');
    expect(await inline.locator('#inline-paint').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(124, 58, 237)');
    expect(await inline.locator('body').evaluate(() => 'frameExecuted' in window)).toBe(false);
    for (const child of clonePage.frames()) expect(await child.locator('script').count()).toBe(0);
  });

  // Why: a 1x screenshot alone cannot detect loss of the unused 2x image-set candidate or transformed SRI/CSP.
  it('retains unrequested image-set variants and removes obsolete source restrictions', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
      resources: { originalUrl: string; localPath: string; via: string }[]; remote: unknown[];
    };
    const variant = manifest.resources.find((resource) => resource.originalUrl.endsWith('/cdn/images/two.svg'));
    expect(variant?.via).toBe('css-fetch');
    expect(fs.readFileSync(path.join(projectDir, variant!.localPath), 'utf8')).toContain('#4f46e5');
    expect(manifest.remote).toEqual([]);
    const html = fs.readFileSync(path.join(projectDir, 'clone/index.html'), 'utf8');
    expect(html).not.toMatch(/integrity=|http-equiv="Content-Security-Policy"|<base\b/i);
  });
});
