import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { observePage } from '../../src/analyze/observations.js';
import { stampDom } from '../../src/capture/stamp.js';
import { stabilize } from '../../src/capture/stabilize.js';
import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

describe('rendered source observations and static animation replay', () => {
  let directory: string;
  let server: StaticServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-observations-'));
    const require = createRequire(import.meta.url);
    const fontDirectory = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/vite/recorder/assets');
    const fontName = (await fs.readdir(fontDirectory)).find((name) => /^codicon.*\.ttf$/.test(name));
    if (!fontName) throw new Error('pinned Playwright package has no font fixture');
    await fs.copyFile(path.join(fontDirectory, fontName), path.join(directory, 'measured.ttf'));
    await fs.writeFile(path.join(directory, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
    await fs.writeFile(path.join(directory, 'index.html'), `<!doctype html><html><head><style>
      @font-face { font-family: MeasuredFace; src: url('measured.ttf'); }
      body { margin: 0; font-family: MeasuredFace,sans-serif; } main { padding: 12.5px; }
      .card { display: grid; grid-template-columns: 1fr 2fr; gap: 13px; background: linear-gradient(red,blue); }
      .card::before { content: "Label"; color: rgb(10,20,30); } img { width:40px;height:40px;object-fit:cover; }
      .off { display:none; } footer { margin-top:1100px; }
      @media(max-width:600px){.card{grid-template-columns:1fr;gap:7px;}}
    </style></head><body><main><h1>Measured design</h1><article class="card"><p>Text block</p><img src="logo.svg"></article>
      <form><label>Name<input value="Ada"></label><button>Submit</button></form>
      <table><tbody><tr><th>Plan</th><td>Pro</td></tr></tbody></table>
      <x-card><template shadowrootmode="open"><style>p { margin:3px;color:rgb(4,5,6) }</style><section><p>Shadow content</p></section></template></x-card>
      <div class="off">Hidden</div><footer>End</footer></main></body></html>`);
    server = await startStaticServer(directory);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(server.url('/index.html'));
    await stabilize(page, Date.now() + 10_000);
    await stampDom(page, []);
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('measures body content, forms, tables, pseudo styles, image crop, and composed relationships', async () => {
    const observed = await observePage(page);
    expect(observed.complete).toBe(true);
    expect(observed.body).toMatchObject({ tag: 'body', semantic: 'body', domPath: 'body', parentDlId: null,
      rect: { x: 0, y: 0, width: 1440 }, styles: { marginTop: '0px', fontFamily: 'MeasuredFace, sans-serif' } });
    expect(observed.body).not.toHaveProperty('dlId');
    expect(observed.fontFaces).toContainEqual({ family: 'MeasuredFace', status: 'loaded', style: 'normal', weight: 'normal', stretch: 'normal' });
    expect(observed.elements.map((element) => element.semantic)).toEqual(expect.arrayContaining(['heading', 'paragraph', 'form', 'input', 'button', 'table', 'columnheader', 'cell']));
    const card = observed.elements.find((element) => element.tag === 'article')!;
    expect(card.rect.x).toBe(12.5);
    expect(card.styles.backgroundImage).toContain('linear-gradient');
    expect(card.styles.columnGap).toBe('13px');
    expect(card.pseudo.before.content).toBe('"Label"');
    expect(card.pseudo.before.styles.color).toBe('rgb(10, 20, 30)');
    const image = observed.elements.find((element) => element.tag === 'img')!;
    expect(image.image).toEqual({ complete: true, naturalWidth: 80, naturalHeight: 40 });
    expect(image.styles.objectFit).toBe('cover');
    expect(image.parentDlId).toBe(card.dlId);
    expect(card.childDlIds).toContain(image.dlId);
    expect(observed.elements.find((element) => element.text === 'Hidden')?.visible).toBe(false);
    const host = observed.elements.find((element) => element.tag === 'x-card')!;
    const shadow = observed.elements.find((element) => element.tag === 'p' && element.text === 'Shadow content')!;
    expect(shadow.rootPath).toEqual([host.dlId]);
    expect(shadow.domPath).toContain('::shadow>section:nth-of-type(1)>p:nth-of-type(1)');
    expect(shadow.styles.color).toBe('rgb(4, 5, 6)');
    expect(host.childDlIds).toContain(observed.elements.find((element) => element.tag === 'section')!.dlId);
  });

  it('keeps fractional document coordinates independent of scroll position', async () => {
    const before = await observePage(page);
    await page.evaluate(() => window.scrollTo(0, 400));
    const scrolled = await observePage(page);
    expect(scrolled.elements.find((element) => element.tag === 'footer')!.rect).toEqual(before.elements.find((element) => element.tag === 'footer')!.rect);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  it('records responsive layout as separate viewport observations', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await observePage(page);
    expect(mobile.viewport).toEqual({ width: 390, height: 844 });
    expect(mobile.elements.find((element) => element.tag === 'article')!.styles.columnGap).toBe('7px');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  it('explicitly marks element and pixel bounds as incomplete', async () => {
    const limited = await observePage(page, { maxElements: 3 });
    expect(limited.complete).toBe(false);
    expect(limited.warnings.join(' ')).toContain('element limit');
    const expired = await observePage(page, { deadline: Date.now() - 1 });
    expect(expired.complete).toBe(false);
    expect(expired.warnings).toContain('observation deadline reached');
    await page.evaluate(() => document.body.style.height = '50000px');
    expect((await observePage(page)).warnings.join(' ')).toContain('pixel limit');
    await page.evaluate(() => document.body.style.removeProperty('height'));
  });

  it('persists finite final and infinite initial animation values into inert HTML', async () => {
    const animated = await browser.newPage();
    try {
      await animated.setContent(`<style>
        @keyframes reveal { from { opacity:0;transform:translateX(0) } to { opacity:.8;transform:translateX(50px) } }
        @keyframes pulse { from { opacity:.2 } to { opacity:1 } }
        @keyframes label { from { color:red } to { color:blue } }
        .finite{animation:reveal 60s both}.infinite{animation:pulse 60s infinite}
        .finite::before{content:'badge';animation:label 60s both}
        .finite::after{content:'end';animation:label 60s both}
      </style><div class="finite">Finite</div><div class="infinite">Infinite</div>`);
      const result = await stabilize(animated, Date.now() + 10_000);
      expect(result.complete).toBe(true);
      expect(result.animations.frozen).toBe(4);
      const values = () => Array.from(document.querySelectorAll('div')).map((element) => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform, before: getComputedStyle(element, '::before').color, after: getComputedStyle(element, '::after').color }));
      const before = await animated.evaluate(values);
      expect(before[0].opacity).toBe('0.8');
      expect(before[0].transform).toBe('matrix(1, 0, 0, 1, 50, 0)');
      expect(before[0].before).toBe('rgb(0, 0, 255)');
      expect(before[0].after).toBe('rgb(0, 0, 255)');
      expect(before[1].opacity).toBe('0.2');
      await animated.setContent(await animated.content());
      expect(await animated.evaluate(values)).toEqual(before);
    } finally { await animated.close(); }
  });

  it('surfaces broken images and continuing script mutations', async () => {
    const unready = await browser.newPage();
    try {
      await unready.goto(server.url('/index.html'));
      await unready.evaluate(() => {
        const image = document.createElement('img'); image.src = '/missing.svg'; document.body.append(image);
        window.setInterval(() => { document.body.dataset.tick = String(Date.now()); }, 10);
      });
      const result = await stabilize(unready, Date.now() + 10_000);
      expect(result.complete).toBe(false);
      expect(result.images.failed).toBe(1);
      expect(result.warnings.join(' ')).toContain('still changed');
    } finally { await unready.close(); }
  });
});
