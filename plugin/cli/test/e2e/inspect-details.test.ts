/**
 * WHY this suite exists: design recipes need rendered CSS values, direct DOM relationships, and
 * honest font status rather than guesses from stylesheet declarations. These checks drive the
 * built bundle against temporary loopback clones, including responsive images and an intentionally
 * stalled font-readiness promise. No capture, installed runtime, or live-web resource is involved.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Styles {
  color: string;
  background: string;
  fontSize: string;
  fontFamily: string;
}

interface Details {
  visible: boolean;
  parentDlId: string | null;
  childDlIds: string[];
  currentSrc: string | null;
  typography: Record<string, string>;
  box: Record<string, string>;
  layout: Record<string, string>;
}

interface InspectElement {
  dlId: string;
  role: string | null;
  confidence: number | null;
  tag: string;
  selector: string;
  text: string | null;
  src: string | null;
  rect: Rect;
  styles: Styles;
  details: Details;
}

interface DetailedDocument {
  elements: InspectElement[];
  colors: string;
  page: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    rootFontSize: string;
    body: { rect: Rect; styles: Styles; details: Details };
    fonts: { status: 'ready' | 'timeout' | 'unavailable'; failedFamilies: string[] };
  };
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { font-size: 10px; --space: 2rem; --ink: #112233; }
  body { margin: 0; font: 1.6rem sans-serif; color: var(--ink); background: white; }
  header { padding: 10px 20px; }
  .layout {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: var(--space); column-gap: 3rem; align-items: start; justify-content: stretch;
    width: calc(100% - 40px); margin: 10px 20px; padding: var(--space);
    box-sizing: border-box; font-size: 2rem;
  }
  h1 { margin: 0; font-size: clamp(3rem, 4vw, 6rem); font-weight: 600;
    line-height: 1.25; letter-spacing: .02em; text-align: left; text-transform: none; }
  .box {
    width: 20rem; height: 80px; min-width: 10rem; max-width: 30rem;
    min-height: 60px; max-height: 100px; box-sizing: border-box;
    margin: 4px 5px 6px 7px; padding: 1.5em;
    border-style: solid; border-width: 1px 2px 3px 4px; border-color: var(--ink);
    border-radius: 1rem 2rem 3rem 4rem; box-shadow: 0 2px 4px rgba(0, 0, 0, .2);
    position: relative; overflow-x: hidden; overflow-y: auto;
  }
  .hidden { display: none; }
  .contents { display: contents; }
  img { display: block; width: 100%; height: auto; }
  .cta { width: 140px; padding: 12px; color: white; background: #3347ff; }
  @media (max-width: 600px) {
    .layout { display: flex; flex-direction: column; flex-wrap: nowrap;
      row-gap: 1rem; column-gap: 0; }
  }
</style><link rel="stylesheet" href="assets/dl-overrides.css"></head><body>
  <header data-dl-id="dl-1"><nav data-dl-id="dl-2">
    <a data-dl-id="dl-3" href="#overview">Overview</a>
  </nav></header>
  <main><section class="layout" data-dl-id="dl-10">
    <h1 data-dl-id="dl-11">Measured responsive design</h1>
    <div class="box" data-dl-id="dl-12">
      <span data-dl-id="dl-13">A deliberately ordinary explanatory sentence</span>
      <span class="hidden" data-dl-id="dl-14">Hidden explanatory text</span>
      <div><span data-dl-id="dl-15">An unstamped direct parent surrounds this text</span></div>
      <div class="contents" data-dl-id="dl-16"><span data-dl-id="dl-17">Contents child</span></div>
    </div>
    <img data-dl-id="dl-18" alt="Responsive local illustration" src="./assets/small.svg"
      srcset="./assets/small.svg 400w, ./assets/large.svg 1200w"
      sizes="(max-width: 600px) 300px, 1000px">
    <button class="cta" data-dl-id="dl-19">Start now</button>
  </section></main>
</body></html>`;

/** Files and bytes together detect both hidden output artifacts and mutation of capture evidence. */
function hashes(directory: string): Record<string, string> {
  const entries = fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  return Object.fromEntries(
    entries.map((file) => [
      path.relative(directory, file),
      createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ]),
  );
}

