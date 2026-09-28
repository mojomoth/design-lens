/// <reference lib="dom" />
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

import { serializeDom } from '../../src/capture/serialize.js';
import { stampDom } from '../../src/capture/stamp.js';
import { sanitizeHtml } from '../../src/localize/html-rewrite.js';
import { localizeDocument } from '../../src/localize/localize.js';
import { ResourceStore } from '../../src/localize/resource-store.js';
import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

const SHEET = `@layer author{p{margin:3px;color:rgb(8,40,90)}p:nth-of-type(2){padding:7px}p:only-of-type{border:2px solid black}}
  body{margin:0;font:16px/24px Arial;background:white}main{padding:12px}p:defined{font-weight:700}main :not(:defined){visibility:hidden}
  main>p:is(.lead):has(>.line)::before{content:'Label';color:rgb(150,0,0)}
  p>.line{display:block}p>.line>.word{display:inline-block}@media(max-width:500px){p{font-size:14px}}`;
const HTML = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main>
  <p class="lead" id="split">Text</p><div>Between</div><p id="normal">Ordinary paragraph</p></main><div id="shadow"></div>
  <script>
    const line=document.createElement('div');line.className='line';
    for(const text of ['Stable ', 'editable ', 'words']){const word=document.createElement('span');word.className='word';word.textContent=text;line.append(word)}
    document.querySelector('#split').replaceChildren(line);
    const root=document.querySelector('#shadow').attachShadow({mode:'open'});
    root.innerHTML='<style>@layer author{p{margin:5px;color:rgb(20,90,30)}}:not(:defined){display:none}</style>';
    const paragraph=document.createElement('p');paragraph.id='nested';const block=document.createElement('div');block.textContent='Shadow paragraph';paragraph.append(block);root.append(paragraph);
    const adopted=new CSSStyleSheet();adopted.replaceSync('p::before{content:"Shadow label"}');root.adoptedStyleSheets=[adopted];
  </script></body></html>`;

describe('script-created paragraph structure survives inert HTML replay', () => {
  let directory: string; let server: StaticServer; let browser: Browser;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-paragraphs-'));
    await fs.writeFile(path.join(directory, 'index.html'), HTML);
    await fs.writeFile(path.join(directory, 'style.css'), SHEET);
    server = await startStaticServer(directory);
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => { await browser.close(); await server.close(); await fs.rm(directory, { recursive: true, force: true }); });

  for (const width of [800, 390]) {
    it(`preserves hierarchy, cascade, pseudo styles and source pixels at ${width}px`, async () => {
      const source = await browser.newPage({ viewport: { width, height: 600 } });
      const clone = await browser.newPage({ viewport: { width, height: 600 } });
      try {
        await source.goto(server.url('/index.html'));
        await stampDom(source, []);
        const before = await source.screenshot();
        const sourceTree = await source.evaluate(() => document.querySelector('#split')!.outerHTML);
        const result = await serializeDom(source);
        expect(result.serializer, result.warnings.join('; ')).toBe('percy');
        expect(result.warnings).toEqual([]);
        expect(await source.evaluate(() => document.querySelector('#split')!.outerHTML)).toBe(sourceTree);
        expect(await source.screenshot()).toEqual(before);
        expect(result.html).toContain('data-dl-paragraph-alias="dl-static-p"');
        const store = new ResourceStore();
        store.record({ url: server.url('/style.css'), status: 200, contentType: 'text/css', body: Buffer.from(SHEET), via: 'network' });
        const localized = localizeDocument(sanitizeHtml(result.html), server.url('/index.html'), store);
        const cloneDir = path.join(directory, `clone-${width}`);
        await fs.mkdir(cloneDir, { recursive: true });
        await fs.writeFile(path.join(cloneDir, 'index.html'), localized.html);
        for (const asset of localized.assets) {
          await fs.mkdir(path.dirname(path.join(cloneDir, asset.assetPath)), { recursive: true });
          await fs.writeFile(path.join(cloneDir, asset.assetPath), asset.body);
        }
        await fs.mkdir(path.join(cloneDir, 'assets'), { recursive: true });
        await fs.writeFile(path.join(cloneDir, 'assets/dl-overrides.css'), '');
        await clone.goto(server.url(`/clone-${width}/index.html`));
        expect(await clone.screenshot()).toEqual(before);
        expect(await clone.evaluate(() => ({
          count: document.querySelectorAll('p').length,
          child: document.querySelector('#split > .line')?.parentElement?.id,
          role: document.querySelector('#split')?.getAttribute('role'),
          original: document.querySelector('#split')?.getAttribute('data-dl-original-tag'),
          nested: document.querySelector('#shadow')?.shadowRoot?.querySelector('#nested > div')?.textContent,
        }))).toEqual({ count: 0, child: 'split', role: 'paragraph', original: 'p', nested: 'Shadow paragraph' });
        // Negative control: plain outerHTML is demonstrably insufficient for this fixture.
        await clone.setContent(sanitizeHtml(await source.content()));
        expect(await clone.locator('#split > .line').count()).toBe(0);
      } finally { await source.close(); await clone.close(); }
    });
  }

  it('does not retag valid documents and avoids custom-element name collisions', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url('/index.html'));
      await page.evaluate(() => customElements.define('dl-static-p', class extends HTMLElement {}));
      const result = await serializeDom(page);
      expect(result.html).toContain('data-dl-paragraph-alias="dl-static-p-2"');
      await page.setContent('<html><body><p>Plain paragraph</p></body></html>');
      expect((await serializeDom(page)).html).not.toContain('data-dl-paragraph-alias');
    } finally { await page.close(); }
  });

  it('reports native-UA reversion instead of silently claiming a faithful normalization', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url('/index.html'));
      await page.addStyleTag({ content: 'p { all: revert }' });
      expect((await serializeDom(page)).warnings.join(' ')).toContain('native UA reversion');
    } finally { await page.close(); }
  });
});
