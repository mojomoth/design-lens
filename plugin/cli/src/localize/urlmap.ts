/**
 * Deterministic URL → local-path mapping for clone assets (PURE module, no I/O).
 *
 * `localPathFor` turns an absolute asset URL into a stable path under `assets/`, so the HTML/CSS
 * rewriters can compute a reference's destination BEFORE its body is fetched (same URL ⇒ same
 * path). The pipeline resolves fetches before the final rewrite pass, so `contentType` is known
 * when an extension must be inferred. Determinism is what lets rewriting precede fetching.
 *
 * The mapping is also a security boundary: percent-encoded traversal (`%2e%2e`) and stray path
 * separators are neutralised here so no asset can ever be written above `assets/`.
 *
 * Spec: specs/02-clone-engine.md §urlmap.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

/** contentType (sans parameters) → file extension when a URL path carries none. */
const CONTENT_TYPE_EXT: Readonly<Record<string, string>> = {
  'text/css': '.css',
  'font/woff2': '.woff2',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/** The safe fallback when no extension is present and the contentType is unknown/unmapped. */
const DEFAULT_EXT = '.bin';

/** Only these characters survive a path segment unescaped; everything else becomes `_`. */
const UNSAFE_SEGMENT_CHARS = /[^A-Za-z0-9._-]/g;

/** A segment longer than this is truncated to a hashed form so no path component is unbounded. */
const MAX_SEGMENT_LEN = 100;

/** First 8 hex chars of the sha256 of `input` — a short, collision-resistant, deterministic tag. */
function sha8(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/** Percent-decode a raw segment, tolerating malformed encoding by falling back to the raw text. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Sanitise one already-decoded, dot-resolved segment: replace filesystem/traversal-unsafe
 * characters with `_`, then collapse an overlong segment to `first-91` + `-` + sha8(full) so the
 * result never exceeds MAX_SEGMENT_LEN characters while staying deterministic.
 */
function cleanSegment(decoded: string): string {
  const safe = decoded.replace(UNSAFE_SEGMENT_CHARS, '_');
  if (safe.length > MAX_SEGMENT_LEN) {
    return `${safe.slice(0, 91)}-${sha8(safe)}`;
  }
  return safe;
}

/** Extension for a URL whose final path segment carries none, inferred from the contentType. */
function inferExtension(contentType?: string): string {
  if (contentType === undefined) return DEFAULT_EXT;
  const bare = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[bare] ?? DEFAULT_EXT;
}

/**
 * Compose the final filename: keep an existing extension, otherwise append the inferred one; and
 * when the URL carried a query string, fold it into `__q-<hash>` inserted BEFORE the extension so
 * two URLs differing only by query never collide on disk.
 */
function finalizeFilename(segment: string, query: string, contentType?: string): string {
  const existingExt = path.extname(segment);
  const ext = existingExt === '' ? inferExtension(contentType) : existingExt;
  let stem = existingExt === '' ? segment : segment.slice(0, segment.length - existingExt.length);
  if (query !== '') stem += `__q-${sha8(query)}`;
  return stem + ext;
}

/**
 * Map an absolute asset URL to a deterministic local path under `assets/`.
 *
 * Layout: `assets/<host>/<path…>`, where `<host>` is the lowercased hostname (default ports
 * dropped; a non-default port becomes `<hostname>-<port>` because `:` is illegal on Windows and
 * the two fixture CDNs differ only by port). An empty or trailing-slash path yields `…/index`;
 * a missing extension is inferred from `contentType`; a query string folds into `__q-<hash>`.
 *
 * @throws if `url` is not a parseable URL or lacks a hostname (callers never localise
 *   `data:`/`mailto:`/fragment references — those are left remote upstream).
 */
export function localPathFor(url: string, contentType?: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`localPathFor: invalid URL: ${url}`);
  }
  if (parsed.hostname === '') {
    throw new Error(`localPathFor: URL has no host: ${url}`);
  }

  // Host segment: hostname is already lowercased by the URL parser; the parser also drops the
  // port when it is the scheme default, so a non-empty `.port` is always a real, non-default one.
  // Non-alphanumerics (dots in `example.com`/`127.0.0.1`, colons in IPv6) collapse to `-` so the
  // directory name is a flat, portable slug: it is Windows-legal AND never embeds a literal host
  // like `127.0.0.1` into the clone (the sealed A4 assertion forbids that substring inside
  // `clone/` — ADR-011). Two hosts differing only by port stay distinct via the `-<port>` suffix.
  const hostBase = parsed.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  const host = parsed.port === '' ? hostBase : `${hostBase}-${parsed.port}`;

  // Decode BEFORE resolving `.`/`..` so encoded traversal (`%2e%2e`) collapses too, then sanitise.
  const resolved: string[] = [];
  for (const raw of parsed.pathname.split('/')) {
    if (raw === '') continue;
    const seg = decodeSegment(raw);
    if (seg === '.') continue;
    if (seg === '..') {
      resolved.pop(); // pops only within the path — the host segment can never be escaped
      continue;
    }
    resolved.push(seg);
  }

  const segments = resolved.map(cleanSegment);
  // Empty path or a trailing slash denotes a directory: its resource is the implicit `index`.
  if (segments.length === 0 || parsed.pathname.endsWith('/')) {
    segments.push('index');
  }

  const query = parsed.search === '' ? '' : parsed.search.slice(1);
  const last = segments.length - 1;
  segments[last] = finalizeFilename(segments[last], query, contentType);

  return `assets/${host}/${segments.join('/')}`;
}
