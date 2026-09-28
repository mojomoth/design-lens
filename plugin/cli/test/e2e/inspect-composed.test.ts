import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DetailedInspectDocument } from '../../src/commands/inspect.js';
import type { ComprehensiveDetails } from '../../src/analyze/inspect-observations.js';
import { hashTree } from '../../src/capture/evidence.js';

const exec = promisify(execFile);
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));

// why: role-only inspection formerly stopped at shadow hosts and could not inspect composed pages.
describe('inspection across generated responsive shadow boundaries', () => {
  let root: string;
  function variant(capture: string, base: number): string {
    return `<dl-view data-dl-generated="host" data-dl-id="dl-${base}" data-dl-source-capture="${capture}">
      <template shadowrootmode="open"><style>
      dl-root,dl-body{display:block}dl-body{font-family:Arial;background:white}
      header{display:flex;align-items:center;gap:20px;height:60px}img{width:50px;height:20px}
      h1{font-size:38px}dl-static-p{display:block}section{height:240px}
      </style><dl-root data-dl-generated="root" data-dl-original-tag="html" data-dl-id="dl-${base + 1}">
      <dl-body data-dl-generated="body" data-dl-original-tag="body" data-dl-id="dl-${base + 2}">
      <header data-dl-id="dl-${base + 3}" data-dl-source-id="dl-1" data-dl-source-capture="${capture}">
      <img data-dl-id="dl-${base + 4}" data-dl-source-id="dl-2" data-dl-source-capture="${capture}" src="assets/logo.svg" alt="Mark">
      <nav data-dl-id="dl-${base + 5}" data-dl-source-id="dl-3" data-dl-source-capture="${capture}"><a data-dl-id="dl-${base + 6}" data-dl-source-id="dl-4" data-dl-source-capture="${capture}" href="#more">${capture} navigation</a></nav></header>
      <h1 data-dl-id="dl-${base + 7}" data-dl-source-id="dl-5" data-dl-source-capture="${capture}">${capture} heading</h1>
      <dl-static-p data-dl-original-tag="p" data-dl-id="dl-${base + 8}" data-dl-source-id="dl-6" data-dl-source-capture="${capture}" role="paragraph">Preserved paragraph</dl-static-p>
      <section data-dl-id="dl-${base + 9}" data-dl-source-id="dl-7" data-dl-source-capture="${capture}">Content</section>
      </dl-body></dl-root><link rel="stylesheet" href="assets/dl-overrides.css"></template></dl-view>`;
  }
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-inspect-composed-'));
    await fs.mkdir(path.join(root, 'clone/assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'clone/assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><path fill="red" d="M0 0h50v20H0z"/></svg>');
    await fs.writeFile(path.join(root, 'clone/assets/dl-overrides.css'), '');
    await fs.writeFile(path.join(root, 'clone/index.html'), `<!doctype html><html><head><style>
      body{margin:0}dl-view{display:contents}@media(width<600px){[data-dl-generated=host][data-dl-source-capture=desktop]{display:none}}
      @media(width>=600px){[data-dl-generated=host][data-dl-source-capture=mobile]{display:none}}
      </style></head><body>${variant('desktop', 10)}${variant('mobile', 30)}</body></html>`);
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
  async function inspect(...args: string[]): Promise<DetailedInspectDocument> {
    return JSON.parse((await exec(process.execPath, [BUNDLE, 'inspect', root, ...args])).stdout) as DetailedInspectDocument;
  }

  // why: hidden captured alternatives must not displace the active page's logo, navigation or heading.
  it('classifies the active shadow content with ordinary inspect and kind selection', async () => {
    const before = await hashTree(root);
    const desktop = await inspect();
    expect(desktop.elements.find((element) => element.role === 'logo')?.dlId).toBe('dl-14');
    expect(desktop.elements.find((element) => element.role === 'hero-heading')?.text).toBe('desktop heading');
    const mobile = await inspect('--viewport', '390x844', '--kind', 'nav-link', '--details');
    expect(mobile.elements.map((element) => element.dlId)).toEqual(['dl-36']);
    expect(mobile.page.activeCaptureId).toBe('mobile');
    expect((mobile.page.body.details as ComprehensiveDetails).semantic).toBe('body');
    expect(mobile.page.complete).toBe(true);
    expect(await hashTree(root)).toEqual(before);
  });

  // why: source provenance and real shadow addresses are both needed to inspect and edit the right copy.
  it('retains hidden inventory, logical paragraph tags and shared override edits', async () => {
    const all = await inspect('--all', '--details', '--viewport', '390x844');
    const desktop = all.elements.find((element) => element.dlId === 'dl-17')!;
    expect(desktop.details.visible).toBe(false);
    const paragraph = all.elements.find((element) => element.dlId === 'dl-38')!;
    expect(paragraph.tag).toBe('p');
    expect((paragraph.details as ComprehensiveDetails).source).toEqual({ captureId: 'mobile', dlId: 'dl-6' });
    expect((paragraph.details as ComprehensiveDetails).rootPath).toEqual(['dl-30']);
    await fs.writeFile(path.join(root, 'clone/assets/dl-overrides.css'), '[data-dl-id="dl-37"]{font-size:44px}');
    const edited = await inspect('--id', 'dl-37', '--viewport', '390x844');
    expect(edited.elements[0].styles.fontSize).toBe('44px');
  });
});
