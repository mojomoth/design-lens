import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';

import { normalizeParagraphSelectors, normalizeParagraphStyles } from '../../src/localize/paragraph-selectors.js';
import { localizeDocument } from '../../src/localize/localize.js';
import { ResourceStore } from '../../src/localize/resource-store.js';

describe('paragraph selector normalization', () => {
  it('rewrites nested type and defined selectors without touching strings or declarations', () => {
    const normalized = normalizeParagraphSelectors('main>p:nth-of-type(2),p:is(.lead,:not(.last)):has(p)::before{content:"p:defined";--tag:p}p:defined{color:red}:not(:defined){display:none}', 'dl-static-p');
    expect(normalized).toContain('main>:is(p,*|dl-static-p):nth-of-type(2)');
    expect(normalized).toContain(':has(:is(p,*|dl-static-p))');
    expect(normalized).toContain(':not(:is(:defined,:where(*|dl-static-p)))');
    expect(normalized).toContain('content:"p:defined";--tag:p');
    expect(normalizeParagraphSelectors(normalized, 'dl-static-p')).toBe(normalized);
  });

  it('preserves opaque browser and vendor declaration values byte-for-byte while mapping selectors', () => {
    const declarations = ` color: attr(data-tone type(<color>), rgb(2, 90, 140));\n  filter: progid:DXImageTransform.Microsoft.gradient(startColorstr="#000", endColorstr="#fff"); --sample: p:defined; `;
    const warnings: string[] = [];
    const normalized = normalizeParagraphSelectors(`/* source spacing */ p {${declarations}}`, 'dl-static-p', warnings);
    expect(normalized).toBe(`/* source spacing */ :is(p,*|dl-static-p) {${declarations}}`);
    expect(warnings).toEqual([]);
  });

  it('maps safe rules beside unsupported selectors and nesting while preserving the raw syntax', () => {
    const unsupported = 'p[=broken] { color: lime } .scope { .nested p { color: purple } }';
    const css = `p { color: blue } ${unsupported} p:defined { padding: 2px }`;
    const warnings: string[] = [];
    const normalized = normalizeParagraphSelectors(css, 'dl-static-p', warnings);
    expect(normalized).toContain(':is(p,*|dl-static-p) { color: blue }');
    expect(normalized).toContain(unsupported);
    expect(normalized).toContain(':is(p,*|dl-static-p):is(:defined,:where(*|dl-static-p)) { padding: 2px }');
    expect(warnings.join(' ')).toContain('paragraph selector parsing failed');
    expect(() => normalizeParagraphSelectors(css, 'dl-static-p')).toThrow('paragraph selector parsing failed');
    const inline = normalizeParagraphStyles(`<html data-dl-paragraph-alias="dl-static-p"><head><style>${css}</style></head><body></body></html>`);
    expect(inline.html).toContain(':is(p,*|dl-static-p) { color: blue }');
    expect(inline.html).toContain(unsupported);
    expect(inline.warnings.join(' ')).toContain('paragraph selector parsing failed');
  });

  it('keeps namespace-qualified foreign paragraphs and adapts HTML-qualified selectors', () => {
    const normalized = normalizeParagraphSelectors('@namespace html url("http://www.w3.org/1999/xhtml");@namespace svg url("http://www.w3.org/2000/svg");html|p,svg|p,|p,*|p{color:red}', 'dl-static-p-2');
    expect(normalized).toContain('html|dl-static-p-2,svg|p,|p,:is(*|p,*|dl-static-p-2)');
    expect(normalizeParagraphSelectors('@namespace url("http://www.w3.org/2000/svg");p{color:red}', 'dl-static-p')).toContain(';p{color:red}');
  });

  it('normalizes restored shadow styles and reports unsupported selector parsing', () => {
    const result = normalizeParagraphStyles('<html data-dl-paragraph-alias="dl-static-p"><body><div><template shadowrootmode="open"><style>p{color:red}</style></template></div></body></html>');
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain(':is(p,*|dl-static-p)');
    expect(() => normalizeParagraphSelectors('p[broken{color:red}', 'dl-static-p')).toThrow('paragraph selector parsing failed');
    expect(() => normalizeParagraphSelectors('p{}', 'bad alias')).toThrow('invalid paragraph alias');
  });

  it('derives separate external import chains for normalized and native documents', () => {
    const store = new ResourceStore();
    const sheet = '@import "nested.css";p{color:red}';
    for (const [name, css] of [['shared.css', sheet], ['nested.css', 'p:defined{margin:3px}']]) {
      store.record({ url: `https://fixture.test/${name}`, status: 200, contentType: 'text/css', body: Buffer.from(css), via: 'network' });
    }
    const $ = cheerio.load('<html data-dl-paragraph-alias="dl-static-p"><head><link rel="stylesheet" href="/shared.css"></head><body><dl-static-p data-dl-original-tag="p">outer</dl-static-p><iframe></iframe></body></html>');
    $('iframe').attr('srcdoc', '<html><head><link rel="stylesheet" href="/shared.css"></head><body><p>inner</p></body></html>');
    const result = localizeDocument($.html(), 'https://fixture.test/', store);
    const aliased = result.assets.filter((asset) => asset.assetPath.includes('__p-dl-static-p'));
    const native = result.assets.filter((asset) => !asset.assetPath.includes('__p-'));
    expect(aliased).toHaveLength(2);
    expect(native).toHaveLength(2);
    expect(aliased.every((asset) => asset.body.toString().includes('dl-static-p'))).toBe(true);
    expect(native.every((asset) => !asset.body.toString().includes('dl-static-p'))).toBe(true);
    expect(store.get('https://fixture.test/shared.css')?.body.toString()).toBe(sheet);
  });

  it('keeps an unsupported sheet available while reporting that selector preservation is unverified', () => {
    const store = new ResourceStore();
    store.record({ url: 'https://fixture.test/style.css', status: 200, contentType: 'text/css',
      body: Buffer.from('p{color:blue}p[=broken]{color:red}p:defined{padding:2px}'), via: 'network' });
    const result = localizeDocument('<html data-dl-paragraph-alias="dl-static-p"><head><link rel="stylesheet" href="/style.css"></head><body></body></html>', 'https://fixture.test/', store);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].body.toString()).toContain('p[=broken]{color:red}');
    expect(result.assets[0].body.toString()).toContain(':is(p,*|dl-static-p){color:blue}');
    expect(result.assets[0].body.toString()).toContain(':is(p,*|dl-static-p):is(:defined,:where(*|dl-static-p)){padding:2px}');
    expect(result.warnings.join(' ')).toContain('paragraph selector parsing failed');
  });
});
