/// <reference lib="dom" />
import http from 'node:http';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { capturePng, capturePngWithUnreadyFonts, launchCapture } from '../../src/capture/browser.js';
import { observePage } from '../../src/analyze/observations.js';
import { stabilize } from '../../src/capture/stabilize.js';
import { stampDom } from '../../src/capture/stamp.js';

let server: http.Server;
let origin: string;
const WIDTH = 400;
const HEIGHT = 300;
const FULL_HEIGHT = 1_200;

beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><style>
      html{font-family:sans-serif}body{margin:0}canvas{position:fixed;inset:0;width:400px;height:300px}
      main{position:relative;height:1200px;background:linear-gradient(transparent 900px,rgb(180,30,80) 900px)}
      </style><canvas id="graphic" width="400" height="300"></canvas><main></main><script>
      const gl = graphic.getContext('webgl', { alpha: false });
      window.frames = 0; window.ticks = 0; window.resizeEvents = 0;
      function frame() {
        window.frames++; gl.clearColor(.1,.7,.3,1); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      addEventListener('resize', () => {
        window.resizeEvents++; gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish();
      });
      setInterval(() => window.ticks++, 10);
      </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function pixel(png: PNG, x: number, y: number): number[] {
  const offset = (y * png.width + x) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

// why: Chromium's native full-page capture dispatches resize callbacks that can erase a frozen WebGL frame.
it.each([1, 2])('preserves native full-page pixels, dimensions, and source state at density %i', async (dsf) => {
  const capture = await launchCapture({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: dsf });
  try {
    await capture.page.goto(origin);
    await capture.page.waitForFunction(() => (window as unknown as { frames: number }).frames > 3);
    await stampDom(capture.page, []);
    const ready = await stabilize(capture.page, Date.now() + 5_000);
    expect(ready.complete, ready.warnings.join('\n')).toBe(true);
    const environment = () => capture.page.evaluate(() => ({
      viewport: [innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio],
      screen: [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.colorDepth, screen.pixelDepth],
      orientation: [screen.orientation.type, screen.orientation.angle],
      visualViewport: [visualViewport?.width, visualViewport?.height, visualViewport?.scale],
    }));
    const environmentBefore = await environment();
    const before = await observePage(capture.page);
    const canvasBefore = await capture.page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    const initial = PNG.sync.read(Buffer.from(canvasBefore.split(',')[1], 'base64'));
    expect(pixel(initial, 100, 100)).toEqual([26, 179, 77, 255]);
    const viewport = PNG.sync.read(await capturePng(capture.page, false));
    expect([viewport.width, viewport.height]).toEqual([WIDTH * dsf, HEIGHT * dsf]);
    for (const [mode, take, expectedHeight] of [
      ['ready fonts', () => capturePng(capture.page, true), FULL_HEIGHT],
      ['unready fonts viewport', () => capturePngWithUnreadyFonts(capture.page, false, dsf), HEIGHT],
      ['unready fonts full', () => capturePngWithUnreadyFonts(capture.page, true, dsf), FULL_HEIGHT],
    ] as const) {
      const full = PNG.sync.read(await take());
      expect([full.width, full.height]).toEqual([WIDTH * dsf, expectedHeight * dsf]);
      expect(pixel(full, 100 * dsf, 100 * dsf)).toEqual(pixel(viewport, 100 * dsf, 100 * dsf));
      if (expectedHeight === FULL_HEIGHT) expect(pixel(full, 100 * dsf, 1_100 * dsf)).toEqual([180, 30, 80, 255]);
      expect(await environment(), mode).toEqual(environmentBefore);
      expect(await observePage(capture.page), mode).toEqual(before);
      expect(await capture.page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).toBe(canvasBefore);
    }
    const ticks = await capture.page.evaluate(() => (window as unknown as { ticks: number }).ticks);
    await capture.page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
    expect(await capture.page.evaluate(() => (window as unknown as { ticks: number }).ticks)).toBeGreaterThan(ticks);
    // The negative control uses the same native browser capture without the narrow script pause.
    const unguarded = PNG.sync.read(await capture.page.screenshot({ fullPage: true }));
    expect(pixel(unguarded, 100 * dsf, 100 * dsf)).toEqual([0, 0, 0, 255]);
    expect(await capture.page.evaluate(() => (window as unknown as { resizeEvents: number }).resizeEvents)).toBeGreaterThan(0);
  } finally {
    await capture.browser.close();
  }
});

// why: a screenshot error must not leave script execution disabled in the source page.
it('restores source timers when the screenshot operation throws', async () => {
  const capture = await launchCapture({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  try {
    await capture.page.goto(origin);
    const screenshot = vi.spyOn(capture.page, 'screenshot').mockRejectedValueOnce(new Error('fixture screenshot failed'));
    try {
      await expect(capturePng(capture.page, true)).rejects.toThrow('fixture screenshot failed');
    } finally {
      screenshot.mockRestore();
    }
    expect(await capture.page.evaluate(() => new Promise<string>((resolve) => setTimeout(() => resolve('restored'), 20))))
      .toBe('restored');
  } finally {
    await capture.browser.close();
  }
});
