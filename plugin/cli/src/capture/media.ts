/// <reference lib="dom" />
/**
 * Media as a still: decide what each paused media element actually paints, and replace its live
 * sources in the serialized clone with that still (`--media poster`).
 *
 * The clone is inert and offline, so a video can only ever show one still image there. Keeping its
 * live `src` made the source URL a permanent remote reference (and an incomplete capture) although
 * the pixels were already reproduced: the serializer turns the current frame into a `poster`. The
 * substitution keeps every element, ID, poster and `<source>` child, and moves each source value
 * verbatim into `data-dl-original-src`, which no localization pass reads. Media that paints nothing
 * capturable (`none`) is left exactly as before: a remote `media-skipped` reference and a warning.
 *
 * In-page callbacks are passed to `page.evaluate` and must stay self-contained.
 */

import * as cheerio from 'cheerio';
import type { Page } from 'playwright';

import { documentBaseUrl } from '../localize/document-references.js';
import type { ManifestSubstitution } from '../output/manifest.js';

export type MediaPolicy = 'remote' | 'poster' | 'include';
export type MediaPainted = 'captured-frame' | 'poster-attr' | 'none' | 'invisible';

export interface MediaFact {
  dlId: string;
  tag: 'video' | 'audio';
  painted: MediaPainted;
  readyState: number;
  currentTime: number;
  played: boolean;
  controls: boolean;
  muted: boolean;
  /** Attribute values exactly as authored: the element `src`, then each child `<source src>`. */
  sources: string[];
  poster: string | null;
}

/** Original poster of a video whose painted frame replaces it during serialization. */
export const ORIGINAL_POSTER_ATTRIBUTE = 'data-dl-original-poster';
export const ORIGINAL_SOURCE_ATTRIBUTE = 'data-dl-original-src';

/** Classify every stamped media element in the document and its open shadow roots. */
export function collectMediaFacts(page: Page): Promise<MediaFact[]> {
  return page.evaluate((): MediaFact[] => {
    const facts: MediaFact[] = [];
    const roots: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < roots.length && index < 20_000; index += 1) {
      for (const element of Array.from(roots[index].querySelectorAll('*'))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        if (!(element instanceof HTMLMediaElement)) continue;
        const dlId = element.getAttribute('data-dl-id');
        if (!dlId) continue;
        const box = element.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        const video = element instanceof HTMLVideoElement ? element : null;
        const poster = video?.getAttribute('poster') || null;
        const played = element.played.length > 0;
        let painted: MediaPainted;
        if (!visible) painted = 'invisible';
        else if (!video) painted = 'none';
        // The HTML "show poster" flag: no frame yet, or never played nor seeked.
        else if (poster && (element.readyState < 2 || (!played && element.currentTime === 0))) painted = 'poster-attr';
        else if (element.readyState >= 2) painted = 'captured-frame';
        else painted = 'none';
        const sources = [element.getAttribute('src'), ...Array.from(element.children)
          .filter((child) => child.localName === 'source').map((child) => child.getAttribute('src'))]
          .filter((value): value is string => value !== null && value.trim() !== '');
        facts.push({
          dlId, tag: video ? 'video' : 'audio', painted, readyState: element.readyState,
          currentTime: Number.isFinite(element.currentTime) ? element.currentTime : 0, played,
          controls: element.controls, muted: element.muted, sources, poster,
        });
      }
    }
    return facts;
  });
}

/**
 * The serializer captures a frame only for videos without a poster. A playing video with a poster
 * paints its frame, not the poster, so its poster moves aside while the DOM is serialized; the
 * painted pixels do not change because the frame is already shown. Returns the moved IDs.
 */
export function setAsideFramePosters(page: Page, ids: readonly string[]): Promise<string[]> {
  return page.evaluate(({ ids, attribute }): string[] => {
    const wanted = new Set(ids);
    const moved: string[] = [];
    const roots: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < roots.length && index < 20_000; index += 1) {
      for (const element of Array.from(roots[index].querySelectorAll('*'))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        const id = element.getAttribute('data-dl-id');
        if (!(element instanceof HTMLVideoElement) || !id || !wanted.has(id)) continue;
        const poster = element.getAttribute('poster');
        if (poster === null) continue;
        element.setAttribute(attribute, poster);
        element.removeAttribute('poster');
        moved.push(id);
      }
    }
    return moved;
  }, { ids: [...ids], attribute: ORIGINAL_POSTER_ATTRIBUTE });
}

