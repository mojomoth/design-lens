import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runClone } from '../../src/commands/clone.js';
import type { Manifest } from '../../src/output/manifest.js';

describe('optional resource refetch honors bulk media policy', () => {
  let server: http.Server; let origin: string; let directory: string;
  const requests = new Map<string, number>();
  const image = PNG.sync.write(new PNG({ width: 1, height: 1 }));

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-media-refetch-'));
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url!, origin).pathname;
      requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
      if (pathname === '/robots.txt') { response.end(''); return; }
      if (pathname === '/movie.mp4') {
        response.writeHead(200, { 'content-type': 'video/mp4' }); response.end('LOCAL-MEDIA-BYTES'); return;
      }
      if (pathname === '/unused.css') {
        response.writeHead(200, { 'content-type': 'text/css' });
        response.end('.unused { background-image: url(/css-image.png) }'); return;
      }
      if (pathname.endsWith('.png')) {
        response.writeHead(200, { 'content-type': 'image/png' }); response.end(image); return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><html><head>
        <link rel="preload" as="style" href="/unused.css" media="not all">
        </head><body><h1>Media policy</h1>
        <video preload="none" src="/movie.mp4?version=1" width="160" height="90"></video>
        <img src="/rendered.png" srcset="/rendered.png 1x, /unused.png 2x" width="1" height="1">
        </body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });

  for (const includeMedia of [false, true]) {
    // why: optional video downloads must not spend a capture's deadline ahead of CSS or images;
    // an explicit include-media request must still fetch and localize the same unused video.
    it(`${includeMedia ? 'fetches' : 'skips'} unrequested video while collecting CSS and images`, async () => {
      requests.clear();
      const result = await runClone(`${origin}/index.html`, {
        out: directory, project: includeMedia ? 'with-media' : 'without-media',
        viewport: { width: 400, height: 300 }, dsf: 1, timeoutMs: 15_000, settleMs: 0,
        removeSelectors: [], noScroll: true, blockCookies: false,
        maxAssetBytes: 25 * 1024 * 1024, includeMedia,
      });
      const manifest: Manifest = JSON.parse(await fs.readFile(path.join(result.projectDir, 'manifest.json'), 'utf8'));
      const resource = (pathname: string) => manifest.resources.find((entry) => new URL(entry.originalUrl).pathname === pathname);
      expect(requests.get('/movie.mp4') ?? 0).toBe(includeMedia ? 1 : 0);
      if (includeMedia) {
        expect(resource('/movie.mp4')?.via).toBe('refetch');
        expect(manifest.remote.some((entry) => new URL(entry.url).pathname === '/movie.mp4')).toBe(false);
        expect(await fs.readFile(path.join(result.projectDir, resource('/movie.mp4')!.localPath), 'utf8')).toBe('LOCAL-MEDIA-BYTES');
      } else {
        expect(resource('/movie.mp4')).toBeUndefined();
        expect(manifest.remote).toContainEqual(expect.objectContaining({ url: `${origin}/movie.mp4?version=1`, reason: 'media-skipped' }));
      }
      for (const pathname of ['/unused.css', '/unused.png', '/css-image.png']) {
        expect(requests.get(pathname), pathname).toBe(1);
        expect(resource(pathname)?.via, pathname).toBe(pathname === '/css-image.png' ? 'css-fetch' : 'refetch');
        expect((await fs.stat(path.join(result.projectDir, resource(pathname)!.localPath))).size).toBeGreaterThan(0);
      }
    });
  }
});
