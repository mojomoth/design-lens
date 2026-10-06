/**
 * WHY this suite exists: `inspect --lite` replaces `--all --details` (≈57 MB per viewport on a real
 * composed clone) as the reverse-design inventory. Only the BUILT bundle proves that the in-page
 * lite probe survives minification, that selectors reach content inside generated responsive
 * shadow roots (active variant first), that ids absent at a viewport degrade to `v: 0` or a
 * warning, and that one invocation measures several viewports without writing into the project.
 * The fixture is a temporary two-variant composed clone served on loopback; no live web.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashTree } from '../../src/capture/evidence.js';
import type { LiteElement, LiteInspectDocument, LiteViewportsInspectDocument } from '../../src/analyze/inspect-lite.js';
import type { DetailedInspectDocument } from '../../src/commands/inspect.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const CHIPS = 25;

/** One generated responsive variant; ids are capture-local, as in composed clones. */
function variant(capture: 'desktop' | 'mobile', base: number): string {
  const chips = Array.from({ length: CHIPS }, (_, index) => `<li class="chip" data-dl-id="dl-${base + 11 + index}">Chip ${index}</li>`).join('');
  return `<dl-view data-dl-generated="host" data-dl-id="dl-${base}" data-dl-source-capture="${capture}">
    <template shadowrootmode="open"><style>
    dl-root,dl-body{display:block}dl-body{font-family:Arial;background:white}
    header{display:flex;align-items:center;justify-content:space-between;gap:20px;height:60px;padding:0 24px}
    img{width:50px;height:20px}
    h1{font-size:${capture === 'desktop' ? 48 : 32}px;line-height:1.25;letter-spacing:.02em;text-transform:uppercase;margin:0}
    .cta{display:inline-block;padding:12px 24px;background:rgb(255, 102, 0);color:white;clip-path:polygon(0 0,100% 0,100% 70%,85% 100%,0 100%)}
    .cta::after{content:url(assets/logo.svg)}
    .frame{position:relative;height:40px;border:1px solid rgb(0, 0, 0);border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,.2);background-image:url(assets/logo.svg)}
    .frame::before{content:'';position:absolute;top:-4px;left:-4px;width:8px;height:8px;background:rgb(255, 102, 0)}
    .grid{display:grid;grid-template-columns:100px 100px;gap:8px 16px}
    .chip{opacity:.5}
    </style><dl-root data-dl-generated="root" data-dl-original-tag="html" data-dl-id="dl-${base + 1}">
    <dl-body data-dl-generated="body" data-dl-original-tag="body" data-dl-id="dl-${base + 2}">
    <header data-dl-id="dl-${base + 3}"><img data-dl-id="dl-${base + 4}" src="assets/logo.svg" alt="Mark">
    <nav data-dl-id="dl-${base + 5}"><a data-dl-id="dl-${base + 6}" href="#more">${capture} navigation</a></nav></header>
    <h1 data-dl-id="dl-${base + 7}" data-dl-source-capture="${capture}" data-dl-source-id="dl-7">${capture} heading</h1>
    <a class="cta" data-dl-id="dl-${base + 8}" href="#go">Start</a>
    <div class="frame" data-dl-id="dl-${base + 9}"><span class="note">Unstamped note</span></div>
    <ul class="grid" data-dl-id="dl-${base + 10}">${chips}</ul>
    <div style="display:none" data-dl-id="dl-${base + 40}">Hidden alternative</div>
    </dl-body></dl-root></template></dl-view>`;
}

const DESKTOP = 10;
const MOBILE = 100;

