/// <reference lib="dom" />
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

import { serializeDom } from '../../src/capture/serialize.js';
import { stampDom } from '../../src/capture/stamp.js';
import { sanitizeHtml } from '../../src/localize/html-rewrite.js';
import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

const HTML = `<!doctype html><html><head><style>
  body{margin:0;font:16px/24px Arial;background:white}main{height:3500px}
  :root{--render:auto}footer{content-visibility:var(--render)!important;contain-intrinsic-size:auto none;box-sizing:border-box;padding:20px;border:4px solid #123456;transform:scale(.9);background:#ddeeff}
  footer .content{height:333px}#hidden{content-visibility:hidden!important;padding:8px}#hidden div{height:700px}
  #conditional{content-visibility:auto!important;contain-intrinsic-size:auto none}#conditional div{height:100px}
  @media(max-width:500px){footer .content{height:222px}#conditional{content-visibility:hidden!important}}
</style></head><body><main>Top viewport stays unchanged</main><div id="shadow"></div>
<footer id="lazy"><div class="content">Editable footer content</div></footer>
<section id="hidden"><div>Explicitly hidden content</div></section><section id="conditional"><div>Conditional content</div></section>
<script>const root=document.querySelector('#shadow').attachShadow({mode:'open'});root.innerHTML='<style>#inside{content-visibility:auto!important;contain-intrinsic-size:auto none}#inside div{height:120px}</style><section id="inside"><div>Shadow content</div></section>';</script>
</body></html>`;

describe('detached content visibility intrinsic size preservation', () => {
  let directory: string; let server: StaticServer; let browser: Browser;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-content-visibility-'));
    await fs.writeFile(path.join(directory, 'index.html'), HTML);
    server = await startStaticServer(directory);
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => { await browser.close(); await server.close(); await fs.rm(directory, { recursive: true, force: true }); });

  for (const width of [800, 390]) {
    // why: remembered offscreen sizes exist only in the source renderer; a fresh clone must lay out
    // its real editable contents without requiring a visitor to discover them by scrolling first.
    it(`preserves the visited source's full-page geometry at ${width}px without changing hidden content`, async () => {
      const source = await browser.newPage({ viewport: { width, height: 600 } });
      const clone = await browser.newPage({ viewport: { width, height: 600 } });
      try {
        await source.goto(server.url('/index.html'));
        await stampDom(source, []);
        const firstHeight = await source.evaluate(() => document.documentElement.scrollHeight);
        for (let step = 0; step < 3; step++) {
          await source.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await source.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        }
        await source.evaluate(() => window.scrollTo(0, 0));
        await source.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const expected = await source.evaluate(() => ({
          page: document.documentElement.scrollHeight,
          footer: document.querySelector('#lazy')!.getBoundingClientRect().toJSON(),
          shadow: document.querySelector('#shadow')!.getBoundingClientRect().toJSON(),
          hidden: document.querySelector('#hidden')!.getBoundingClientRect().toJSON(),
          conditional: document.querySelector('#conditional')!.getBoundingClientRect().toJSON(),
          markup: document.querySelector('#lazy')!.outerHTML,
          shadowMarkup: document.querySelector('#shadow')!.shadowRoot!.querySelector('#inside')!.outerHTML,
        }));
        expect(expected.page).toBeGreaterThan(firstHeight);
        const viewport = await source.screenshot();
        const serialized = await serializeDom(source);
        expect(serialized.serializer).toBe('percy');
        expect(serialized.warnings).toEqual([]);
        await fs.writeFile(path.join(directory, `clone-${width}.html`), sanitizeHtml(serialized.html));
        await clone.goto(server.url(`/clone-${width}.html`));
        expect(await clone.evaluate(() => ({
          page: document.documentElement.scrollHeight,
          footer: document.querySelector('#lazy')!.getBoundingClientRect().toJSON(),
          shadow: document.querySelector('#shadow')!.getBoundingClientRect().toJSON(),
          hidden: document.querySelector('#hidden')!.getBoundingClientRect().toJSON(),
          conditional: document.querySelector('#conditional')!.getBoundingClientRect().toJSON(),
        }))).toEqual({ page: expected.page, footer: expected.footer, shadow: expected.shadow, hidden: expected.hidden, conditional: expected.conditional });
        expect(await clone.screenshot()).toEqual(viewport);
        expect(await source.evaluate(() => ({
          markup: document.querySelector('#lazy')!.outerHTML,
          shadowMarkup: document.querySelector('#shadow')!.shadowRoot!.querySelector('#inside')!.outerHTML,
          visibility: getComputedStyle(document.querySelector('#lazy')!).contentVisibility,
        }))).toEqual({ markup: expected.markup, shadowMarkup: expected.shadowMarkup, visibility: 'auto' });
        expect(await clone.evaluate(() => ({
          footer: getComputedStyle(document.querySelector('#lazy')!).contentVisibility,
          hidden: getComputedStyle(document.querySelector('#hidden')!).contentVisibility,
          hiddenMarker: document.querySelector('#hidden')!.hasAttribute('data-dl-content-visibility'),
          conditional: getComputedStyle(document.querySelector('#conditional')!).contentVisibility,
          shadow: getComputedStyle(document.querySelector('#shadow')!.shadowRoot!.querySelector('#inside')!).contentVisibility,
        }))).toEqual({ footer: 'auto', hidden: 'hidden', hiddenMarker: false, conditional: width === 390 ? 'hidden' : 'auto', shadow: 'auto' });
        // The copied fallback does not constrain layout: scrolling to edited content must refresh
        // its natural height, and the browser must retain that new size when it becomes skipped.
        await clone.locator('#lazy .content').evaluate((element) => { (element as HTMLElement).style.height = '500px'; });
        await clone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await clone.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await clone.locator('#lazy').evaluate((element) => getComputedStyle(element).height)).toBe('548px');
        await clone.evaluate(() => window.scrollTo(0, 0));
        await clone.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await clone.locator('#lazy').evaluate((element) => getComputedStyle(element).height)).toBe('548px');
      } finally { await source.close(); await clone.close(); }
    });
  }

  // why: absence of an identity must be an explicit coverage gap, never a guess about another node.
  it('reports auto content without a stable capture ID instead of mutating the live source', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(server.url('/index.html'));
      const before = await page.locator('#lazy').evaluate((element) => element.outerHTML);
      expect((await serializeDom(page)).warnings.join(' ')).toContain('content-visibility:auto element has no stable capture ID');
      expect(await page.locator('#lazy').evaluate((element) => element.outerHTML)).toBe(before);
    } finally { await page.close(); }
  });
});
