/**
 * Localize a sanitized, serialized document: rewrite every asset reference to a path under
 * `assets/` and collect the bytes to write (PURE over an injected {@link ResourceStore}, no I/O).
 *
 * This is the orchestration the pure primitives (`urlmap`, `css-rewrite`, `srcset`) were built for.
 * It walks the DOM with cheerio, and for every reference that the render actually captured it:
 *   1. maps the absolute URL to a deterministic `assets/<host>/…` path (`urlmap`),
 *   2. rewrites the attribute/`url()`/srcset candidate to that path (relativised to the file it
 *      lives in), and
 *   3. records the captured bytes for the writer to emit.
 * Stylesheets are rewritten recursively: an `@import`ed or `url()`-referenced sheet is fetched from
 * the store, rewritten against ITS OWN url, and enqueued — capturing `@font-face` woff2 and nested
 * `@import` chains. A reserved-before-recurse guard makes circular `@import`s terminate.
 *
 * The localizer NEVER introduces an absolute live-web URL into the output: a reference it does not
 * localise is left BYTE-IDENTICAL to how it was authored and recorded in `remote[]`. That happens for
 * three reasons (spec 02 §6): the bytes are absent from the store (`fetch-failed`), the body exceeds
 * `--max-asset-mb` (`oversize`), or the ref is bulk media and `--include-media` was not passed
 * (`media-skipped`). By the time this pass runs, `localize/fetch-missing.ts` has already gone back for
 * the references the render never requested (unused srcset variants), so "absent from the store" now
 * means "we tried and could not get these bytes". `<a href>` page links, `data:`, `mailto:`, `tel:`
 * and same-document fragments are never touched. This is what keeps the sealed A4 assertion ("no live
 * 127.0.0.1 refs in clone/") true.
 *
 * Spec: specs/02-clone-engine.md §6 (Localize); specs/03-clone-format.md §Directory tree.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';

import { localPathFor } from './urlmap.js';
import { rewriteCss, type CssRefKind } from './css-rewrite.js';
import { rewriteDocumentReferences, type DocumentRefKind } from './document-references.js';
import { sanitizeHtml } from './html-rewrite.js';
import { ResourceStore } from './resource-store.js';
import { isBulkMediaResource, isCssResource, isFontResource, isImageResource } from './media-type.js';
import type { ManifestRemote, RemoteReason, ResourceVia } from '../output/manifest.js';

/** The href of the empty override stylesheet the writer creates; linked LAST in `<head>`. */
export const OVERRIDES_HREF = 'assets/dl-overrides.css';

/** `--max-asset-mb` default (spec 02 §Command surface): bigger bodies stay remote as `oversize`. */
export const DEFAULT_MAX_ASSET_MB = 25;

/**
 * Bytes in the "MB" of `--max-asset-mb`. The spec names the unit only as "MB" and never fixes its
 * base, so we take the binary megabyte — the one `ls -lh`, Finder and every "max upload size" mean.
 * Pinned as a named constant because the flag's observable behaviour (a 1,048,000-byte body at
 * `--max-asset-mb 1`) depends on the choice.
 */
export const BYTES_PER_MB = 1024 * 1024;

/** Policy knobs for what is worth copying out of the store (spec 02 §6 Localize). */
export interface LocalizeOptions {
  /** Bodies STRICTLY larger than this stay remote with reason `oversize`. */
  maxAssetBytes: number;
  /** When false, `mp4/webm/mp3/pdf/zip` refs stay remote with reason `media-skipped`. */
  includeMedia: boolean;
  /** Include a captured-body hash in paths when several viewport captures share an asset tree. */
  contentAddressed?: boolean;
}

/** The policy a bare `localizeDocument(html, url, store)` applies: spec defaults, media excluded. */
const DEFAULT_OPTIONS: LocalizeOptions = {
  maxAssetBytes: DEFAULT_MAX_ASSET_MB * BYTES_PER_MB,
  includeMedia: false,
};

/** The URL's path component, for extension sniffing; falls back to the whole string if unparseable. */
function pathnameOf(absoluteUrl: string): string {
  try {
    return new URL(absoluteUrl).pathname;
  } catch {
    return absoluteUrl;
  }
}

/** One captured resource localised to disk: its `assets/…` path (relative to `clone/`) and bytes. */
export interface LocalizedAsset {
  /** Path under `clone/`, e.g. `assets/example-com/style.css` — what goes into the HTML/CSS. */
  assetPath: string;
  /** The bytes to write (rewritten text for CSS; the captured body verbatim otherwise). */
  body: Buffer;
  /** Content type as captured. */
  contentType: string;
  /** Absolute URL the bytes came from. */
  originalUrl: string;
  /** Provenance of the bytes, carried through from the {@link ResourceStore} entry they came from. */
  via: ResourceVia;
}

/** Everything the writer/manifest/report need from the localize pass. */
export interface LocalizeResult {
  /** The rewritten HTML (with the `dl-overrides.css` link appended last in `<head>`). */
  html: string;
  /** Deduplicated localised resources, in first-seen order. */
  assets: LocalizedAsset[];
  /** References intentionally left remote, deduplicated by URL. */
  remote: ManifestRemote[];
  /** Rollup counters for the manifest/report. */
  stats: { images: number; fonts: number; cssFiles: number };
}

/**
 * Localise every capturable reference in `html`. `pageUrl` is the document's own (final) URL —
 * relative references resolve against it. `store` holds the bytes captured during render, and
 * `options` decides what is worth copying out of it (bulk media, oversize bodies).
 */
