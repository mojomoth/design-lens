import { describe, it, expect } from 'vitest';

import {
  OVERRIDES_LOCAL_PATH,
  inlineStyleBlocks,
  inlineCssSources,
  selectManifestCssPaths,
} from '../../src/analyze/css-sources.js';

const resource = (localPath: string, contentType: string): Record<string, unknown> => ({
  localPath,
  contentType,
  originalUrl: `https://example.test/${localPath}`,
  bytes: 1,
  sha256: 'x',
  via: 'network',
});

// Why: inline CSS is visible evidence even without a stylesheet; frame and shadow declarations must be counted too.
describe('inlineCssSources', () => {
  it('retains provenance and selector subjects for markup, shadow and srcdoc declarations', () => {
    const html = '<style>h1{color:red}</style><h1 style="font:700 24px Display">Heading</h1>' +
      '<div><template shadowrootmode="open"><p style="color:blue">Copy</p></template></div>' +
      '<iframe srcdoc="&lt;body style=&quot;padding:16px&quot;&gt;&lt;style&gt;p{color:green}&lt;/style&gt;&lt;/body&gt;"></iframe>';
    const sources = inlineCssSources(html);
    expect(sources.map((source) => source.kind)).toEqual([
      'style-block', 'style-attribute', 'style-attribute', 'style-attribute', 'style-block',
    ]);
    expect(sources[1].css).toMatch(/h1:nth-child\(1\)\{font:700 24px Display\}$/);
    expect(sources[2].css).toContain('p:nth-child(1){color:blue}');
    expect(sources[3].path).toContain('#srcdoc-');
    expect(sources[4].css).toBe('p{color:green}');
    expect(new Set(sources.map((source) => source.path)).size).toBe(sources.length);
  });
});

describe('selectManifestCssPaths', () => {
  // why: the localizer decided a resource was a stylesheet on EITHER witness — the `text/css`
  // header or the `.css` extension. `tokens` must use the identical rule or it silently analyzes
  // fewer bytes than were captured: a stylesheet served as `application/octet-stream`, or one at an
  // extensionless URL, would vanish from the design analysis with no warning anywhere.
  it('accepts a stylesheet on either the content-type or the .css extension', () => {
    const manifest = {
      resources: [
        resource('clone/assets/h/style.css', 'text/css; charset=utf-8'),
        resource('clone/assets/h/theme', 'text/css'),
        resource('clone/assets/h/late.css', 'application/octet-stream'),
        resource('clone/assets/h/logo.svg', 'image/svg+xml'),
        resource('clone/assets/h/brand.woff2', 'font/woff2'),
      ],
    };

    expect(selectManifestCssPaths(manifest)).toEqual({
      paths: ['clone/assets/h/style.css', 'clone/assets/h/theme', 'clone/assets/h/late.css'],
      warnings: [],
    });
  });

  // why: `dl-overrides.css` is the USER's edit layer. If tokens read it back, then every time a
  // user customized the clone the "reference site's design" would drift toward the user's own
  // edits — the analysis would slowly describe the copy instead of the original. This is the single
  // most important exclusion in the whole command.
  it('never analyzes the user override stylesheet', () => {
    const manifest = {
      resources: [resource(OVERRIDES_LOCAL_PATH, 'text/css'), resource('clone/assets/h/a.css', 'text/css')],
    };
    expect(selectManifestCssPaths(manifest).paths).toEqual(['clone/assets/h/a.css']);
  });

  // why: manifest order is spec 05's concatenation order, and CSS is order-dependent (later rules
  // win). Shuffling sources would change nothing about the token histograms today, but would break
  // the "same bytes in, same bytes out" promise the moment any cascade-aware logic lands.
  it('preserves manifest order', () => {
    const manifest = {
      resources: ['c.css', 'a.css', 'b.css'].map((n) => resource(`clone/assets/h/${n}`, 'text/css')),
    };
    expect(selectManifestCssPaths(manifest).paths).toEqual([
      'clone/assets/h/c.css',
      'clone/assets/h/a.css',
      'clone/assets/h/b.css',
    ]);
  });

  // why: `tokens` takes `unknown` off disk. A hand-edited or truncated manifest must degrade to a
  // WARNING and an empty analysis, never a TypeError crash — and never a silent empty result
  // either, which would look exactly like "this site has no CSS" (CONVENTIONS.md: no bare
  // catch-and-continue).
  it('warns instead of throwing on a structurally broken manifest', () => {
    expect(selectManifestCssPaths({}).warnings).toHaveLength(1);
    expect(selectManifestCssPaths(null).warnings).toHaveLength(1);
    expect(selectManifestCssPaths({ resources: 'nope' }).paths).toEqual([]);

    const partial = selectManifestCssPaths({
      resources: [{ contentType: 'text/css' }, resource('clone/assets/h/a.css', 'text/css')],
    });
    expect(partial.paths).toEqual(['clone/assets/h/a.css']);
    expect(partial.warnings[0]).toMatch(/resources\[0\]/);
  });
});

describe('inlineStyleBlocks', () => {
  // why: spec 05 counts `<style>` blocks as a first-class CSS source in DOCUMENT order. A page that
  // ships its brand color only in a critical-CSS `<style>` head block — extremely common — would
  // otherwise report no colors at all.
  it('returns every non-empty style block in document order', () => {
    const html = '<html><head><style>a{color:red}</style><style>  </style></head><body><style>b{color:blue}</style></body></html>';
    expect(inlineStyleBlocks(html)).toEqual(['a{color:red}', 'b{color:blue}']);
  });

  // why: inline `style=""` attributes are explicitly excluded by spec 05 — they carry no selector
  // and cannot be reasoned about as design tokens. This guards against a future "just grab all the
  // CSS" refactor pulling them in.
  it('ignores inline style attributes', () => {
    expect(inlineStyleBlocks('<p style="color:red">x</p>')).toEqual([]);
  });

  // why: T12 serializes open shadow roots into `<template shadowroot>`. A web-component-heavy
  // reference site keeps most of its design in there; dropping those stylesheets would under-count
  // its colors and typography to near-nothing.
  it('descends into declarative shadow-root templates', () => {
    const html = '<div><template shadowroot="open"><style>:host{color:#3347ff}</style></template></div>';
    expect(inlineStyleBlocks(html)).toEqual([':host{color:#3347ff}']);
  });

  // why: `tokens` runs on a clone whose `<script>` tags were stripped, but a `<style>` inside a
  // comment or a malformed document must not throw — the command is expected to exit 0.
  it('survives markup with no styles at all', () => {
    expect(inlineStyleBlocks('<p>hi')).toEqual([]);
  });
});