/** Undo {@link setAsideFramePosters} on the live page before it is photographed again. */
export function restoreFramePosters(page: Page): Promise<number> {
  return page.evaluate((attribute: string): number => {
    let restored = 0;
    const roots: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < roots.length && index < 20_000; index += 1) {
      for (const element of Array.from(roots[index].querySelectorAll('*'))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        const poster = element.getAttribute(attribute);
        if (poster === null) continue;
        element.setAttribute('poster', poster);
        element.removeAttribute(attribute);
        restored += 1;
      }
    }
    return restored;
  }, ORIGINAL_POSTER_ATTRIBUTE);
}

function absolute(raw: string, base: string): string {
  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

export interface MediaSubstitutionResult {
  html: string;
  substitutions: ManifestSubstitution[];
  /** Media that could not be reduced to a still and therefore keeps its live sources. */
  unsubstituted: string[];
}

/**
 * Apply the `poster` policy to serialized HTML. A `captured-frame` video whose serialized document
 * holds no frame poster falls back to its original poster attribute and keeps its live sources, so
 * the capture stays honestly incomplete rather than showing an empty box.
 */
export function substituteMedia(html: string, facts: readonly MediaFact[], pageUrl: string): MediaSubstitutionResult {
  const candidates = facts.filter((fact) => fact.painted !== 'none');
  if (candidates.length === 0 && !html.includes(ORIGINAL_POSTER_ATTRIBUTE)) return { html, substitutions: [], unsubstituted: [] };
  const $ = cheerio.load(html);
  const base = documentBaseUrl($, pageUrl);
  const substitutions: ManifestSubstitution[] = [];
  const unsubstituted: string[] = [];
  for (const fact of candidates) {
    const element = $(`${fact.tag}[data-dl-id="${fact.dlId}"]`);
    if (element.length !== 1) { unsubstituted.push(fact.dlId); continue; }
    if (fact.painted === 'captured-frame' && !/^data:image\//i.test(element.attr('poster') ?? '')) {
      unsubstituted.push(fact.dlId);
      continue;
    }
    const values: string[] = [];
    const move = (node: { attribs: Record<string, string> }): void => {
      const value = node.attribs.src;
      if (value === undefined) return;
      node.attribs[ORIGINAL_SOURCE_ATTRIBUTE] = value;
      delete node.attribs.src;
      if (value.trim() !== '') values.push(value);
    };
    const host = element.get(0);
    if (host && 'attribs' in host) move(host);
    element.children('source').each((_, child) => { if ('attribs' in child) move(child); });
    if (values.length === 0) continue;
    const lost: ManifestSubstitution['lost'] = fact.tag === 'video' ? ['motion'] : [];
    if (fact.tag === 'audio' || !fact.muted) lost.push('audio');
    if (values.length > 1) lost.push('source-alternatives');
    substitutions.push({
      kind: fact.painted === 'captured-frame' ? 'video-frame' : fact.painted === 'poster-attr' ? 'video-poster' : 'media-hidden',
      referencedBy: fact.dlId,
      urls: [...new Set(values.map((value) => absolute(value, base)))],
      stillFrom: fact.painted === 'captured-frame' || fact.painted === 'poster-attr' ? fact.painted : 'none',
      ...(fact.painted === 'captured-frame' ? { currentTime: Math.round(fact.currentTime * 100) / 100 } : {}),
      lost,
    });
  }
  // Every poster set aside for frame capture is either replaced by the frame or restored here.
  $(`video[${ORIGINAL_POSTER_ATTRIBUTE}]`).each((_, node) => {
    const element = $(node);
    const original = element.attr(ORIGINAL_POSTER_ATTRIBUTE);
    if (original !== undefined && !/^data:image\//i.test(element.attr('poster') ?? '')) {
      element.attr('poster', original).removeAttr(ORIGINAL_POSTER_ATTRIBUTE);
    } else if (original !== undefined && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(original.trim())) {
      // A replaced poster is no longer localized, so an absolute URL would be a new live origin
      // reference in the clone; only a relative value is kept as a note.
      element.removeAttr(ORIGINAL_POSTER_ATTRIBUTE);
    }
  });
  return { html: $.html(), substitutions, unsubstituted };
}