export function localizeDocument(
  html: string,
  pageUrl: string,
  store: ResourceStore,
  options: LocalizeOptions = DEFAULT_OPTIONS,
): LocalizeResult {
  const assets = new Map<string, LocalizedAsset>();
  const remote = new Map<string, ManifestRemote>();
  const captureIdentity = options.contentAddressed ? store.fingerprint() : '';

  const recordRemote = (url: string, reason: RemoteReason, referencedBy: string): void => {
    if (!remote.has(url)) remote.set(url, { url, reason, referencedBy });
  };

  /**
   * Localise one absolute reference, returning the `assets/…` path it maps to, or `null` when the
   * reference is left remote (`media-skipped`, `fetch-failed` or `oversize`). `stylesheet` refs are
   * rewritten recursively.
   *
   * The three remote reasons are tested in THIS order, and the order is load-bearing:
   *   1. bulk media, BEFORE the store is consulted — Chromium may never request a `<video src>`
   *      (`preload="none"`, an unsupported codec), and reporting such a ref as `fetch-failed` would
   *      blame the network for a policy decision we made on purpose;
   *   2. absence from the store — by now `fetch-missing` has already gone back for it, so absent
   *      really does mean "we tried and could not get these bytes";
   *   3. size — needs the body, so it can only be judged once we have one. A 30 MB video therefore
   *      reads `media-skipped` by default and `oversize` under `--include-media`, which is the more
   *      informative reason in each case.
   */
  const localizeAsset = (
    absoluteUrl: string,
    kind: DocumentRefKind,
    referencedBy: string,
  ): string | null => {
    const stored = store.get(absoluteUrl);
    if (
      !options.includeMedia &&
      isBulkMediaResource(stored?.contentType ?? '', pathnameOf(absoluteUrl))
    ) {
      recordRemote(absoluteUrl, 'media-skipped', referencedBy);
      return null;
    }
    if (stored === undefined) {
      recordRemote(absoluteUrl, 'fetch-failed', referencedBy);
      return null;
    }
    if (stored.body.byteLength > options.maxAssetBytes) {
      recordRemote(absoluteUrl, 'oversize', referencedBy);
      return null;
    }
    const responseUrl = stored.responseUrl ?? stored.url;
    let assetPath = localPathFor(responseUrl, stored.contentType);
    // The local static server infers MIME from the filename; extensionless/PHP frame routes need HTML.
    if (/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(stored.contentType) &&
      !/\.html?$/i.test(assetPath)) assetPath += '.html';
    if ((kind === 'stylesheet' || isCssResource(stored.contentType, assetPath)) &&
      !/\.css$/i.test(assetPath)) assetPath += '.css';
    if (/^image\/svg\+xml(?:;|$)/i.test(stored.contentType) && !/\.svg$/i.test(assetPath)) assetPath += '.svg';
    if (options.contentAddressed) {
      const ext = path.posix.extname(assetPath);
      const hash = createHash('sha256').update(captureIdentity).update(responseUrl).update(stored.body)
        .digest('hex').slice(0, 16);
      assetPath = `${assetPath.slice(0, -ext.length)}__c-${hash}${ext}`;
    }
    // A URL fragment selects an SVG symbol/filter and never belongs in the disk filename.
    const fragment = new URL(absoluteUrl).hash;
    const referencePath = assetPath + fragment;
    const already = assets.get(assetPath);
    if (already !== undefined) return referencePath;

    // Reserve the slot BEFORE recursing so a circular @import chain terminates on the second visit.
    const entry: LocalizedAsset = {
      assetPath,
      body: Buffer.alloc(0),
      contentType: stored.contentType,
      originalUrl: absoluteUrl,
      // The store knows how the bytes were obtained (render vs refetch); never re-derive it here.
      via: stored.via,
    };
    assets.set(assetPath, entry);

    if (kind === 'stylesheet' || isCssResource(stored.contentType, assetPath)) {
      const resolveInCss = (refUrl: string, refKind: CssRefKind): string | null => {
        const target = localizeAsset(refUrl, refKind === 'import' ? 'stylesheet' : 'leaf', responseUrl);
        if (target === null) return null;
        // A reference inside a CSS file is relative to THAT file's directory, not the page root.
        return path.posix.relative(path.posix.dirname(assetPath), target);
      };
      const { css } = rewriteCss(stored.body.toString('utf8'), responseUrl, resolveInCss);
      entry.body = Buffer.from(css, 'utf8');
    } else if (/^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)(?:;|$)/i.test(stored.contentType)) {
      const xml = /^image\/svg\+xml/i.test(stored.contentType);
      const inert = sanitizeHtml(stored.body.toString('utf8'), { xml });
      entry.body = Buffer.from(rewriteDocumentReferences(inert, responseUrl, (ref) => {
        const target = localizeAsset(ref.url, ref.kind, ref.referencedBy);
        return target === null ? null : path.posix.relative(path.posix.dirname(assetPath), target);
      }, { xml }), 'utf8');
    } else {
      entry.body = stored.body;
    }
    return referencePath;
  };

  const rewritten = rewriteDocumentReferences(html, pageUrl, (ref) =>
    localizeAsset(ref.url, ref.kind, ref.referencedBy),
  );
  const $ = cheerio.load(rewritten);

  // --- the override stylesheet, linked LAST in <head> so its rules win the cascade -------------
  if ($('head').length === 0) $('html').prepend('<head></head>');
  $('head').append(`<link rel="stylesheet" href="${OVERRIDES_HREF}">`);

  const assetList = [...assets.values()];
  return {
    html: $.html(),
    assets: assetList,
    remote: [...remote.values()],
    stats: {
      images: assetList.filter((a) => isImageResource(a.contentType, a.assetPath)).length,
      fonts: assetList.filter((a) => isFontResource(a.contentType, a.assetPath)).length,
      cssFiles: assetList.filter((a) => isCssResource(a.contentType, a.assetPath)).length,
    },
  };
}