describe('inspect rendered details and addressed elements', () => {
  let suiteDir: string;
  let projectDir: string;
  let desktop: DetailedDocument;
  let mobile: DetailedDocument;
  let originalHashes: Record<string, string>;

  function makeProject(name: string, html = HTML): string {
    const directory = path.join(suiteDir, name);
    const assets = path.join(directory, 'clone', 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(directory, 'clone', 'index.html'), html);
    fs.writeFileSync(path.join(assets, 'dl-overrides.css'), '');
    for (const [name, width] of [['small', 400], ['large', 1200]] as const) {
      fs.writeFileSync(
        path.join(assets, `${name}.svg`),
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="200"><rect width="100%" height="100%" fill="#3347ff"/></svg>`,
      );
    }
    return directory;
  }

  function runCli(args: string[], cwd = projectDir): Promise<CliResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(process.execPath, [BUNDLE, ...args], {
        cwd,
        env: { ...process.env, DESIGN_LENS_HOME: path.join(suiteDir, 'runtime-home') },
      });
      let stdout = '';
      let stderr = '';
      const watchdog = setTimeout(() => child.kill('SIGKILL'), 20_000);
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(watchdog);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(watchdog);
        resolve({ code: code ?? 1, stdout, stderr, elapsedMs: Date.now() - startedAt });
      });
    });
  }

  async function inspect(args: string[], directory = projectDir): Promise<DetailedDocument> {
    const result = await runCli(['inspect', directory, ...args], directory);
    expect(result.code, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as DetailedDocument;
  }

  function element(document: DetailedDocument, dlId: string): InspectElement {
    const found = document.elements.find((candidate) => candidate.dlId === dlId);
    expect(found, `missing addressed element ${dlId}`).toBeDefined();
    return found!;
  }

  beforeAll(async () => {
    suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-inspect-details-'));
    projectDir = makeProject('reference');
    originalHashes = hashes(projectDir);
    desktop = await inspect(['--details', '--viewport', '1440x900']);
    mobile = await inspect(['--details', '--viewport', '390x844']);
  });

  afterAll(() => {
    if (suiteDir) fs.rmSync(suiteDir, { recursive: true, force: true });
  });

  // WHY: rem/em and viewport math cannot be recovered safely by assuming a 16px root in CSS text.
  it('reports measured root, body, typography and viewport metadata', () => {
    expect(desktop.page.viewport).toEqual({ width: 1440, height: 900 });
    expect(desktop.page.deviceScaleFactor).toBe(1);
    expect(desktop.page.rootFontSize).toBe('10px');
    expect(desktop.page.body.styles.fontSize).toBe('16px');
    expect(desktop.page.body.rect.width).toBe(1440);
    expect(desktop.page.body.details.parentDlId).toBeNull();
    expect(desktop.page.fonts).toEqual({ status: 'ready', failedFamilies: [] });
    expect(element(desktop, 'dl-11').styles.fontSize).toBe('57.6px');
    expect(element(desktop, 'dl-11').details.typography).toMatchObject({
      fontWeight: '600', lineHeight: '72px', letterSpacing: '1.152px',
      textAlign: 'left', textTransform: 'none',
    });
    expect(mobile.page.viewport).toEqual({ width: 390, height: 844 });
    expect(element(mobile, 'dl-11').styles.fontSize).toBe('30px');
    expect(element(mobile, 'dl-11').details.typography.lineHeight).toBe('37.5px');
  });

  // WHY: desktop grid declarations survive in mobile CSS; recipes must describe the active layout.
  it('measures media-query changes from grid to flex and resolves custom-property gaps', () => {
    const desktopLayout = element(desktop, 'dl-10').details.layout;
    expect(desktopLayout).toMatchObject({
      display: 'grid', rowGap: '20px', columnGap: '30px', alignItems: 'start',
    });
    expect(desktopLayout.gridTemplateColumns).toMatch(/^\d+(?:\.\d+)?px \d+(?:\.\d+)?px$/);
    expect(element(mobile, 'dl-10').details.layout).toMatchObject({
      display: 'flex', flexDirection: 'column', flexWrap: 'nowrap', rowGap: '10px', columnGap: '0px',
    });
    expect(element(desktop, 'dl-10').details.box.paddingTop).toBe('20px');
  });

  // WHY: arbitrary layout containers need an address even when no seven-role heuristic selects them.
  it('lets an id imply details and returns full box measurements for an unclassified container', async () => {
    const document = await inspect(['--id', 'dl-12']);
    expect(document.elements).toHaveLength(1);
    expect(document.page).toBeDefined();
    const box = element(document, 'dl-12');
    expect(box.role).toBeNull();
    expect(box.confidence).toBeNull();
    expect(box.details.currentSrc).toBeNull();
    expect(box.details.visible).toBe(true);
    expect(box.details.box).toMatchObject({
      width: '200px', height: '80px', minWidth: '100px', maxWidth: '300px',
      minHeight: '60px', maxHeight: '100px', boxSizing: 'border-box',
      marginTop: '4px', marginRight: '5px', marginBottom: '6px', marginLeft: '7px',
      paddingTop: '30px', paddingRight: '30px', paddingBottom: '30px', paddingLeft: '30px',
      borderTopWidth: '1px', borderRightWidth: '2px', borderBottomWidth: '3px', borderLeftWidth: '4px',
      borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid',
      borderTopColor: 'rgb(17, 34, 51)', borderRightColor: 'rgb(17, 34, 51)',
      borderBottomColor: 'rgb(17, 34, 51)', borderLeftColor: 'rgb(17, 34, 51)',
      borderTopLeftRadius: '10px', borderTopRightRadius: '20px',
      borderBottomRightRadius: '30px', borderBottomLeftRadius: '40px',
    });
    expect(box.details.box.boxShadow).toContain('2px 4px');
    expect(box.details.layout).toMatchObject({ position: 'relative', overflowX: 'hidden', overflowY: 'auto' });
  });

  // WHY: skipping hidden children or replacing an unstamped parent with an ancestor invents a DOM tree.
  it('reports direct relationships, including hidden children and null unstamped parents', async () => {
    const box = element(await inspect(['--id', 'dl-12']), 'dl-12');
    expect(box.details.parentDlId).toBe('dl-10');
    expect(box.details.childDlIds).toEqual(['dl-13', 'dl-14', 'dl-16']);
    const leaf = element(await inspect(['--id', 'dl-15']), 'dl-15');
    expect(leaf.details.parentDlId).toBeNull();
    expect(leaf.details.childDlIds).toEqual([]);
    expect(element(desktop, 'dl-10').details.parentDlId).toBeNull();
  });

  // WHY: an explicitly addressed hidden element is useful evidence about responsive alternatives.
  it('returns a hidden element without assigning an unsupported visible role', async () => {
    const document = await inspect(['--id', 'dl-14']);
    expect(document.elements).toHaveLength(1);
    expect(element(document, 'dl-14')).toMatchObject({
      role: null, confidence: null, details: { visible: false, layout: { display: 'none' } },
    });
  });

  // WHY: display:contents has no box of its own but still carries the structure a rebuild needs.
  it('returns display-contents containers and their stamped children', async () => {
    const document = await inspect(['--id', 'dl-16']);
    expect(document.elements).toHaveLength(1);
    expect(element(document, 'dl-16')).toMatchObject({
      role: null, confidence: null, rect: { width: 0, height: 0 },
      details: { parentDlId: 'dl-12', childDlIds: ['dl-17'], layout: { display: 'contents' } },
    });
  });

  // WHY: src is provenance, while currentSrc identifies the resource that actually supplied pixels.
  it('keeps src unchanged while reporting the selected local srcset candidate at each width', () => {
    const desktopImage = element(desktop, 'dl-18');
    const mobileImage = element(mobile, 'dl-18');
    expect(desktopImage.src).toBe('./assets/small.svg');
    expect(mobileImage.src).toBe('./assets/small.svg');
    expect(desktopImage.details.currentSrc).toBe('assets/large.svg');
    expect(mobileImage.details.currentSrc).toBe('assets/small.svg');
    expect(desktopImage.details.currentSrc).not.toContain('127.0.0.1');
  });

  // WHY: an absent requested role is valid empty evidence, not a failed measurement or lost metadata.
  it('keeps page metadata when a kind filter has no matches', async () => {
    const document = await inspect(['--details', '--kind', 'footer']);
    expect(document.elements).toEqual([]);
    expect(document.page.viewport).toEqual({ width: 1440, height: 900 });
    expect(document.page.rootFontSize).toBe('10px');
  });

  // WHY: combining role selection and exact identity otherwise leaves precedence to caller guesswork.
  it('rejects id combined with kind without emitting partial JSON', async () => {
    const result = await runCli(['inspect', projectDir, '--id', 'dl-11', '--kind', 'hero-heading']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/--id|--kind/i);
  });

  // WHY: arbitrary selector syntax must not turn the stable-id interface into a CSS query interface.
  it.each(['hero-heading', 'dl--1', 'dl-11"]'])('rejects malformed id %s without emitting JSON', async (id) => {
    const result = await runCli(['inspect', projectDir, '--id', id]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/invalid|expected/i);
  });

  // WHY: a missing addressed element is an actionable stale-id error, unlike an empty role inventory.
  it('fails for a missing well-formed id without emitting JSON', async () => {
    const result = await runCli(['inspect', projectDir, '--id', 'dl-999']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/dl-999/);
    expect(result.stderr).toMatch(/missing|not found|no .*element/i);
  });

  // WHY: silently choosing the first duplicate would attach measurements to an ambiguous address.
  it('fails for a duplicated addressed id without emitting JSON', async () => {
    const duplicate = makeProject('duplicate', HTML.replace('</body>', '<div data-dl-id="dl-11">Duplicate</div></body>'));
    const result = await runCli(['inspect', duplicate, '--id', 'dl-11'], duplicate);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/duplicat|multiple|more than one/i);
    expect(result.stderr).toContain('dl-11');
  });

  // WHY: the inspection contract is ephemeral; evidence files must not be refreshed or rewritten.
  it('does not add or mutate any project file while gathering detailed evidence', () => {
    expect(hashes(projectDir)).toEqual(originalHashes);
  });

  // WHY: cached measurements after an override would report the reference styling instead of the edit.
  it('reflects an override on the next inspection without rewriting captured CSS', async () => {
    const edited = makeProject('overrides');
    const before = element(await inspect(['--id', 'dl-12'], edited), 'dl-12');
    expect(before.details.box.paddingLeft).toBe('30px');
    fs.writeFileSync(path.join(edited, 'clone', 'assets', 'dl-overrides.css'), '[data-dl-id="dl-12"] { padding-left: 44px; }\n');
    const afterEdit = hashes(edited);
    const after = element(await inspect(['--id', 'dl-12'], edited), 'dl-12');
    expect(after.details.box.paddingLeft).toBe('44px');
    expect(hashes(edited)).toEqual(afterEdit);
  });

  // WHY: combining an early role probe's rect with later details can describe two animation frames.
  // Advancing a real CSS animation after the first box read makes that race deterministic, without
  // relying on timer scheduling or assuming that reduced-motion disables the page's own animation.
  it('keeps rect, styles and detailed box values from the same rendered animation frame', async () => {
    const animated = makeProject('animated', `<!doctype html><html><head><style>
      body { margin: 0; }
      #animated { box-sizing: border-box; line-height: 1; animation: grow 1s linear infinite; }
      @keyframes grow {
        from { width: 100px; font-size: 10px; }
        to { width: 900px; font-size: 90px; }
      }
    </style></head><body><div id="animated" data-dl-id="dl-42">Measured animation</div><script>
      const target = document.getElementById('animated');
      const animation = target.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const readBox = target.getBoundingClientRect.bind(target);
      let reads = 0;
      target.getBoundingClientRect = () => {
        const box = readBox();
        if (reads++ === 0) animation.currentTime = 800;
        return box;
      };
    </script></body></html>`);
    const measured = element(await inspect(['--id', 'dl-42'], animated), 'dl-42');
    expect(Number.parseFloat(measured.details.box.width)).toBeCloseTo(740, 0);
    expect(Math.abs(measured.rect.width - Number.parseFloat(measured.details.box.width))).toBeLessThanOrEqual(1);
    expect(Number.parseFloat(measured.styles.fontSize)).toBeCloseTo(74, 0);
    expect(measured.details.typography.lineHeight).toBe(measured.styles.fontSize);
  });

  // WHY: document.fonts.ready can resolve after a failed request; readiness alone must not imply fidelity.
  it('reports a failed local font family alongside completed font readiness', async () => {
    const failed = makeProject('failed-font', HTML.replace('</style>', `
      @font-face { font-family: "Missing Detail Font"; src: url("assets/missing.woff2") format("woff2"); }
      h1 { font-family: "Missing Detail Font", sans-serif; }
    </style>`));
    const document = await inspect(['--details'], failed);
    expect(document.page.fonts.status).toBe('ready');
    expect(document.page.fonts.failedFamilies.map((family) => family.replace(/["']/g, ''))).toContain('Missing Detail Font');
    expect(element(document, 'dl-11').rect.width).toBeGreaterThan(0);
  });

  // WHY: a missing browser font API must qualify the evidence rather than claim readiness or crash.
  // The standard API is shadowed only inside this temporary fixture to exercise that fallback.
  it('reports unavailable font readiness when the page has no FontFaceSet', async () => {
    const unavailable = makeProject('unavailable-fonts', HTML.replace('</head>', `<script>
      Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
    </script></head>`));
    const result = await runCli(['inspect', unavailable, '--details'], unavailable);
    expect(result.code, result.stderr).toBe(0);
    const document = JSON.parse(result.stdout) as DetailedDocument;
    expect(document.page.fonts).toEqual({ status: 'unavailable', failedFamilies: [] });
    expect(result.stderr).toMatch(/font/i);
    expect(result.stderr).toMatch(/unavailable/i);
    expect(element(document, 'dl-11').rect.width).toBeGreaterThan(0);
  });

  // WHY: pathological font readiness must yield bounded, explicitly qualified evidence instead of a hang.
  // This script exists only in a temporary fixture to inject a stalled browser FontFaceSet promise.
  it('reports a warning and timeout status within ten seconds when font readiness never settles', async () => {
    const stalled = makeProject('stalled-font', HTML.replace('</head>', `<script>
      Object.defineProperty(document.fonts, 'ready', { value: new Promise(() => {}), configurable: true });
    </script></head>`));
    const result = await runCli(['inspect', stalled, '--details'], stalled);
    expect(result.code, result.stderr).toBe(0);
    expect(result.elapsedMs).toBeLessThan(10_000);
    const document = JSON.parse(result.stdout) as DetailedDocument;
    expect(document.page.fonts.status).toBe('timeout');
    expect(result.stderr).toMatch(/font/i);
    expect(result.stderr).toMatch(/timeout|timed out/i);
    expect(element(document, 'dl-11').rect.width).toBeGreaterThan(0);
  });
});
