/**
 * Turn raw @percy/dom serializer output into a standalone, inert clone fragment.
 *
 * `@percy/dom` is built for Percy's SaaS replay pipeline, not for a self-contained file mirror, so
 * its `serialize()` output is NOT directly usable: it stashes real attribute values behind
 * `data-percy-serialized-attribute-<name>` stand-in attributes (the Percy client renames them back
 * at replay), externalizes each `<canvas>` bitmap and every `adoptedStyleSheets`/blob stylesheet into a
 * `resources[]` entry referenced by a `http://render.percy.local/__serialized__/…` URL, and litters
 * the tree with `data-percy-*` bookkeeping attributes. A standalone clone would render blank (no
 * canvas image, no adopted CSS) and leak the fake `render.percy.local` host.
 *
 * This pass, run on the serialized string BEFORE sanitize/localize (spec 02 §M2), makes the output
 * self-contained: it restores the stand-in attributes, inlines each canvas as a `data:` `<img src>`
 * and each externalized stylesheet as an inline `<style>` (both from the `resources[]` payload), and
 * strips all `data-percy-*` attributes. The `data-dl-id` stamps and declarative
 * `<template shadowroot>` shadow roots percy emits are untouched. Pure: parse → mutate → serialize.
 *
 * Spec: specs/02-clone-engine.md §M2 (@percy/dom serializer upgrade).
 */

import * as cheerio from 'cheerio';

/** One `resources[]` entry returned by `PercyDOM.serialize()`. */
export interface PercyResource {
  /** The `render.percy.local` URL the serialized element references. */
  url: string;
  /** Stylesheet text (for `text/css`) or base64 image bytes (for `image/*`). */
  content: string;
  /** MIME type used to build the inlined `data:` URI / decide inline vs. link. */
  mimetype: string;
}

/** The subset of `PercyDOM.serialize()`'s return value this pass consumes. */
export interface PercySerialized {
  html: string;
  resources: PercyResource[];
}

/** Restored HTML plus fidelity counters for the manifest/REPORT (spec 03). */
export interface PercyRestoreResult {
  html: string;
  /** `<canvas>` elements turned into `data:` `<img>` (report fidelity). */
  canvasConverted: number;
  /** Externalized stylesheets (adopted + blob) inlined as `<style>`. */
  adoptedInlined: number;
  /** Declarative `<template shadowroot>` shadow roots percy emitted. */
  shadowRootsSerialized: number;
}

/** Percy stores a real attribute value under this prefix for its client to restore later. */
const PERCY_ATTR_PREFIX = 'data-percy-serialized-attribute-';

/**
 * Restore a raw `PercyDOM.serialize()` payload to a standalone, inline document. See the module
 * doc for the transforms. Never throws on a missing resource — a canvas/link whose bytes are absent
 * is left with its original reference (canvas) or dropped (link) rather than aborting the clone.
 */
export function restorePercyDom(input: PercySerialized): PercyRestoreResult {
  const $ = cheerio.load(input.html);
  const byUrl = new Map(input.resources.map((resource) => [resource.url, resource]));

  // 1. Restore `data-percy-serialized-attribute-<name>` → real `<name>` on every element. This
  //    reifies the `src`/`href` some percy builds hide behind stand-ins BEFORE the canvas/link
  //    passes below read them; builds that emit the real attribute directly are a no-op here.
  $('*').each((_, el) => {
    if (!('attribs' in el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (!name.startsWith(PERCY_ATTR_PREFIX)) continue;
      const realName = name.slice(PERCY_ATTR_PREFIX.length);
      if (realName) $(el).attr(realName, el.attribs[name]);
      $(el).removeAttr(name);
    }
  });

  // 2. Canvas → inline `data:` image. Percy replaced each <canvas> with an <img> whose src points at
  //    a render.percy.local resource holding the base64 PNG; inline it so the clone is a photograph
  //    with no external ref. A missing resource leaves the original src untouched.
  let canvasConverted = 0;
  $('img[data-percy-canvas-serialized]').each((_, el) => {
    const src = el.attribs.src;
    const resource = src ? byUrl.get(src) : undefined;
    if (resource) {
      $(el).attr('src', `data:${resource.mimetype};base64,${resource.content}`);
      canvasConverted += 1;
    }
  });

  // 3. Externalized stylesheets (adoptedStyleSheets + blob sheets) → inline <style>. The CSS text
  //    lives in resources[]; without inlining, adopted-sheet rules (invisible to outerHTML) vanish.
  //    A link whose resource is absent is dropped rather than left pointing at render.percy.local.
  let adoptedInlined = 0;
  $('link[data-percy-adopted-stylesheets-serialized], link[data-percy-blob-stylesheets-serialized]').each(
    (_, el) => {
      const href = el.attribs.href;
      const resource = href ? byUrl.get(href) : undefined;
      if (resource) {
        const style = $('<style></style>');
        // .text() writes a raw text node; cheerio serializes <style> as rawtext (no &gt; escaping),
        // so CSS combinators (`>`) and `::slotted()` survive verbatim.
        style.text(resource.content);
        $(el).replaceWith(style);
        adoptedInlined += 1;
      } else {
        $(el).remove();
      }
    },
  );

  // 4. Count declarative shadow roots (both the legacy `shadowroot` and current `shadowrootmode`
  //    attribute) for the REPORT before we would ever touch them — we never do; they pass through.
  const shadowRootsSerialized = $('template[shadowroot], template[shadowrootmode]').length;

  // 5. Strip all remaining percy bookkeeping (`data-percy-element-id`, `-cssom-serialized`,
  //    `-canvas-serialized`, `-shadow-host`, the just-consumed `-*-serialized` markers, …). Doing
  //    this last means the passes above could still select on those markers.
  $('*').each((_, el) => {
    if (!('attribs' in el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (name.startsWith('data-percy-')) $(el).removeAttr(name);
    }
  });

  return { html: $.html(), canvasConverted, adoptedInlined, shadowRootsSerialized };
}
