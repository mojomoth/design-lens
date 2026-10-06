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
import { stampDom, stampLate } from '../../src/capture/stamp.js';
import { runClone } from '../../src/commands/clone.js';
import * as beautify from '../../src/output/beautify.js';
import * as writer from '../../src/output/writer.js';

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
    if (url.pathname === '/collect') {
      // An analytics endpoint whose body never completes; the page aborts it after the headers.
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('partial');
      const timer = setTimeout(() => response.end(), 30_000);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    response.setHeader('content-type', 'text/html');
    if (url.pathname === '/beacon') {
      response.end(`<!doctype html><body><h1>Analytics beacon</h1><script>
        const controller = new AbortController();
        fetch('/collect', { signal: controller.signal }).then(() => controller.abort()).catch(() => undefined);
      </script></body>`);
      return;
    }
    if (url.pathname === '/materialize') {
      response.end(`<!doctype html><body><h1>Materialization ordering</h1><script>
        const image = new Image(); image.src = '/visit?width=' + innerWidth; document.body.append(image);
      </script></body>`);
      return;
    }
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
    if (url.pathname === '/hidden-stall') {
      response.end(`<!doctype html><body><h1>Hidden stall</h1><img src="/slow.png?width=hidden" style="display:none" alt="">
        <img id="broken" src="/not-an-image.png" style="display:none" alt="">
        <marquee id="ticker">Moving headline</marquee></body>`);
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


it('finishes every live source capture before slow formatting or the first clone write', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-materialize-budget-'));
  events.length = 0;
  const formatHtml = beautify.beautifyHtml;
  const writeCloneTree = writer.writeCloneTree;
  let delayed = false;
  const formattingSpy = vi.spyOn(beautify, 'beautifyHtml').mockImplementation((html) => {
    events.push('materialize');
    if (!delayed) {
      delayed = true;
      // A slow local CPU stage must run after all source attempts, outside their shared deadline.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
    }
    return formatHtml(html);
  });
  const writerSpy = vi.spyOn(writer, 'writeCloneTree').mockImplementation((input) => {
    events.push('write-clone');
    return writeCloneTree(input);
  });
  try {
    const viewports = [{ width: 900, height: 600 }, { width: 600, height: 600 }, { width: 300, height: 600 }];
    const result = await runClone(`${origin}/materialize`, {
      out: directory, project: 'materialize', viewport: viewports[0], viewports, dsf: 1,
      timeoutMs: 12_000, settleMs: 0, removeSelectors: [], noScroll: true,
      blockCookies: false, maxAssetBytes: 25 * 1024 * 1024, includeMedia: false,
    });
    const evidence = await readEvidence(result.projectDir);
    expect(evidence.captures).toHaveLength(3);
    expect(events.indexOf('materialize')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('write-clone')).toBeGreaterThan(events.indexOf('materialize'));
    for (const capture of evidence.captures) {
      expect(capture.complete, capture.warnings.join('\n')).toBe(true);
      expect(capture.snapshot).not.toBe('');
      const visit = events.indexOf(`visit:${capture.viewport.width}`);
      expect(visit).toBeGreaterThanOrEqual(0);
      expect(visit).toBeLessThan(events.indexOf('materialize'));
      expect(visit).toBeLessThan(events.indexOf('write-clone'));
    }
  } finally {
    formattingSpy.mockRestore(); writerSpy.mockRestore();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// why: `--freeze-timers` must actually stop page timers after readiness (a ticking page becomes
// still and complete), while the default launch installs no wrappers at all — the legacy
// incomplete-timer behavior above depends on native timers.
it('freezes page timers only when the capture was launched with the timer policy', async () => {
  const plain = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await plain.page.goto(`${origin}/timer`);
    expect(await plain.page.evaluate(() => window.setTimeout.toString())).toContain('[native code]');
  } finally { await plain.browser.close(); }
  const capture = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1, freezeTimers: true });
  try {
    await capture.page.goto(`${origin}/timer`);
    expect(await capture.page.evaluate(() => window.setTimeout.toString())).not.toContain('[native code]');
    const ready = await stabilize(capture.page, Date.now() + 5_000);
    expect(ready.complete, ready.warnings.join('\n')).toBe(true);
    expect(ready.frozen.timers).toBe(true);
    const before = await capture.page.locator('#counter').textContent();
    await capture.page.waitForTimeout(100);
    expect(await capture.page.locator('#counter').textContent()).toBe(before);
  } finally { await capture.browser.close(); }
});

// why: a hidden image that never loads is not painted; it must be disclosed (its bytes are
// refetched for the clone) instead of making the capture incomplete, and a marquee must be
// stopped and disclosed like other motion.
it('discloses unloaded hidden images and stopped marquees without a warning', async () => {
  const capture = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await capture.page.goto(`${origin}/hidden-stall`, { waitUntil: 'domcontentloaded' });
    await stampDom(capture.page, []);
    const ready = await stabilize(capture.page, Date.now() + 10_000, { readiness: { timeoutMs: 1_000, retries: 1, reserveMs: 0 } });
    expect(ready.warnings).toEqual([]);
    expect(ready.complete).toBe(true);
    expect(ready.images.pending).toBe(1);
    expect(ready.images.failed).toBe(1);
    const codes = ready.disclosures.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining(['hidden-images-unloaded', 'marquee-stopped']));
    // Nothing visible was pending, so no retry window was spent.
    expect(ready.readiness.attempts).toHaveLength(1);
    const observed = await observePage(capture.page);
    expect(observed.warnings.join(' ')).not.toContain('unready or failed images');
    // The stalled request has no current source yet; the decoded-and-failed one is recorded.
    expect(observed.hiddenUnloadedImages).toEqual([await capture.page.locator('#broken').getAttribute('data-dl-id')]);
  } finally { await capture.browser.close(); }
});

