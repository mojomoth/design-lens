import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';

import { restorePercyDom, type PercyResource } from '../../src/capture/percy-restore.js';

/**
 * `@percy/dom`'s serializer output is built for Percy's replay SaaS, not a standalone file mirror:
 * it hides attribute values behind `data-percy-serialized-attribute-*`, externalizes canvas bitmaps
 * and adopted/blob stylesheets to `render.percy.local` resources, and stamps `data-percy-*`
 * bookkeeping everywhere. `restorePercyDom` is what makes that output self-contained and inert.
 * These tests pin the four transforms (attribute restore, canvas inline, stylesheet inline, marker
 * strip) plus the fidelity counters. If any regresses, clones would render blank canvases / lose
 * adopted CSS / leak the fake `render.percy.local` host — none of which the browser e2e alone would
 * localize to a specific cause.
 */

/** Load restore output into cheerio so assertions run on the parsed DOM, not brittle substrings. */
function restore(html: string, resources: PercyResource[] = []): {
  $: cheerio.CheerioAPI;
  html: string;
  canvasConverted: number;
  adoptedInlined: number;
  shadowRootsSerialized: number;
} {
  const result = restorePercyDom({ html, resources });
  return { ...result, $: cheerio.load(result.html) };
}

const PNG_RES: PercyResource = {
  url: 'http://render.percy.local/__serialized__/abc.png',
  content: 'iVBORw0KGgoAAAANSUhEUg==',
  mimetype: 'image/png',
};
const CSS_RES: PercyResource = {
  url: 'http://render.percy.local/__serialized__/def.css',
  content: '.marker > .child { color: rgb(1, 2, 3); }',
  mimetype: 'text/css',
};

// why: some percy builds emit the real src/href only under a `data-percy-serialized-attribute-*`
// placeholder that its client renames back at replay. If we did not restore it, links/images in the
// clone would have no usable attribute. Guards the generic restore that also feeds the canvas/link
// passes below.
describe('restorePercyDom — placeholder attribute restore', () => {
  it('renames data-percy-serialized-attribute-<name> to the real attribute', () => {
    const { $ } = restore(
      '<html><body><a data-percy-serialized-attribute-href="https://example.com/x">l</a></body></html>',
    );
    const a = $('a');
    expect(a.attr('href')).toBe('https://example.com/x');
    expect(a.attr('data-percy-serialized-attribute-href')).toBeUndefined();
  });
});

// why: percy replaces <canvas> (whose bitmap is lost by outerHTML) with an <img> pointing at a
// render.percy.local resource holding the base64 PNG. Inlining it as a data: URI is what preserves
// the painted pixels in a photograph-not-a-program clone. If this regressed, the SPA e2e's canvas
// would be a broken cross-origin image.
describe('restorePercyDom — canvas inline', () => {
  it('inlines the canvas image as a data: URI and counts it', () => {
    const { $, canvasConverted } = restore(
      `<html><body><img data-dl-id="dl-3" data-percy-canvas-serialized="" data-percy-element-id="e1" src="${PNG_RES.url}"></body></html>`,
      [PNG_RES],
    );
    const img = $('img');
    expect(img.attr('src')).toBe(`data:image/png;base64,${PNG_RES.content}`);
    expect(canvasConverted).toBe(1);
    expect(img.attr('data-dl-id')).toBe('dl-3'); // the stamp survives
  });

  it('leaves the canvas img untouched (no crash) when its resource is absent', () => {
    const { $, canvasConverted } = restore(
      `<html><body><img data-percy-canvas-serialized="" src="${PNG_RES.url}"></body></html>`,
      [],
    );
    expect($('img').attr('src')).toBe(PNG_RES.url);
    expect(canvasConverted).toBe(0);
  });
});

