/** One resource walk shared by discovery and rewriting, including embedded documents and SVG. */
import * as cheerio from 'cheerio';

import { rewriteCss } from './css-rewrite.js';
import { rewriteSrcset } from './srcset.js';

export type DocumentRefKind = 'stylesheet' | 'leaf' | 'document';
export interface DocumentReference {
  url: string;
  kind: DocumentRefKind;
  via: 'refetch' | 'css-fetch';
  referencedBy: string;
}
export type DocumentResolver = (reference: DocumentReference) => string | null;

export const MAX_DOCUMENT_DEPTH = 16;

/** Resolve only downloadable references; preserve SVG fragments and inline payloads. */
export function resourceUrl(raw: string, baseUrl: string): string | null {
  if (!raw.trim() || raw.trimStart().startsWith('#')) return null;
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The first base href controls all relative references until localization removes the element. */
export function documentBaseUrl($: ReturnType<typeof cheerio.load>, pageUrl: string): string {
  const href = $('base[href]').first().attr('href');
  if (href === undefined) return pageUrl;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return pageUrl;
  }
}

export interface DocumentRewriteOptions {
  xml?: boolean;
  depth?: number;
}

/** Return rewritten markup; a resolver returning null makes this a pure resource discovery pass. */
export function rewriteDocumentReferences(
  html: string,
  pageUrl: string,
  resolve: DocumentResolver,
  options: DocumentRewriteOptions = {},
): string {
  const depth = options.depth ?? 0;
  if (depth > MAX_DOCUMENT_DEPTH) throw new Error(`embedded document depth exceeds ${MAX_DOCUMENT_DEPTH}`);
  const $ = cheerio.load(html, options.xml ? { xml: true } : undefined);
  const baseUrl = documentBaseUrl($, pageUrl);

  $('*').each((_, el) => {
    if (!('attribs' in el)) return;
    const $el = $(el);
    const tag = el.name.toLowerCase();
    const referencedBy = $el.attr('data-dl-id') ?? tag;
    const attr = (name: string, kind: DocumentRefKind = 'leaf'): void => {
      const raw = $el.attr(name);
      if (raw === undefined) return;
      const url = resourceUrl(raw, baseUrl);
      if (url === null) return;
      const value = resolve({ url, kind, via: 'refetch', referencedBy });
      if (value !== null) $el.attr(name, value);
    };
    const css = (text: string, inline: boolean): string => rewriteCss(
      text,
      baseUrl,
      (url, kind) => resolve({
        url, kind: kind === 'import' ? 'stylesheet' : 'leaf', via: 'css-fetch', referencedBy,
      }),
      inline ? { context: 'declarationList' } : {},
    ).css;
    const srcset = (name: string): void => {
      const raw = $el.attr(name);
      if (raw === undefined) return;
      const rewritten = rewriteSrcset(raw, baseUrl, (url) => {
        const candidate = resourceUrl(url, baseUrl);
        return candidate === null ? null : resolve({
          url: candidate, kind: 'leaf', via: 'refetch', referencedBy,
        });
      });
      if (rewritten.refs.length > 0) $el.attr(name, rewritten.srcset);
    };

    if (tag === 'link') {
      const rel = ($el.attr('rel') ?? '').toLowerCase().split(/\s+/);
      const as = ($el.attr('as') ?? '').toLowerCase();
      if (rel.includes('stylesheet')) attr('href', 'stylesheet');
      else if (rel.some((r) => ['icon', 'apple-touch-icon', 'mask-icon', 'manifest'].includes(r)) ||
        (rel.some((r) => r === 'preload' || r === 'prefetch') && as !== 'script')) {
        attr('href', as === 'style' ? 'stylesheet' : 'leaf');
      }
      srcset('imagesrcset');
    }
    if (['img', 'source', 'video', 'audio', 'track', 'embed'].includes(tag)) attr('src');
    if (tag === 'img' || tag === 'source') srcset('srcset');
    if (tag === 'video') attr('poster');
    if (tag === 'input' && ($el.attr('type') ?? '').toLowerCase() === 'image') attr('src');
    if (tag === 'object') attr('data');
    if (['body', 'table', 'td', 'th'].includes(tag)) attr('background');
    if (['image', 'use', 'feimage', 'mpath', 'textpath'].includes(tag)) {
      attr('href');
      attr('xlink:href');
    }

    if (tag === 'iframe') {
      const srcdoc = $el.attr('srcdoc');
      if (srcdoc !== undefined) {
        $el.attr('srcdoc', rewriteDocumentReferences(srcdoc, baseUrl, resolve, { depth: depth + 1 }));
        // srcdoc wins over src in Chromium; retaining src would be a spurious remote resource.
        $el.removeAttr('src');
      } else attr('src', 'document');
    }

    if (tag === 'style' && $el.text().trim()) $el.text(css($el.text(), false));
    const style = $el.attr('style');
    if (style !== undefined) $el.attr('style', css(style, true));
    for (const name of ['fill', 'stroke', 'filter', 'mask', 'clip-path', 'marker', 'marker-start', 'marker-mid', 'marker-end']) {
      const value = $el.attr(name);
      if (value !== undefined && /url\s*\(/i.test(value)) {
        $el.attr(name, css(`${name}:${value}`, true).slice(name.length + 1).replace(/;$/, ''));
      }
    }
  });

  $('base').remove();
  return $.html();
}