describe('inspect --lite on a composed responsive clone', () => {
  let root: string;
  let before: Awaited<ReturnType<typeof hashTree>>;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-inspect-lite-'));
    await fs.mkdir(path.join(root, 'clone/assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'clone/assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><path fill="red" d="M0 0h50v20H0z"/></svg>');
    await fs.writeFile(path.join(root, 'clone/index.html'), `<!doctype html><html><head><style>
      body{margin:0}dl-view{display:contents}
      @media(width<600px){[data-dl-generated=host][data-dl-source-capture=desktop]{display:none}}
      @media(width>=600px){[data-dl-generated=host][data-dl-source-capture=mobile]{display:none}}
      </style></head><body>${variant('desktop', DESKTOP)}${variant('mobile', MOBILE)}</body></html>`);
    before = await hashTree(root);
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function lite<T>(...args: string[]): Promise<{ document: T; stderr: string }> {
    const result = await runCli(['inspect', root, '--lite', ...args], root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    return { document: JSON.parse(result.stdout) as T, stderr: result.stderr };
  }
  function byId(elements: LiteElement[], id: string): LiteElement {
    const found = elements.find((element) => element.id === id);
    expect(found, `missing ${id}`).toBeDefined();
    return found!;
  }

  // why: the reverse-design inventory runs once for three viewports; each viewport must measure its
  // own active variant (media queries applied) from one server, and the project must stay untouched.
  it('reports the role inventory of each active variant from one served session', async () => {
    const { document, stderr } = await lite<LiteViewportsInspectDocument>('--viewports', '1440x900,390x844');
    expect(Object.keys(document)).toEqual(['colors', 'viewports']);
    expect(document.viewports.map((entry) => entry.viewport)).toEqual([{ width: 1440, height: 900 }, { width: 390, height: 844 }]);
    expect(stderr.match(/design-lens: serving /g)).toHaveLength(1);
    const [desktop, mobile] = document.viewports;
    expect(desktop.page.activeCaptureId).toBe('desktop');
    expect(mobile.page.activeCaptureId).toBe('mobile');
    expect(desktop.page.complete).toBe(true);
    expect(Object.keys(desktop.page.timings)).toEqual(expect.arrayContaining(['navigate', 'fonts', 'roles', 'probe', 'total']));
    const heading = desktop.elements.find((element) => element.role === 'hero-heading')!;
    expect(heading).toMatchObject({ id: `dl-${DESKTOP + 7}`, tag: 'h1', text: 'DESKTOP HEADING', v: 1, font: 'Arial|48px/60px|700|0.96px|uppercase' });
    expect(heading.r).toHaveLength(4);
    expect(mobile.elements.find((element) => element.role === 'hero-heading')).toMatchObject({ id: `dl-${MOBILE + 7}`, font: 'Arial|32px/40px|700|0.64px|uppercase' });
    expect(desktop.elements.find((element) => element.role === 'logo')?.id).toBe(`dl-${DESKTOP + 4}`);
    expect(await hashTree(root)).toEqual(before);
  });

  // why: DESIGN.md cites the capture's own ids (data-dl-source-capture/-id), not the clone's renumbered ones;
  // without src every lite-targeted signature element needed a separate HTML grep before it could be cited.
  it('reports the citable source address of composed elements as src', async () => {
    const { document } = await lite<LiteViewportsInspectDocument>('--selector', 'h1', '--viewports', '1440x900,390x844');
    const [desktop, mobile] = document.viewports;
    expect(desktop.elements.map((element) => [element.id, element.v, element.src])).toEqual([[`dl-${DESKTOP + 7}`, 1, 'desktop/dl-7'], [`dl-${MOBILE + 7}`, 0, 'mobile/dl-7']]);
    expect(mobile.elements[0]).toMatchObject({ id: `dl-${MOBILE + 7}`, v: 1, src: 'mobile/dl-7' });
    expect(byId(desktop.elements, `dl-${DESKTOP + 7}`)).not.toHaveProperty('path');
  });

  // why: --kind narrows the lite role inventory exactly as it narrows the legacy inventory; a lite
  // run that ignored it would hand an agent unrelated elements under the requested role.
  it('restricts the lite role inventory with --kind', async () => {
    const { document } = await lite<LiteInspectDocument>('--kind', 'nav-link', '--viewport', '390x844');
    expect(document.elements.map((element) => [element.id, element.role, element.text])).toEqual([[`dl-${MOBILE + 6}`, 'nav-link', 'mobile navigation']]);
  });

  // why: composed clones keep all content in shadow roots, so a document-only querySelectorAll
  // matches nothing; matches must come from every tree, active variant first, inactive as v: 0,
  // and an unstamped match must stay addressable by path.
  it('evaluates selectors across shadow roots with active matches first and paths for unstamped nodes', async () => {
    const { document } = await lite<LiteViewportsInspectDocument>('--selector', 'h1', '--selector', '.frame span', '--viewports', '1440x900,390x844');
    const [desktop, mobile] = document.viewports;
    expect(desktop.elements.map((element) => [element.id, element.v, element.matched])).toEqual([
      [`dl-${DESKTOP + 7}`, 1, ['h1']], [`dl-${MOBILE + 7}`, 0, ['h1']], [null, 1, ['.frame span']], [null, 0, ['.frame span']],
    ]);
    expect(desktop.elements[2]).toMatchObject({ tag: 'span', text: 'Unstamped note', parent: `dl-${DESKTOP + 9}`, path: `[data-dl-id="dl-${DESKTOP + 9}"] > span:nth-of-type(1)` });
    expect(mobile.elements.map((element) => [element.id, element.v])).toEqual([
      [`dl-${MOBILE + 7}`, 1], [`dl-${DESKTOP + 7}`, 0], [null, 1], [null, 0],
    ]);
    expect(mobile.elements[2].path).toBe(`[data-dl-id="dl-${MOBILE + 9}"] > span:nth-of-type(1)`);
  });

  // why: the lite projection is only worth using if it keeps the values that carry signature
  // devices (fills, chamfer clip-paths, frames, corner pseudo-elements, grid tracks, opacity).
  it('projects box, layout, effects and pseudo-elements of addressed elements', async () => {
    const ids = [8, 9, 10, 11].map((offset) => `dl-${DESKTOP + offset}`);
    const { document } = await lite<LiteInspectDocument>(...ids.flatMap((id) => ['--id', id]), '--viewport', '1440x900');
    expect(Object.keys(document)).toEqual(['colors', 'page', 'elements']);
    expect(document.page.viewport).toEqual({ width: 1440, height: 900 });
    expect(document.elements.map((element) => element.id)).toEqual(ids);
    const [cta, frame, grid, chip] = document.elements;
    expect(cta).toMatchObject({ tag: 'a', text: 'Start', bg: 'rgb(255, 102, 0)', color: 'rgb(255, 255, 255)', box: { pad: '12px 24px' }, layout: { display: 'inline-block' } });
    expect(cta.fx?.clipPath).toMatch(/^polygon\(/);
    expect(cta.after?.content).toBe('url("/assets/logo.svg")');
    expect(frame.box).toMatchObject({ radius: '4px', border: '1px solid rgb(0, 0, 0)' });
    expect(frame.box?.shadow).toContain('2px 4px');
    expect(frame.layout).toEqual({ display: 'block', position: 'relative' });
    expect(frame.before).toEqual({ content: '""', bg: 'rgb(255, 102, 0)', size: '8px 8px' });
    expect(frame.after).toBeUndefined();
    expect(frame.fx?.bgImage).toContain('/assets/logo.svg');
    expect(grid.layout).toMatchObject({ display: 'grid', cols: '100px 100px', gap: '8px 16px' });
    expect(chip.fx).toEqual({ opacity: '0.5' });
    expect(chip.parent).toBe(`dl-${DESKTOP + 10}`);
    expect(JSON.stringify(document)).not.toContain('127.0.0.1');
  });

  // why: data-dl-ids are variant-specific; a signature id taken from the desktop capture must not
  // abort the mobile measurement, and an id that no longer exists must not fail the whole run.
  it('reports ids absent from the active variant as v: 0 and unknown ids as warnings', async () => {
    const { document } = await lite<LiteViewportsInspectDocument>('--id', `dl-${DESKTOP + 7}`, '--id', 'dl-999', '--viewports', '1440x900,390x844');
    const [desktop, mobile] = document.viewports;
    expect(desktop.elements.map((element) => [element.id, element.v])).toEqual([[`dl-${DESKTOP + 7}`, 1]]);
    expect(mobile.elements.map((element) => [element.id, element.v])).toEqual([[`dl-${DESKTOP + 7}`, 0]]);
    for (const entry of document.viewports) {
      expect(entry.page.warnings.some((warning) => warning.includes('dl-999'))).toBe(true);
      expect(entry.page.complete).toBe(true);
    }
  });

  // why: --id and --selector combine with ids first, and an element reached both ways is reported
  // once with its selector in `matched`; the in-page probe decides this order, so only the bundle
  // can prove it (a selector-first or duplicated list would misalign an agent's id-keyed notes).
  it('combines ids and selectors with ids first and one entry per element', async () => {
    const { document } = await lite<LiteInspectDocument>('--selector', 'h1', '--id', `dl-${DESKTOP + 8}`, '--id', `dl-${DESKTOP + 7}`, '--viewport', '1440x900');
    expect(document.elements.map((element) => [element.id, element.v, element.matched ?? null])).toEqual([
      [`dl-${DESKTOP + 8}`, 1, null], [`dl-${DESKTOP + 7}`, 1, ['h1']], [`dl-${MOBILE + 7}`, 0, ['h1']],
    ]);
  });

  // why: lite --all must describe the painted page only; hidden alternatives and the inactive
  // variant are what made the full dump 4x larger than the visible page.
  it('limits --all to visible stamped elements of the active variant', async () => {
    const { document } = await lite<LiteInspectDocument>('--all', '--viewport', '390x844');
    const ids = document.elements.map((element) => Number(element.id?.slice(3)));
    const expected = Array.from({ length: 10 + CHIPS }, (_, index) => MOBILE + 1 + index);
    expect([...ids].sort((left, right) => left - right)).toEqual(expected);
    expect(document.elements.every((element) => element.v === 1)).toBe(true);
    expect(byId(document.elements, `dl-${MOBILE + 2}`).tag).toBe('body');
  });

  // why: an unbounded selector on a composed clone would rebuild the multi-megabyte dump; the cap
  // must be visible to the agent rather than silently dropping matches.
  it('caps matches per selector and says so in page.warnings', async () => {
    const { document } = await lite<LiteInspectDocument>('--selector', 'li');
    expect(document.elements).toHaveLength(20);
    expect(document.elements[0].id).toBe(`dl-${DESKTOP + 11}`);
    expect(document.elements.every((element) => element.v === 1 && element.matched?.[0] === 'li')).toBe(true);
    expect(document.page.warnings.join('\n')).toContain(`matched ${CHIPS * 2} elements; reported the first 20`);
  });

  // why: without --lite a selector is an address for the full detailed projection, resolved
  // through the same deep lookup as --id, so both spellings must return identical elements.
  it('returns the detailed --id shape for --selector without --lite', async () => {
    const run = async (...args: string[]): Promise<DetailedInspectDocument> => {
      const result = await runCli(['inspect', root, '--viewport', '390x844', ...args], root);
      expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as DetailedInspectDocument;
    };
    const selected = await run('--selector', 'h1');
    expect(selected.page.source).toBe('clone');
    expect(selected.elements.map((element) => element.dlId)).toEqual([`dl-${MOBILE + 7}`, `dl-${DESKTOP + 7}`]);
    const addressed = await run('--id', `dl-${MOBILE + 7}`, '--id', `dl-${DESKTOP + 7}`);
    expect(selected.elements).toEqual(addressed.elements);
    const unstamped = await run('--selector', '.frame span');
    expect(unstamped.elements).toEqual([]);
    expect(unstamped.page.warnings.join('\n')).toMatch(/without data-dl-id/);
  });

  // why: invalid combinations and malformed selectors must cost nothing (no server, no browser)
  // and must never print partial JSON that an agent could mistake for an answer.
  it.each([
    ['--all', '--selector', 'h1'],
    ['--kind', 'cta', '--selector', 'h1'],
    ['--lite', '--viewport', '1440x900', '--viewports', '390x844'],
    ['--viewports', '390x844'],
    ['--lite', '--details'],
    ['--lite', '--selector', 'h1['],
    ['--lite', '--selector', 'h1 >'],
  ])('rejects %s before serving anything', async (...args) => {
    const result = await runCli(['inspect', root, ...args], root);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^error: /m);
    expect(result.stderr).not.toContain('serving');
  });

  // why: css-tree accepts some selectors the engine rejects (unknown pseudo-classes); the browser
  // verdict must still end the run with exit 1 and an empty stdout.
  it('fails with empty stdout when the browser rejects a selector', async () => {
    const result = await runCli(['inspect', root, '--lite', '--selector', 'h1:frobnicate', '--viewports', '1440x900,390x844'], root);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/invalid --selector "h1:frobnicate"/);
    expect(await hashTree(root)).toEqual(before);
  });
});