// why: adoptedStyleSheets rules are invisible to outerHTML; percy externalizes them to a resource
// and a <link>. Inlining that resource as a <style> is the ONLY way those rules reach the clone —
// the SPA e2e's `rgb(1, 2, 3)` marker depends on it. The `>` combinator check guards against
// cheerio HTML-escaping CSS (which would corrupt every child selector).
describe('restorePercyDom — externalized stylesheet inline', () => {
  it('replaces an adopted-stylesheet link with an inline <style>, unescaped, and counts it', () => {
    const { $, html, adoptedInlined } = restore(
      `<html><body><link rel="stylesheet" data-percy-adopted-stylesheets-serialized="true" href="${CSS_RES.url}"></body></html>`,
      [CSS_RES],
    );
    expect($('link')).toHaveLength(0);
    expect($('style')).toHaveLength(1);
    expect($('style').text()).toContain('rgb(1, 2, 3)');
    expect(html).toContain('.marker > .child'); // raw `>`, not `&gt;`
    expect(html).not.toContain('&gt;');
    expect(adoptedInlined).toBe(1);
  });

  it('drops an externalized stylesheet link with no matching resource (no render.percy.local leak)', () => {
    const { html, adoptedInlined } = restore(
      `<html><body><link rel="stylesheet" data-percy-blob-stylesheets-serialized="true" href="${CSS_RES.url}"></body></html>`,
      [],
    );
    expect(html).not.toContain('render.percy.local');
    expect(html).not.toContain('<link');
    expect(adoptedInlined).toBe(0);
  });
});

// why: `data-percy-*` markers are Percy internal bookkeeping; if they survived they would bloat the
// clone and confuse the inspect role classifier. The strip must run AFTER the canvas/link passes
// (which select on those markers), so this pins ordering as much as the strip itself.
describe('restorePercyDom — marker strip', () => {
  it('removes every residual data-percy-* attribute but keeps real ones', () => {
    const { $ } = restore(
      '<html><body><div data-percy-element-id="e2" data-percy-shadow-host="" data-dl-id="dl-1" class="keep">x</div></body></html>',
    );
    const div = $('div');
    expect(div.attr('data-percy-element-id')).toBeUndefined();
    expect(div.attr('data-percy-shadow-host')).toBeUndefined();
    expect(div.attr('data-dl-id')).toBe('dl-1');
    expect(div.attr('class')).toBe('keep');
  });
});

// why: the REPORT fidelity block reports how many shadow roots percy serialized. Both the legacy
// `shadowroot` and current `shadowrootmode` attribute forms must be counted, and the <template>
// content must pass through untouched (it is the shadow DOM the clone renders declaratively).
describe('restorePercyDom — shadow root count', () => {
  it('counts declarative template shadow roots in either attribute form and preserves them', () => {
    const { $, html, shadowRootsSerialized } = restore(
      '<html><body>' +
        '<dl-a><template shadowroot="open"><span>a</span></template></dl-a>' +
        '<dl-b><template shadowrootmode="open"><span>b</span></template></dl-b>' +
        '</body></html>',
    );
    expect(shadowRootsSerialized).toBe(2);
    expect($('template').length).toBe(2);
    // Shadow content passes through untouched. (cheerio parks <template> content in a fragment the
    // descendant combinator won't cross, so assert on the serialized markup, which is what ships.)
    expect(html).toContain('<span>a</span>');
    expect(html).toContain('<span>b</span>');
  });
});

describe('restorePercyDom — generated video posters', () => {
  it('retains serializer warnings alongside restoration diagnostics', () => {
    const result = restorePercyDom({ html: '<body></body>', resources: [], warnings: ['unsupported canvas context'] });
    expect(result.warnings).toEqual(['@percy/dom: unsupported canvas context']);
  });

  it('inlines a generated poster while retaining authored posters and media attributes', () => {
    const { $ } = restore(`<video data-dl-id="dl-1" muted loop data-percy-serialized-attribute-poster="${PNG_RES.url}"></video>
      <video poster="assets/authored.jpg"></video>`, [PNG_RES]);
    expect($('video').first().attr('poster')).toBe(`data:image/png;base64,${PNG_RES.content}`);
    expect($('video').first().attr('data-dl-id')).toBe('dl-1');
    expect($('video').first().attr('loop')).toBeDefined();
    expect($('video').last().attr('poster')).toBe('assets/authored.jpg');
  });

  it('reports missing generated resources instead of silently losing visual content', () => {
    const result = restorePercyDom({ html: `<video poster="${PNG_RES.url}"></video>
      <img data-percy-canvas-serialized src="${PNG_RES.url}">
      <link data-percy-adopted-stylesheets-serialized href="${CSS_RES.url}">`, resources: [] });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join(' ')).toContain('video poster resource is missing');
    expect(result.warnings.join(' ')).toContain('canvas resource is missing');
    expect(result.warnings.join(' ')).toContain('stylesheet resource is missing');
  });
});
