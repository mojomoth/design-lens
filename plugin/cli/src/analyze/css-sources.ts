/**
 * Decide WHICH CSS a clone's design tokens are allowed to come from (PURE, no I/O).
 *
 * Sources include localized stylesheets, style blocks and inline declarations from clone markup.
 *
 * Two exclusions are load-bearing, not cosmetic:
 *   - `clone/assets/dl-overrides.css` is the USER's edit layer. Feeding it back in would make
 *     `tokens` report the user's own overrides as the reference site's design — the analysis would
 *     drift a little further from the original every time someone customized the clone.
 * Inline declarations carry explicit document/element provenance. These are current-clone CSS
 * counts, not claims about the original page's rendered design.
 *
 * Spec: specs/05-element-inventory.md §tokens; specs/03-clone-format.md (manifest shape).
 */

import * as cheerio from 'cheerio';

import { isCssResource } from '../localize/media-type.js';

/** The user's edit layer, addressed exactly as the manifest would address it. */
export const OVERRIDES_LOCAL_PATH = 'clone/assets/dl-overrides.css';

export interface ManifestCssSelection {
  /** Project-dir-relative `clone/assets/…` paths, in manifest order. */
  paths: string[];
  /** Structural complaints about the manifest — surfaced, never swallowed (CONVENTIONS.md). */
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The manifest-listed stylesheets, in manifest order.
 *
 * A resource is CSS if the server said `text/css` OR the stored path ends in `.css` — the same
 * either-witness rule the localizer used to decide it was a stylesheet in the first place. Using a
 * stricter rule here would silently analyze fewer bytes than were captured.
 */
export function selectManifestCssPaths(manifest: unknown): ManifestCssSelection {
  const paths: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(manifest) || !Array.isArray(manifest.resources)) {
    return { paths, warnings: ['manifest has no `resources` array; no captured CSS analyzed'] };
  }

  manifest.resources.forEach((resource, index) => {
    if (!isRecord(resource) || typeof resource.localPath !== 'string') {
      warnings.push(`manifest.resources[${index}] has no string localPath; skipped`);
      return;
    }
    const { localPath } = resource;
    const contentType = typeof resource.contentType === 'string' ? resource.contentType : '';
    if (!isCssResource(contentType, localPath)) return;
    if (localPath === OVERRIDES_LOCAL_PATH) return;
    paths.push(localPath);
  });

  return { paths, warnings };
}

/**
 * The text of every `<style>` block in the clone document, in document order.
 *
 * Includes styles nested in `<template shadowroot>` fragments: a shadow root's stylesheet is as
 * much a part of the captured design as a top-level one, and dropping it would under-count the
 * colors of any web-component-heavy reference site.
 */
export function inlineStyleBlocks(html: string): string[] {
  const $ = cheerio.load(html);
  const blocks: string[] = [];
  $('style').each((_index, element) => {
    const css = $(element).html() ?? '';
    if (css.trim().length > 0) blocks.push(css);
  });
  return blocks;
}

export interface InlineCssSource {
  path: string;
  kind: 'style-block' | 'style-attribute';
  css: string;
}

/** Current markup CSS, including declaration attributes and nested static frame documents. */
export function inlineCssSources(html: string, documentPath = 'clone/index.html', depth = 0): InlineCssSource[] {
  if (depth > 16) throw new Error('inline CSS document depth exceeds 16');
  const $ = cheerio.load(html);
  const sources: InlineCssSource[] = [];
  $('style, [style], iframe[srcdoc]').each((index, element) => {
    const $element = $(element);
    if (element.name.toLowerCase() === 'style') {
      const css = $element.html() ?? '';
      if (css.trim()) sources.push({ path: `${documentPath}#style-${index}`, kind: 'style-block', css });
    }
    const declaration = $element.attr('style');
    if (declaration?.trim()) {
      // nth-child paths identify unstamped legacy clones without inventing classes or IDs.
      const selector = [...$element.parents().toArray().reverse(), element].map((node) => {
        const tag = node.name;
        return `${tag}:nth-child(${$(node).prevAll().length + 1})`;
      }).join('>');
      sources.push({
        path: `${documentPath}#style-attribute-${index}`, kind: 'style-attribute',
        css: `${selector}{${declaration}}`,
      });
    }
    const srcdoc = $element.attr('srcdoc');
    if (srcdoc !== undefined) sources.push(...inlineCssSources(srcdoc, `${documentPath}#srcdoc-${index}`, depth + 1));
  });
  return sources;
}
