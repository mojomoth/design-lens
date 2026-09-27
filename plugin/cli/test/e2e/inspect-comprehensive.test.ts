import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashTree } from '../../src/capture/evidence.js';
import type { DetailedInspectDocument } from '../../src/commands/inspect.js';
import type { ComprehensiveDetails } from '../../src/analyze/inspect-observations.js';

const exec = promisify(execFile);
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));

// Full-page reconstruction requires nodes that the seven-role inventory deliberately omits.
describe('complete and batched clone inspection', () => {
  let directory: string;
  const markup = `<!doctype html><html><head><style>
    body{margin:0;font-family:sans-serif}.grid{display:grid;grid-template-columns:1fr 2fr;gap:12px;padding:12.5px}
    .grid::before{content:'Measured';background:linear-gradient(red,blue)}
    img{width:40px;height:30px;object-fit:cover;object-position:40% 50%}.hidden{display:none}
    @media(max-width:600px){.grid{grid-template-columns:1fr;gap:6px}}
  </style></head><body><main data-dl-id="dl-1"><div class="grid" data-dl-id="dl-2">
    <p data-dl-id="dl-3">Body copy</p><img data-dl-id="dl-4" src="assets/picture.svg">
    <form data-dl-id="dl-5"><label data-dl-id="dl-6">Name<input data-dl-id="dl-7"></label></form>
    <table data-dl-id="dl-8"><tbody data-dl-id="dl-9"><tr data-dl-id="dl-10"><td data-dl-id="dl-11">Pro</td></tr></tbody></table>
    <x-card data-dl-id="dl-12"><template shadowrootmode="open"><style>section{padding:7px;background:rgb(1,2,3)}p::after{content:'shadow'}</style>
      <section data-dl-id="dl-13"><p data-dl-id="dl-14">Shadow body</p></section></template></x-card>
    <div class="hidden" data-dl-id="dl-15">Hidden mobile alternative</div>
  </div></main></body></html>`;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-inspect-all-'));
    await fs.mkdir(path.join(directory, 'clone/assets'), { recursive: true });
    await fs.writeFile(path.join(directory, 'clone/index.html'), markup);
    await fs.writeFile(path.join(directory, 'clone/assets/picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
  });
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  async function inspect(...args: string[]): Promise<DetailedInspectDocument> {
    const result = await exec(process.execPath, [BUNDLE, 'inspect', directory, ...args]);
    return JSON.parse(result.stdout) as DetailedInspectDocument;
  }
  function details(document: DetailedInspectDocument, id: string): ComprehensiveDetails {
    return document.elements.find((element) => element.dlId === id)!.details as ComprehensiveDetails;
  }

  it('returns all stamped light and open shadow elements without changing files', async () => {
    const before = await hashTree(directory);
    const document = await inspect('--all', '--details');
    expect(document.elements).toHaveLength(15);
    expect(document.page.source).toBe('clone');
    expect(document.page.complete).toBe(true);
    expect(document.page.body.rect.width).toBe(1440);
    expect(document.page.body.styles.fontFamily).toBe('sans-serif');
    expect((document.page.body.details as ComprehensiveDetails).semantic).toBe('body');
    expect(details(document, 'dl-3').semantic).toBe('paragraph');
    expect(details(document, 'dl-5').semantic).toBe('form');
    expect(details(document, 'dl-8').semantic).toBe('table');
    expect(details(document, 'dl-15').visible).toBe(false);
    expect(details(document, 'dl-12').childDlIds).toContain('dl-13');
    expect(details(document, 'dl-13').parentDlId).toBe('dl-12');
    expect(details(document, 'dl-14').rootPath).toEqual(['dl-12']);
    expect(details(document, 'dl-14').pseudo.after.content).toBe('"shadow"');
    expect(await hashTree(directory)).toEqual(before);
  });

  it('measures pseudo graphics, image crop and fractional geometry', async () => {
    const document = await inspect('--all', '--details');
    expect(details(document, 'dl-2').pseudo.before.styles.backgroundImage).toContain('linear-gradient');
    expect(details(document, 'dl-4').visual).toMatchObject({ objectFit: 'cover', objectPosition: '40% 50%' });
    expect(details(document, 'dl-4').image).toEqual({ complete: true, naturalWidth: 80, naturalHeight: 40 });
    expect(document.elements.find((element) => element.dlId === 'dl-4')!.rect.x).toBe(12.5);
    expect(JSON.stringify(document)).not.toContain('127.0.0.1');
  });

  it('retains requested order, deduplicates repeated IDs and directly addresses shadow nodes', async () => {
    const document = await inspect('--id', 'dl-14', '--id', 'dl-3', '--id', 'dl-14');
    expect(document.elements.map((element) => element.dlId)).toEqual(['dl-14', 'dl-3']);
    expect(details(document, 'dl-14').parentDlId).toBe('dl-13');
    expect(document.elements[0].role).toBeNull();
    expect((await inspect('--id', 'dl-14')).elements.map((element) => element.dlId)).toEqual(['dl-14']);
  });

  it('keeps responsive layouts current and leaves all-without-details compact', async () => {
    const mobile = await inspect('--all', '--details', '--viewport', '390x844');
    expect(details(mobile, 'dl-2').layout.columnGap).toBe('6px');
    const compact = await inspect('--all');
    expect(compact.elements).toHaveLength(15);
    expect(Object.keys(compact).sort()).toEqual(['colors', 'elements']);
    expect(compact.elements.every((element) => !('details' in element))).toBe(true);
  });

  it.each([
    ['--all', '--id', 'dl-3'], ['--all', '--kind', 'cta'],
    ['--id', 'dl-3', '--id', 'invalid'], ['--id', 'dl-3', '--id', 'dl-999'],
  ])('fails an invalid batch or incompatible selector without partial JSON: %s', async (...args) => {
    await expect(exec(process.execPath, [BUNDLE, 'inspect', directory, ...args])).rejects.toMatchObject({ code: 1, stdout: '' });
  });

  it('rejects IDs duplicated across a shadow boundary rather than choosing a node', async () => {
    const index = path.join(directory, 'clone/index.html');
    await fs.writeFile(index, markup.replace('data-dl-id="dl-14"', 'data-dl-id="dl-3"'));
    try {
      await expect(exec(process.execPath, [BUNDLE, 'inspect', directory, '--id', 'dl-3'])).rejects.toMatchObject({ code: 1, stdout: '', stderr: expect.stringContaining('multiple') });
    } finally { await fs.writeFile(index, markup); }
  });

  it('directly addresses stamped body, head and nonvisual document elements in the shared probe', async () => {
    const index = path.join(directory, 'clone/index.html');
    await fs.writeFile(index, markup.replace('<html>', '<html data-dl-id="dl-20">')
      .replace('<head>', '<head data-dl-id="dl-21">').replace('<style>', '<style data-dl-id="dl-22">')
      .replace('<body>', '<body data-dl-id="dl-23">'));
    try {
      const document = await inspect('--id', 'dl-23', '--id', 'dl-21', '--id', 'dl-22', '--id', 'dl-20');
      expect(document.elements.map((element) => element.dlId)).toEqual(['dl-23', 'dl-21', 'dl-22', 'dl-20']);
      const body = document.elements[0];
      expect(body.rect).toEqual(document.page.body.rect);
      expect(body.styles).toEqual(document.page.body.styles);
      expect(details(document, 'dl-22').visible).toBe(false);
      expect(details(document, 'dl-23').childDlIds).toEqual(['dl-1']);
      expect(details(document, 'dl-23').parentDlId).toBe('dl-20');
      expect((await inspect('--all')).elements).toHaveLength(19);
    } finally { await fs.writeFile(index, markup); }
  });
});
