/// <reference lib="dom" />
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import * as cheerio from 'cheerio';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as captureBrowser from '../../src/capture/browser.js';
import { observePage } from '../../src/analyze/observations.js';
import { readEvidence } from '../../src/capture/evidence.js';
import { lazyLoadSweep } from '../../src/capture/settle.js';
import { serializeDom } from '../../src/capture/serialize.js';
import { stabilize } from '../../src/capture/stabilize.js';
import { stampDom } from '../../src/capture/stamp.js';
import { runClone } from '../../src/commands/clone.js';

let server: http.Server;
let origin: string;
const events: string[] = [];
const transparent = PNG.sync.write(new PNG({ width: 1, height: 1 }));

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url!, origin);
    if (url.pathname === '/robots.txt') { response.end(''); return; }
    if (url.pathname === '/visit') {
      events.push(`visit:${url.searchParams.get('width')}`);
      response.writeHead(200, { 'content-type': 'image/png' }); response.end(transparent); return;
    }
    if (url.pathname === '/slow.png') {
      events.push(`refetch:${url.searchParams.get('width')}`);
      const timer = setTimeout(() => {
        response.writeHead(200, { 'content-type': 'image/png' }); response.end(transparent);
      }, 15_000);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    response.setHeader('content-type', 'text/html');
    if (url.pathname === '/budget') {
      response.end(`<!doctype html><body><h1>Budget evidence</h1><script>
        const image = new Image(); image.src = '/visit?width=' + innerWidth; document.body.append(image);
        const style = document.createElement('style');
        style.textContent = '.unused { background-image: url(/slow.png?width=' + innerWidth + ') }';
        document.head.append(style);
      </script></body>`);
      return;
    }
    if (url.pathname === '/timer') {
      response.end('<body><p id="counter">0</p><script>setInterval(() => counter.textContent = Number(counter.textContent) + 1, 10)</script></body>');
      return;
    }
    if (url.pathname === '/poster') {
      response.end(`<!doctype html><body><video id="movie" muted autoplay width="80" height="40"></video><script>
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
        const context = canvas.getContext('2d'); context.fillStyle = 'rgb(30,80,120)'; context.fillRect(0,0,80,40);
        movie.srcObject = canvas.captureStream(30); movie.play();
      </script></body>`);
      return;
    }
    response.end(`<!doctype html><style>body{margin:0}canvas{display:block;width:100px;height:60px}#lazy{margin-top:800px}</style>
      <canvas id="gl" width="100" height="60"></canvas><canvas id="flat" width="10" height="10"></canvas>
      <div id="moving">Frame</div><div id="lazy">Waiting</div><script>
      const attrs = { alpha: false, preserveDrawingBuffer: false };
      const context = gl.getContext('webgl', attrs);
      if (context) { context.clearColor(.1, .6, .9, 1); context.clear(context.COLOR_BUFFER_BIT); }
      window.contextFacts = { available: !!context, preserved: context?.getContextAttributes().preserveDrawingBuffer,
        originalOption: attrs.preserveDrawingBuffer, twoD: !!flat.getContext('2d') };
      window.frameCount = 0; window.timerCount = 0;
      const cancelled = requestAnimationFrame(() => { moving.textContent = 'Cancellation failed'; });
      cancelAnimationFrame(cancelled);
      function frame() { window.frameCount++; moving.style.transform = 'translateX(' + (window.frameCount % 15) + 'px)'; requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      setInterval(() => window.timerCount++, 10);
      new IntersectionObserver((entries) => {
        if(entries.some(entry => entry.isIntersecting)) requestAnimationFrame(() => lazy.textContent = 'Revealed');
      }).observe(lazy);
      </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('preserves WebGL pixels and freezes RAF after lazy loading while timers and serialization work', async () => {
  const capture = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await capture.page.goto(origin);
    await lazyLoadSweep(capture.page, { viewportHeight: 300, settleMs: 0, deadline: Date.now() + 10_000 });
    expect(await capture.page.locator('#lazy').textContent()).toBe('Revealed');
    expect(await capture.page.evaluate(() => (window as unknown as { contextFacts: unknown }).contextFacts))
      .toEqual({ available: true, preserved: true, originalOption: false, twoD: true });
    await stampDom(capture.page, []);
    const ready = await stabilize(capture.page, Date.now() + 5_000);
    expect(ready.complete, ready.warnings.join('\n')).toBe(true);
    const observations = await observePage(capture.page);
    const counts = await capture.page.evaluate(() => {
      const state = window as unknown as { frameCount: number; timerCount: number };
      return { frames: state.frameCount, timers: state.timerCount };
    });
    const serialized = await serializeDom(capture.page);
    expect(serialized.serializer).toBe('percy');
    expect(serialized.warnings).toEqual([]);
    const $ = cheerio.load(serialized.html);
    const canvasPng = PNG.sync.read(Buffer.from($('#gl').attr('src')!.split(',')[1], 'base64'));
    const pixel = [...canvasPng.data.subarray(0, 4)];
    expect(pixel[3]).toBe(255);
    expect(pixel[1]).toBeGreaterThan(140);
    expect(pixel[2]).toBeGreaterThan(200);
    expect((await captureBrowser.capturePng(capture.page, true)).length).toBeGreaterThan(100);
    await capture.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(await observePage(capture.page)).toEqual(observations);
    const after = await capture.page.evaluate(() => {
      const state = window as unknown as { frameCount: number; timerCount: number };
      return { frames: state.frameCount, timers: state.timerCount };
    });
    expect(after.frames).toBe(counts.frames);
    expect(after.timers).toBeGreaterThan(counts.timers);
  } finally { await capture.browser.close(); }
});

it('keeps timer-driven DOM changes explicitly incomplete', async () => {
  const capture = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await capture.page.goto(`${origin}/timer`);
    const ready = await stabilize(capture.page, Date.now() + 5_000);
    expect(ready.complete).toBe(false);
    expect(ready.warnings.join(' ')).toContain('page still changed after animation freeze');
  } finally { await capture.browser.close(); }
});

it('restores a real generated video poster from Percy image bytes', async () => {
  const capture = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await capture.page.goto(`${origin}/poster`);
    await capture.page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement).readyState >= 2);
    await stampDom(capture.page, []);
    const ready = await stabilize(capture.page, Date.now() + 5_000);
    expect(ready.complete, ready.warnings.join('\n')).toBe(true);
    const serialized = await serializeDom(capture.page);
    expect(serialized.warnings).toEqual([]);
    const poster = cheerio.load(serialized.html)('video').attr('poster')!;
    expect(poster).toMatch(/^data:image\/png;base64,/);
    const png = PNG.sync.read(Buffer.from(poster.split(',')[1], 'base64'));
    expect([png.width, png.height]).toEqual([80, 40]);
    expect([...png.data.subarray(0, 4)]).toEqual([30, 80, 120, 255]);
  } finally { await capture.browser.close(); }
});

it('captures all source sizes before local rerender and photographs each before slow optional refetch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-budget-regression-'));
  events.length = 0;
  const screenshot = captureBrowser.capturePng;
  const render = captureBrowser.renderScreenshotOfDir;
  const screenshotSpy = vi.spyOn(captureBrowser, 'capturePng').mockImplementation(async (page, full) => {
    events.push(`screenshot:${page.viewportSize()!.width}`);
    return screenshot(page, full);
  });
  const renderSpy = vi.spyOn(captureBrowser, 'renderScreenshotOfDir').mockImplementation(async (...args) => {
    events.push('rerender');
    return render(...args);
  });
  try {
    const viewports = [{ width: 900, height: 600 }, { width: 600, height: 600 }, { width: 300, height: 600 }];
    const result = await runClone(`${origin}/budget`, {
      out: directory, project: 'budget', viewport: viewports[0], viewports, dsf: 1,
      timeoutMs: 12_000, settleMs: 0, removeSelectors: [], noScroll: true,
      blockCookies: false, maxAssetBytes: 25 * 1024 * 1024, includeMedia: false,
    });
    const evidence = await readEvidence(result.projectDir);
    expect(evidence.captures.map((capture) => capture.viewport.width)).toEqual([900, 600, 300]);
    for (const capture of evidence.captures) {
      expect(capture.snapshot).not.toBe('');
      expect(capture.viewportScreenshot).not.toBe('');
      expect(capture.fullScreenshot).not.toBe('');
      const width = capture.viewport.width;
      expect(events.indexOf(`screenshot:${width}`)).toBeLessThan(events.indexOf(`refetch:${width}`));
      expect(capture.complete).toBe(false);
      expect(capture.warnings.join(' ')).toMatch(/deadline|Timeout/);
    }
    expect(events.indexOf('rerender')).toBeGreaterThan(events.indexOf('visit:300'));
  } finally {
    screenshotSpy.mockRestore(); renderSpy.mockRestore();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
