/**
 * Loopback-only static file server for clone directories and test fixtures.
 *
 * Two layers, deliberately separated so the decision logic is unit-testable WITHOUT binding a port
 * (spec 08-testing forbids listening servers in unit tests; only e2e may bind): `resolveRequest`
 * is a pure function (URL target + root + injected `exists` predicate → status/content-type/path)
 * and `startStaticServer` is the thin node:http wrapper around it used by `serve <dir>` and the
 * e2e global-setup. Binds 127.0.0.1 only (guardrails: fixture servers never leave loopback) and
 * defaults to port 0 so callers read the OS-assigned ephemeral port. Spec: specs/08-testing.md.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Extension → Content-Type. Text types carry an explicit UTF-8 charset. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  // Bulk media (spec 02 §6). Served with real content types so a fixture `<video>` actually loads
  // and the `media-skipped` / `--include-media` paths are exercised against `video/mp4` rather than
  // the `application/octet-stream` fallback.
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

/** Served to any request whose extension is unknown — the safe binary default. */
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** Content-Type for a filesystem path, keyed on its lowercased extension. */
export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Outcome of mapping an HTTP request target onto a file under `root`.
 * `filePath` (absolute) and `contentType` are present only when `status` is 200.
 */
export interface ResolveResult {
  status: 200 | 400 | 403 | 404;
  filePath?: string;
  contentType?: string;
}

/**
 * Pure request→file resolution. Strips query/fragment, percent-decodes, applies directory-index
 * (`/` → `/index.html`), then confines the result to `root`: any path that escapes the root (via
 * `..`, an absolute component, or an encoded separator) is rejected with 403 BEFORE `exists` is
 * consulted, so traversal never even probes the filesystem. Missing files are 404; malformed
 * encoding or a NUL byte is 400. `exists` is injected so this stays filesystem-free for unit tests
 * (production passes an `isFile` check; directories therefore surface as 404, not a read error).
 */
export function resolveRequest(
  root: string,
  target: string,
  exists: (candidate: string) => boolean,
): ResolveResult {
  const cut = target.search(/[?#]/);
  const rawPath = cut === -1 ? target : target.slice(0, cut);

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding (e.g. a lone `%`) — a client error, not a missing file.
    return { status: 400 };
  }
  if (decoded.includes('\0')) return { status: 400 };

  if (!decoded.startsWith('/')) decoded = `/${decoded}`;
  if (decoded.endsWith('/')) decoded += 'index.html';

  const rootResolved = path.resolve(root);
  const filePath = path.resolve(rootResolved, `.${decoded}`);
  const rel = path.relative(rootResolved, filePath);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return { status: 403 };
  }

  if (!exists(filePath)) return { status: 404 };
  return { status: 200, filePath, contentType: contentTypeFor(filePath) };
}

/** A running static server bound to loopback. `close()` resolves once the socket is released. */
export interface StaticServer {
  /** OS-assigned port (the requested port, or a fresh ephemeral one when 0 was requested). */
  port: number;
  /** Origin string, e.g. `http://127.0.0.1:53124`. */
  origin: string;
  /** Absolute URL for a path under the served root, e.g. `url('/index.html')`. */
  url(pathname: string): string;
  /** Stop accepting connections, destroy idle keep-alive sockets, and release the port. */
  close(): Promise<void>;
}

export interface StaticServerOptions {
  /** Port to bind; 0 (the default) lets the OS assign an ephemeral port. */
  port?: number;
  /** Applied before parsing any served document; DevTools measurements remain available. */
  contentSecurityPolicy?: string;
}

/** True only for a real file on disk; directories and missing paths are false (→ 404 upstream). */
function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

const HOST = '127.0.0.1';

/**
 * Start a loopback static server rooted at `root`. Serves GET/HEAD; every other method is 405.
 * Resolves once the server is listening, with the assigned port and helpers. Callers MUST `close()`
 * it (teardown in the e2e global-setup, end of the `serve` command). Never binds a public
 * interface — 127.0.0.1 only.
 */
export function startStaticServer(root: string, options: StaticServerOptions = {}): Promise<StaticServer> {
  const rootResolved = path.resolve(root);

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    if (options.contentSecurityPolicy) res.setHeader('Content-Security-Policy', options.contentSecurityPolicy);
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    const result = resolveRequest(rootResolved, req.url ?? '/', isFile);
    if (result.status !== 200 || result.filePath === undefined) {
      const message =
        result.status === 400 ? 'Bad Request' : result.status === 403 ? 'Forbidden' : 'Not Found';
      res.writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
      return;
    }

    fs.readFile(result.filePath, (err, data) => {
      if (err) {
        // The file vanished between the isFile() check and the read — report it, never hang.
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': result.contentType ?? DEFAULT_CONTENT_TYPE,
        'Content-Length': data.byteLength,
      });
      res.end(method === 'HEAD' ? undefined : data);
    });
  });

  return new Promise<StaticServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, HOST, () => {
      server.removeListener('error', reject);
      const address = server.address() as AddressInfo;
      const port = address.port;
      const origin = `http://${HOST}:${port}`;
      resolve({
        port,
        origin,
        url: (pathname: string) => `${origin}${pathname.startsWith('/') ? '' : '/'}${pathname}`,
        close: () =>
          new Promise<void>((res, rej) => {
            // Destroy live sockets FIRST. `server.close()` only stops NEW connections and then waits
            // for every existing one to end — and HTTP keep-alive means an idle browser tab (or
            // undici's fetch pool) holds one open for seconds after its last response. Without this,
            // Ctrl-C on `serve <dir>` appears to hang, and every teardown pays the keep-alive timeout.
            server.closeAllConnections();
            server.close((closeErr) => (closeErr ? rej(closeErr) : res()));
          }),
      });
    });
  });
}
