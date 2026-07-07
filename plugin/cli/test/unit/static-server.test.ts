import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { contentTypeFor, resolveRequest } from '../../src/lib/static-server.js';

const ROOT = path.resolve('/srv/clone');
// Every request path under this root "exists" so status reflects resolution, not disk state.
const allExist = () => true;
const noneExist = () => false;

// why: the static server is how every clone and fixture is served (spec 08 §Determinism; T21
// `serve`, e2e global-setup). Its resolution logic is unit-tested as a PURE function precisely so
// these tests bind no port — spec 08 forbids listening servers in unit tests. contentTypeFor is
// asserted here because a wrong MIME type would make browsers/Playwright refuse or mis-parse a
// served CSS/JS/font, silently breaking clone capture and the e2e suite downstream.
describe('contentTypeFor', () => {
  it('maps common clone-asset extensions to their MIME types', () => {
    expect(contentTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/x/style.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('/x/app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/data.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('/x/brand.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/x/logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('/x/hero.png')).toBe('image/png');
  });

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('/x/HERO.PNG')).toBe('image/png');
  });

  it('falls back to application/octet-stream for unknown or absent extensions', () => {
    expect(contentTypeFor('/x/mystery.xyz')).toBe('application/octet-stream');
    expect(contentTypeFor('/x/README')).toBe('application/octet-stream');
  });
});

// why: resolveRequest is the security boundary of the server. If directory-indexing, the 404 path,
// or (critically) the traversal guard regressed, `serve` could 500 on a bare origin, hang on a
// missing asset, or hand out files outside the clone dir — the exact failures this PURE, port-free
// test set (AC: a content type, a 404, a rejected `..`) is here to catch.
describe('resolveRequest', () => {
  it('serves an existing file with its resolved content type (200)', () => {
    const result = resolveRequest(ROOT, '/style.css', allExist);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/css; charset=utf-8');
    expect(result.filePath).toBe(path.join(ROOT, 'style.css'));
  });

  it('maps a directory request ("/") to index.html', () => {
    const result = resolveRequest(ROOT, '/', allExist);
    expect(result.status).toBe(200);
    expect(result.filePath).toBe(path.join(ROOT, 'index.html'));
    expect(result.contentType).toBe('text/html; charset=utf-8');
  });

  it('maps a nested directory request (trailing slash) to its index.html', () => {
    const result = resolveRequest(ROOT, '/assets/', allExist);
    expect(result.status).toBe(200);
    expect(result.filePath).toBe(path.join(ROOT, 'assets', 'index.html'));
  });

  it('strips the query string and fragment before resolving', () => {
    const result = resolveRequest(ROOT, '/style.css?v=2#top', allExist);
    expect(result.status).toBe(200);
    expect(result.filePath).toBe(path.join(ROOT, 'style.css'));
  });

  it('percent-decodes the path before resolving', () => {
    const result = resolveRequest(ROOT, '/img/hero%20shot.png', allExist);
    expect(result.status).toBe(200);
    expect(result.filePath).toBe(path.join(ROOT, 'img', 'hero shot.png'));
  });

  it('returns 404 for a path that does not exist on disk', () => {
    const result = resolveRequest(ROOT, '/missing.png', noneExist);
    expect(result.status).toBe(404);
    expect(result.filePath).toBeUndefined();
  });

  it('rejects a `..` traversal escaping the root with 403 (and never probes disk)', () => {
    // allExist would return 200 for anything, so a 403 here proves the guard fires BEFORE `exists`.
    const result = resolveRequest(ROOT, '/../../etc/passwd', allExist);
    expect(result.status).toBe(403);
    expect(result.filePath).toBeUndefined();
  });

  it('rejects an encoded `..` traversal (percent-encoded dot-dot-slash) with 403', () => {
    const result = resolveRequest(ROOT, '/%2e%2e/%2e%2e/etc/passwd', allExist);
    expect(result.status).toBe(403);
  });

  it('rejects an absolute-path escape with 403', () => {
    const result = resolveRequest(ROOT, '/../secret', allExist);
    expect(result.status).toBe(403);
  });

  it('keeps in-root `..` segments that resolve back inside the root (200)', () => {
    const result = resolveRequest(ROOT, '/assets/../style.css', allExist);
    expect(result.status).toBe(200);
    expect(result.filePath).toBe(path.join(ROOT, 'style.css'));
  });

  it('returns 400 for malformed percent-encoding rather than a misleading 404', () => {
    const result = resolveRequest(ROOT, '/bad%', allExist);
    expect(result.status).toBe(400);
  });

  it('returns 400 for a NUL byte in the path', () => {
    const result = resolveRequest(ROOT, '/a%00b.png', allExist);
    expect(result.status).toBe(400);
  });
});
