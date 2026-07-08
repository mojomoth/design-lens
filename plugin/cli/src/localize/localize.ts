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
 * The localizer NEVER introduces an absolute live-web URL into the output: a reference whose bytes
 * are absent from the store is left BYTE-IDENTICAL to how it was authored and recorded in `remote[]`.
 * By the time this pass runs, `localize/fetch-missing.ts` has already gone back for the references
 * the render never requested (unused srcset variants), so "absent from the store" now means "we tried
 * and could not get these bytes". `<a href>` page links, `data:`, `mailto:`, `tel:` and same-document
 * fragments are never touched. This is what keeps the sealed A4 assertion ("no live 127.0.0.1 refs in
 * clone/") true.
 *
 * Spec: specs/02-clone-engine.md §6 (Localize); specs/03-clone-format.md §Directory tree.
 */

import path from 'node:path';

import * as cheerio from 'cheerio';

import { localPathFor } from './urlmap.js';
import { rewriteCss, type CssRefKind } from './css-rewrite.js';
import { rewriteSrcset } from './srcset.js';
import { ResourceStore } from './resource-store.js';
import { isCssResource, isFontResource, isImageResource } from './media-type.js';
import type { ManifestRemote, RemoteReason, ResourceVia } from '../output/manifest.js';

/** The href of the empty override stylesheet the writer creates; linked LAST in `<head>`. */
export const OVERRIDES_HREF = 'assets/dl-overrides.css';

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

/** A reference we can never localise: inline payload, mail/tel scheme, or same-document fragment. */
function isUnlocalizable(raw: string): boolean {
  return (
    raw === '' ||
    raw.startsWith('data:') ||
    raw.startsWith('mailto:') ||
    raw.startsWith('tel:') ||
    raw.startsWith('#') ||
    raw.startsWith('javascript:')
  );
}

/**
 * Localise every capturable reference in `html`. `pageUrl` is the document's own (final) URL —
 * relative references resolve against it. `store` holds the bytes captured during render.
 */
export function localizeDocument(html: string, pageUrl: string, store: ResourceStore): LocalizeResult {
  const assets = new Map<string, LocalizedAsset>();
  const remote = new Map<string, ManifestRemote>();

  const recordRemote = (url: string, reason: RemoteReason, referencedBy: string): void => {
    if (!remote.has(url)) remote.set(url, { url, reason, referencedBy });
  };

  /**
   * Localise one absolute reference, returning the `assets/…` path it maps to, or `null` when the
   * bytes were not captured (left remote). `stylesheet` refs are rewritten recursively.
   */
  const localizeAsset = (
    absoluteUrl: string,
    kind: 'stylesheet' | 'leaf',
    referencedBy: string,
  ): string | null => {
    const stored = store.get(absoluteUrl);
    if (stored === undefined) {
      recordRemote(absoluteUrl, 'fetch-failed', referencedBy);
      return null;
    }
    const assetPath = localPathFor(absoluteUrl, stored.contentType);
    const already = assets.get(assetPath);
    if (already !== undefined) return assetPath;

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
        const target = localizeAsset(refUrl, refKind === 'import' ? 'stylesheet' : 'leaf', absoluteUrl);
        if (target === null) return null;
        // A reference inside a CSS file is relative to THAT file's directory, not the page root.
        return path.posix.relative(path.posix.dirname(assetPath), target);
      };
      const { css } = rewriteCss(stored.body.toString('utf8'), absoluteUrl, resolveInCss);
      entry.body = Buffer.from(css, 'utf8');
    } else {
      entry.body = stored.body;
    }
    return assetPath;
  };

  const $ = cheerio.load(html);

  /** Resolve a raw attribute value to an absolute URL, or `null` if it is not localisable. */
  const toAbsolute = (raw: string): string | null => {
    if (isUnlocalizable(raw)) return null;
    try {
      return new URL(raw, pageUrl).href;
    } catch {
      return null;
    }
  };

  /**
   * Localise a leaf attribute value (img `src`, link icon `href`, …), returning the new value to
   * substitute or `null` to leave the attribute exactly as authored (uncaptured or unlocalisable).
   */
  const leafValue = (raw: string | undefined, referencedBy: string): string | null => {
    if (raw === undefined) return null;
    const absolute = toAbsolute(raw);
    if (absolute === null) return null;
    return localizeAsset(absolute, 'leaf', referencedBy);
  };

  /** Localise every candidate in a `srcset`/`imagesrcset` value; `null` when nothing changed. */
  const srcsetValue = (raw: string | undefined, referencedBy: string): string | null => {
    if (raw === undefined) return null;
    const { srcset } = rewriteSrcset(raw, pageUrl, (absolute) => localizeAsset(absolute, 'leaf', referencedBy));
    return srcset === raw ? null : srcset;
  };

  // --- <link> (stylesheet / icon / manifest) --------------------------------------------------
  $('link').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (href === undefined) return;
    const rel = (el.attribs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const referencedBy = $el.attr('data-dl-id') ?? el.name;
    if (rel.includes('stylesheet')) {
      const absolute = toAbsolute(href);
      const localPath = absolute === null ? null : localizeAsset(absolute, 'stylesheet', referencedBy);
      if (localPath !== null) $el.attr('href', localPath);
    } else if (rel.some((r) => ['icon', 'apple-touch-icon', 'mask-icon', 'manifest'].includes(r))) {
      const localPath = leafValue(href, referencedBy);
      if (localPath !== null) $el.attr('href', localPath);
    }
  });

  // --- <style> blocks (folded-in CSSOM rules, author styles) ----------------------------------
  $('style').each((_, el) => {
    const $el = $(el);
    const css = $el.text();
    if (css.trim() === '') return;
    const referencedBy = $el.attr('data-dl-id') ?? el.name;
    // A <style> block lives at the page root, so no relativisation of localised paths is needed.
    const { css: rewritten } = rewriteCss(css, pageUrl, (refUrl, refKind) =>
      localizeAsset(refUrl, refKind === 'import' ? 'stylesheet' : 'leaf', referencedBy),
    );
    if (rewritten !== css) $el.text(rewritten);
  });

  // --- src / srcset / poster / data on media elements -----------------------------------------
  $('img, source').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('data-dl-id') ?? el.name;
    const src = leafValue($el.attr('src'), id);
    if (src !== null) $el.attr('src', src);
    const srcset = srcsetValue($el.attr('srcset'), id);
    if (srcset !== null) $el.attr('srcset', srcset);
  });
  $('video').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('data-dl-id') ?? el.name;
    const src = leafValue($el.attr('src'), id);
    if (src !== null) $el.attr('src', src);
    const poster = leafValue($el.attr('poster'), id);
    if (poster !== null) $el.attr('poster', poster);
  });
  $('audio, track, embed').each((_, el) => {
    const $el = $(el);
    const src = leafValue($el.attr('src'), $el.attr('data-dl-id') ?? el.name);
    if (src !== null) $el.attr('src', src);
  });
  $('object').each((_, el) => {
    const $el = $(el);
    const data = leafValue($el.attr('data'), $el.attr('data-dl-id') ?? el.name);
    if (data !== null) $el.attr('data', data);
  });

  // --- inline style="" url() ------------------------------------------------------------------
  $('[style]').each((_, el) => {
    const $el = $(el);
    const raw = $el.attr('style');
    if (raw === undefined || !raw.includes('url(')) return;
    const referencedBy = $el.attr('data-dl-id') ?? el.name;
    const { css } = rewriteCss(
      raw,
      pageUrl,
      (refUrl, refKind) => localizeAsset(refUrl, refKind === 'import' ? 'stylesheet' : 'leaf', referencedBy),
      { context: 'declarationList' },
    );
    if (css !== raw) $el.attr('style', css);
  });

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