// why: scripts insert nodes (tracking pixels, widgets) after stamping; unstamped nodes made the
// observation incomplete. Late stamping must keep IDs unique, continue the numbering and reach
// open shadow roots.
it('stamps late script-inserted nodes, including inside open shadow roots, with fresh unique IDs', async () => {
  const capture = await captureBrowser.launchCapture({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  try {
    await capture.page.goto(`${origin}/materialize`);
    const stamped = await stampDom(capture.page, []);
    await capture.page.evaluate(() => {
      const pixel = document.createElement('img');
      pixel.style.display = 'none';
      document.body.append(pixel);
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).append(document.createElement('span'));
      document.body.append(host);
    });
    const late = await stampLate(capture.page);
    expect(late.ids).toEqual([stamped + 1, stamped + 2, stamped + 3].map((n) => `dl-${n}`));
    expect(late.tags).toEqual({ img: 1, div: 1, span: 1 });
    const observed = await observePage(capture.page);
    expect(observed.warnings.join(' ')).not.toContain('without data-dl-id');
    expect((await stampLate(capture.page)).ids).toEqual([]);
  } finally { await capture.browser.close(); }
});

// why: real captures stayed incomplete only because an analytics response body could not be read
// ("could not read response body"). A non-design resource never reaches the inert clone, so its
// unreadable body must be disclosed, not warned; the reconciliation runs in Node after refetch.
it('discloses an unreadable analytics response body instead of making the capture incomplete', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-body-read-'));
  try {
    const result = await runClone(`${origin}/beacon`, {
      out: directory, project: 'beacon', viewport: { width: 400, height: 300 }, dsf: 1,
      timeoutMs: 60_000, settleMs: 0, removeSelectors: [], noScroll: true,
      blockCookies: false, maxAssetBytes: 25 * 1024 * 1024, includeMedia: false,
    });
    const [capture] = (await readEvidence(result.projectDir)).captures;
    expect(capture.warnings).toEqual([]);
    expect(capture.complete).toBe(true);
    const disclosure = capture.stabilization?.disclosures.find((entry) => entry.code === 'body-unread-nondesign');
    expect(disclosure?.detail).toContain(`fetch ${origin}/collect`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
