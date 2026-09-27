/**
 * WHY this suite exists: a real font transfer can prevent the page's load event, before a
 * document.fonts.ready timeout gets a chance to run. Keep that failure bounded while preserving
 * normal image/style loading, HTTP failures, and browser redirect/CORS decisions. Both commands
 * run the built bundle against temporary clones and loopback HTTP servers only.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';

import { expect, it } from 'vitest';

const exec = promisify(execFile);
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
// The capture fixtures only contain a tiny WOFF2 header sufficient for localization tests. Read
// a real decodable font from the already-pinned Playwright dependency for rendering assertions.
const require = createRequire(import.meta.url);
const fontDirectory = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib', 'vite', 'recorder', 'assets');
const fontName = fs.readdirSync(fontDirectory).find((name) => /^codicon.*\.ttf$/.test(name));
if (!fontName) throw new Error('the pinned Playwright package has no recorder font fixture');
const FONT = fs.readFileSync(path.join(fontDirectory, fontName));

interface Fixture {
  root: string;
  project: string;
  origin: string;
  requests: string[];
  completedImages: () => number;
  close: () => Promise<void>;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing loopback address');
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(options: { slowRedirect?: boolean; fastImage?: boolean } = {}): Promise<Fixture> {
  const slowRedirect = options.slowRedirect ?? false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-font-network-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'clone'), { recursive: true });
  const requests: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let completedImages = 0;

  function later(delay: number, callback: () => void): void {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }

  // Deliberately omit CORS permission on the redirect destination. Interception must not hide
  // that origin change by fetching redirects itself and fulfilling the original same-origin URL.
  const cdn = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'font/ttf' });
    response.end(FONT);
  });
  const cdnOrigin = await listen(cdn);
  let html = '';
  const server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(url);
    if (url === '/stall.woff2') {
      response.writeHead(200, { 'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*' });
      response.write('wOF2');
      return; // A real response body remains open until the font-request guard aborts it.
    }
    if (url === '/redirect.woff2' || url === '/cors-redirect.woff2') {
      response.writeHead(302, {
        Location: url === '/redirect.woff2' ? '/normal.woff2' : `${cdnOrigin}/font.woff2`,
        'Access-Control-Allow-Origin': '*',
      });
      response.end();
      return;
    }
    if (url === '/normal.woff2') {
      later(slowRedirect ? 6_200 : 700, () => {
        response.writeHead(200, { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*' });
        response.end(FONT);
      });
      return;
    }
    if (url === '/missing.woff2') {
      response.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      response.end('No font here');
      return;
    }
    if (url === '/style.css') {
      later(300, () => {
        response.writeHead(200, { 'Content-Type': 'text/css' });
        response.end(`
          @font-face { font-family: StalledEvidence; src: url('/stall.woff2'); }
          ${slowRedirect && options.fastImage ? '' : "@font-face { font-family: NormalEvidence; src: url('/redirect.woff2'); }"}
          @font-face { font-family: MissingEvidence; src: url('/missing.woff2'); }
          @font-face { font-family: RejectedEvidence; src: url('/cors-redirect.woff2'); }
          body { margin: 0; font: 22px sans-serif; }
          h1 { font: 42px ${slowRedirect ? 'NormalEvidence' : 'StalledEvidence'}, sans-serif; }
          .normal { font-family: NormalEvidence, sans-serif; }
          .missing { font-family: MissingEvidence, sans-serif; }
          .rejected { font-family: RejectedEvidence, sans-serif; }
          img { display: block; }
        `);
      });
      return;
    }
    if (url === '/slow.svg') {
      // This normal image finishes AFTER the five-second font budget. A global stop or an
      // early DOMContentLoaded measurement would lose its intrinsic dimensions.
      // In the redirected-font case, keep native load pending until that six-second font has
      // completed too; otherwise the separate after-load readiness timer can correctly win.
      later(options.fastImage ? 0 : slowRedirect ? 7_000 : 6_000, () => {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="123" height="45"><rect width="123" height="45" fill="#3347ff"/></svg>');
        completedImages += 1;
      });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  });
  const origin = await listen(server);
  html = `<!doctype html><html><head><link rel="stylesheet" href="${origin}/style.css"></head><body>
    <h1 data-dl-id="dl-1">A stalled font must not block evidence</h1>
    <p class="normal" data-dl-id="dl-2">A valid redirected font finishes loading.</p>
    <p class="missing" data-dl-id="dl-3">A missing font uses fallback.</p>
    <img data-dl-id="dl-4" src="${origin}/slow.svg" alt="Delayed local image">
    <p class="rejected" data-dl-id="dl-5">A cross-origin redirect still requires permission.</p>
    ${slowRedirect && options.fastImage ? `<script>
      // Start after load so this case measures the after-load budget on every Chromium schedule.
      // A CSS-triggered request may already be seconds old when load fires under CPU contention.
      window.addEventListener('load', () => {
        const face = new FontFace('NormalEvidence', 'url(${origin}/redirect.woff2)', { display: 'swap' });
        document.fonts.add(face);
        face.load().catch(() => {});
      });
    </script>` : ''}
  </body></html>`;
  fs.writeFileSync(path.join(project, 'clone', 'index.html'), html);

  return {
    root,
    project,
    origin,
    requests,
    completedImages: () => completedImages,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      cdn.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => cdn.close(() => resolve())),
      ]);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function run(args: string[], site: Fixture): Promise<{ stdout: string; stderr: string; elapsedMs: number }> {
  const start = Date.now();
  const result = await exec(process.execPath, [BUNDLE, ...args], {
    cwd: site.root,
    env: { ...process.env, DESIGN_LENS_HOME: path.join(site.root, 'runtime') },
    timeout: 15_000,
  });
  return { ...result, elapsedMs: Date.now() - start };
}

/** A real font begins at load, redirects, and never finishes; no font API or browser globals change. */
async function pendingFontFixture(): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-pending-font-'));
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(url);
    if (url === '/redirect.woff2') {
      response.writeHead(302, { Location: '/pending.woff2' });
      response.end();
    } else if (url === '/pending.woff2') {
      response.writeHead(200, { 'Content-Type': 'font/woff2' });
      response.write('wOF2');
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><html><head><style>
        html, body { margin: 0; }
        body { height: 1280px; background: linear-gradient(#edf0fa 0 200px, #dae4f0 200px); font: 24px sans-serif; }
        h1 { margin: 0; padding: 24px; font-size: 36px; }
        footer { position: absolute; top: 1180px; height: 100px; width: 100%; background: #3347ff; }
      </style></head><body><h1>Evidence while a redirected font is pending</h1><footer>End of page</footer>
      <script>window.addEventListener('load', () => {
        const face = new FontFace('PendingEvidence', 'url(/redirect.woff2)', { display: 'swap' });
        document.fonts.add(face);
        face.load().catch(() => {});
        document.body.style.fontFamily = 'PendingEvidence, sans-serif';
        window.scrollTo(0, 400);
      });</script></body></html>`);
    }
  });
  const origin = await listen(server);
  return {
    root, project: root, origin, requests, completedImages: () => 0,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Chromium emits 8-bit RGB/RGBA PNGs. The first pixel has no prior neighbors for any row filter. */
function firstPngPixel(png: Buffer): number[] {
  expect(png[24]).toBe(8);
  expect([2, 6]).toContain(png[25]);
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      data.push(png.subarray(offset + 8, offset + 8 + size));
    }
    offset += size + 12;
  }
  return [...inflateSync(Buffer.concat(data)).subarray(1, 4)];
}

// why: the previous mocked readiness test could pass while a real pending font blocked goto(load)
// for thirty seconds. This must return qualified JSON and retain the later normal image geometry.
it('inspects a real stalled font with timeout metadata after normal styles and images finish', async () => {
  const site = await fixture();
  try {
    const result = await run(['inspect', site.project, '--details'], site);
    const document = JSON.parse(result.stdout) as {
      elements: Array<{ dlId: string; rect: { width: number; height: number }; styles: { fontSize: string } }>;
      page: { fonts: { status: string; failedFamilies: string[] }; body: { styles: { fontSize: string } } };
    };
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(document.page.fonts.status).toBe('timeout');
    const failed = document.page.fonts.failedFamilies.map((name) => name.replace(/["']/g, ''));
    expect(failed).toContain('StalledEvidence');
    expect(failed).toContain('MissingEvidence');
    expect(failed).not.toContain('NormalEvidence');
    expect(document.page.body.styles.fontSize).toBe('22px');
    expect(document.elements.find((element) => element.dlId === 'dl-1')?.styles.fontSize).toBe('42px');
    expect(document.elements.find((element) => element.dlId === 'dl-4')?.rect).toMatchObject({ width: 123, height: 45 });
    expect(site.completedImages()).toBe(1);
    expect(site.requests).toEqual(expect.arrayContaining(['/redirect.woff2', '/normal.woff2', '/missing.woff2', '/stall.woff2']));
    expect(result.stderr).toContain('font request timed out after 5000ms');
  } finally {
    await site.close();
  }
});

// why: screenshot uses the same readiness path, and transparent redirect forwarding is necessary
// to avoid making a forbidden cross-origin font appear valid in the captured design evidence.
it('writes a screenshot after a stalled font while preserving redirect CORS and delayed images', async () => {
  const site = await fixture();
  try {
    const out = path.join(site.root, 'shot.png');
    const result = await run(['screenshot', '--url', `${site.origin}/index.html`, '--dsf', '1', '--out', out], site);
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(fs.readFileSync(out).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(site.completedImages()).toBe(1);
    expect(result.stderr).toContain('font request timed out after 5000ms');
    expect(result.stderr).toContain('StalledEvidence');
    expect(result.stderr).toContain('MissingEvidence');
    expect(result.stderr).toContain('RejectedEvidence');
    expect(result.stderr).not.toContain('NormalEvidence');
    expect(site.requests).toContain('/cors-redirect.woff2');
  } finally {
    await site.close();
  }
});

// why: Playwright routes only the initial URL. Native redirect hops must keep their navigation
// deadline and CORS behavior instead of being mistaken for a five-second whole-chain guarantee.
it('lets a redirected font finish after six seconds and reports readiness without an initial-request timeout', async () => {
  const site = await fixture({ slowRedirect: true });
  try {
    const result = await run(['inspect', site.project, '--details'], site);
    const document = JSON.parse(result.stdout) as {
      page: { fonts: { status: string; failedFamilies: string[] } };
    };
    expect(result.elapsedMs, `${result.stderr}\n${JSON.stringify(site.requests)}\n${JSON.stringify(document.page.fonts)}`).toBeGreaterThanOrEqual(6_000);
    expect(result.elapsedMs).toBeLessThan(12_000);
    expect(document.page.fonts.status).toBe('ready');
    expect(document.page.fonts.failedFamilies).not.toContain('NormalEvidence');
    expect(site.requests).toEqual(expect.arrayContaining(['/redirect.woff2', '/normal.woff2']));
    expect(site.requests).not.toContain('/stall.woff2');
    expect(result.stderr).not.toContain('font request timed out');
  } finally {
    await site.close();
  }
});

// why: a native redirected font may still be loading after the page load event. The independent
// readiness budget must then qualify the evidence without claiming the initial request timed out.
it('reports a readiness timeout when a redirected font outlasts load and the after-load font budget', async () => {
  const site = await fixture({ slowRedirect: true, fastImage: true });
  try {
    const result = await run(['inspect', site.project, '--details'], site);
    const document = JSON.parse(result.stdout) as {
      page: { fonts: { status: string; failedFamilies: string[] } };
    };
    expect(result.elapsedMs).toBeGreaterThanOrEqual(5_000);
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(document.page.fonts.status).toBe('timeout');
    expect(document.page.fonts.failedFamilies).not.toContain('NormalEvidence');
    expect(site.completedImages()).toBe(1);
    expect(site.requests).toEqual(expect.arrayContaining(['/redirect.woff2', '/normal.woff2']));
    expect(site.requests).not.toContain('/stall.woff2');
    expect(result.stderr).toContain('font readiness timed out after 5000ms');
    expect(result.stderr).not.toContain('font request timed out');
  } finally {
    await site.close();
  }
});

// why: Playwright's screenshotter has its own unbounded font-ready wait after ours. A real font
// still pending after load must produce qualified pixels, with correct viewport/full-page scaling.
it.each([
  { fullPage: false, dsf: 1 },
  { fullPage: true, dsf: 1 },
  { fullPage: false, dsf: 2 },
  { fullPage: true, dsf: 2 },
])('captures pending-font pixels with fullPage=$fullPage and dsf=$dsf', async ({ fullPage, dsf }) => {
  const site = await pendingFontFixture();
  try {
    const out = path.join(site.root, 'pending-font.png');
    const result = await run([
      'screenshot', '--url', site.origin, '--width', '390', '--height', '844', '--dsf', String(dsf),
      '--out', out, ...(fullPage ? ['--full-page'] : []),
    ], site);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(5_000);
    expect(result.elapsedMs).toBeLessThan(10_000);
    const png = fs.readFileSync(out);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.byteLength).toBeGreaterThan(1_024);
    expect(png.readUInt32BE(16)).toBe(390 * dsf);
    expect(png.readUInt32BE(20)).toBe((fullPage ? 1280 : 844) * dsf);
    expect(firstPngPixel(png)).toEqual([0xed, 0xf0, 0xfa]);
    expect(JSON.parse(result.stdout)).toMatchObject({ out, bytes: png.byteLength });
    expect(site.requests).toEqual(expect.arrayContaining(['/redirect.woff2', '/pending.woff2']));
    expect(result.stderr).toContain('font readiness timed out after 5000ms');
    expect(result.stderr).not.toContain('font request timed out');
  } finally {
    await site.close();
  }
});
