/**
 * `inspect <projectDir>` e2e: clone the `basic` fixture with the BUILT bundle, then inspect the
 * on-disk clone and assert the stdout contract.
 *
 * WHY this exists: this is the own-suite mirror of the sealed `.harness/e2e-assert.sh` A18, which
 * runs `inspect <PROJ>` against the SEALED fixture and greps its compact stdout for `logo`, three
 * `nav-link`s, `hero-heading`, `hero-image` and `cta`. The unit suite proves every role RULE on
 * synthetic probes; nothing there opens a browser. Only here do we prove the other half: that the
 * in-page probe survives bundling+minification into `page.evaluate`, that a real Chromium layout of
 * a real localized clone produces probes those rules can classify, that the JSON lands on stdout as
 * ONE line with progress on stderr, and — the ADR-002 decree — that `inspect` writes nothing.
 *
 * If the probe stopped being self-contained (a minifier lifting a constant out of it), every unit
 * test would stay green and only this would fail with `ReferenceError` inside the page.
 *
 * Tests only ever touch 127.0.0.1 fixtures on ephemeral ports (never 4630/4631, never the live web).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

/** The committed artifact under test — NOT the TS source (spec 08: e2e drives the built bundle). */
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const SITES = fileURLToPath(new URL('../fixtures/sites', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** See clone.test.ts: consent blocking is ON by default, so every run gets a seeded throwaway home. */
const SEEDED_DEFAULT_LIST = '! design-lens e2e stand-in list\n###dl-e2e-remote-list-matches-nothing\n';

function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-home-'));
  const cacheDir = path.join(home, 'cache', 'filterlists');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'fanboy-cookiemonster.txt'), SEEDED_DEFAULT_LIST, 'utf8');
  return home;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], {
      cwd,
      env: { ...process.env, DESIGN_LENS_HOME: tmpHome() },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dl-e2e-'));
}

/** Every file under `dir`, relative and sorted — the ADR-002 "wrote nothing" witness. */
function fileTree(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

interface InspectElement {
  dlId: string;
  role: string;
  confidence: number;
  tag: string;
  selector: string;
  text: string | null;
  src: string | null;
  rect: { x: number; y: number; width: number; height: number };
  styles: { color: string; background: string; fontSize: string; fontFamily: string };
}

interface InspectDocument {
  elements: InspectElement[];
  colors: string;
}

/** The `basic` fixture's brand color, as Chromium reports a computed `background-color`. */
const BRAND_RGB = 'rgb(51, 71, 255)';

describe('inspect on a basic clone', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;
  let doc: InspectDocument;
  let raw: CliResult;

  const roleOf = (role: string): InspectElement[] => doc.elements.filter((e) => e.role === role);

  const indexOf = (project: string): string => path.join(project, 'clone', 'index.html');

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    const cloned = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'basic'],
      out,
    );
    expect(cloned.code, `clone failed: ${cloned.stderr}`).toBe(0);
    projectDir = (JSON.parse(cloned.stdout.trim()) as { projectDir: string }).projectDir;

    raw = await runCli(['inspect', projectDir], out);
    expect(raw.code, `inspect failed: ${raw.stderr}`).toBe(0);
    doc = JSON.parse(raw.stdout) as InspectDocument;
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: THE T18 acceptance criterion and the exact claim sealed assertion A18 makes. Every role in
  // it resolves to the fixture's one unambiguous element, so this fails loudly if a heuristic starts
  // pointing at the wrong node rather than merely producing "some element with the right role".
  it('reports logo, three nav-links, hero-heading, hero-image and cta', () => {
    const logo = roleOf('logo');
    expect(logo).toHaveLength(1);
    expect(logo[0].tag).toBe('img');
    // `header img` is the first logo pattern, hence full confidence.
    expect(logo[0].confidence).toBe(0.9);
    expect(logo[0].src).toMatch(/^assets\/.+\/img\/logo\.svg$/);

    const nav = roleOf('nav-link');
    expect(nav.map((e) => e.text)).toEqual(['Home', 'Features', 'Pricing']);
    expect(nav.every((e) => e.tag === 'a' && e.confidence === 0.9)).toBe(true);
    // The footer's three links live in a <ul>, not a <nav>, and sit far below the top quarter.
    expect(nav).toHaveLength(3);

    const heading = roleOf('hero-heading');
    expect(heading).toHaveLength(1);
    expect(heading[0].tag).toBe('h1');
    expect(heading[0].text).toBe('Ship faithful clones');
    expect(heading[0].styles.fontSize).toBe('48px');

    // `.hero` carries `background-image: url(img/bg.png)` and covers 1440×834 — a larger rect than
    // the 960×480 `<img>` inside it. Spec 05 ranks hero-image candidates by AREA, over `img` and
    // background-image elements alike, so the band wins. Its `src` is the background url().
    const image = roleOf('hero-image');
    expect(image).toHaveLength(1);
    expect(image[0].tag).toBe('section');
    expect(image[0].src).toMatch(/^assets\/.+\/img\/bg\.png$/);
    expect(image[0].rect.width).toBe(1440);

    const cta = roleOf('cta');
    expect(cta).toHaveLength(1);
    expect(cta[0].tag).toBe('a');
    expect(cta[0].text).toBe('Get started');
    // `a.btn` matches the class pattern, so the contrast fallback never ran.
    expect(cta[0].confidence).toBe(0.9);
    expect(cta[0].styles.background).toBe(BRAND_RGB);
  });

  // why: the addressing contract. Every skill edits the clone through `[data-dl-id="…"]`, so a
  // reported `selector` that does not literally select the reported element in the clone HTML would
  // send every downstream edit to the wrong node (or nowhere).
  it('addresses every element by a data-dl-id that exists in the clone', () => {
    const html = fs.readFileSync(indexOf(projectDir), 'utf8');
    expect(doc.elements.length).toBeGreaterThan(0);
    for (const element of doc.elements) {
      expect(element.selector).toBe(`[data-dl-id="${element.dlId}"]`);
      expect(html).toContain(`data-dl-id="${element.dlId}"`);
    }
    // Unique ids: two elements never share a dlId, or `selector` stops identifying one element.
    const ids = doc.elements.map((e) => e.dlId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // why: spec 05 — "table role order, then ascending numeric data-dl-id within a role". String
  // ordering would put `dl-10` before `dl-9`, so the inventory would not read in document order.
  it('orders elements by role table order, then ascending numeric dlId', () => {
    const ROLE_ORDER = ['logo', 'nav-link', 'hero-heading', 'hero-image', 'cta', 'footer', 'section'];
    const rank = doc.elements.map((e) => ROLE_ORDER.indexOf(e.role));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(rank.every((r) => r >= 0)).toBe(true);

    for (const role of ROLE_ORDER) {
      const ids = roleOf(role).map((e) => Number(e.dlId.replace('dl-', '')));
      expect(ids, `dlIds within ${role}`).toEqual([...ids].sort((a, b) => a - b));
    }
  });

  // why: ADR-002 — the inventory is EPHEMERAL "by user decree". There is no manifest of editable
  // elements and no cached inspection: if `inspect` ever wrote one, the next run would describe a
  // stale clone, and the customization layer would grow the persistent state ADR-002 rejected.
  it('writes nothing into the project directory', async () => {
    const before = fileTree(projectDir);
    const result = await runCli(['inspect', projectDir, '--pretty'], out);
    expect(result.code).toBe(0);
    expect(fileTree(projectDir)).toEqual(before);
    expect(before).not.toContain('inspect.json');
  });

  // why: sealed A18 pipes stdout through `grep -o '"role":"[^"]*"'` — a COMPACT single line. If any
  // progress line leaked to stdout the JSON would not parse, and if the default were pretty-printed
  // the gate's `"role":"…"` pattern (no space after the colon) would match nothing.
  // Also pins the CLI I/O contract (guardrails): human progress → stderr, machine JSON → stdout.
  it('prints compact single-line JSON to stdout and progress to stderr', () => {
    expect(raw.stdout.endsWith('\n')).toBe(true);
    expect(raw.stdout.trimEnd()).not.toContain('\n');
    expect(raw.stdout).toContain('"role":"logo"');
    expect(raw.stderr).toMatch(/design-lens: /);
    expect(raw.stderr).toMatch(/design-lens: inspected \d+ element\(s\)/);
    expect(doc.colors).toBe('see tokens.json');
  });

  // why: `--pretty` is a formatting switch, not a different analysis. If it re-ran the classifier
  // with different inputs, an agent comparing a pretty dump against a piped one would see two
  // different inventories of the same clone.
  it('--pretty indents the same document', async () => {
    const pretty = await runCli(['inspect', projectDir, '--pretty'], out);
    expect(pretty.code).toBe(0);
    expect(pretty.stdout).toContain('\n  "elements": [');
    expect(JSON.parse(pretty.stdout)).toEqual(doc);
  });

  // why: `background-image` is only readable as the ABSOLUTE url Chromium resolved it to — which
  // embeds the ephemeral port this run happened to bind. Leaking it would make stdout differ on
  // every run and hand skills a path that dies with the server.
  it('never leaks the ephemeral server origin into stdout', () => {
    expect(raw.stdout).not.toContain('http://127.0.0.1');
    expect(raw.stdout).not.toContain('localhost');
    const image = roleOf('hero-image')[0];
    expect(image.src?.startsWith('assets/')).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'clone', image.src as string))).toBe(true);
  });
});

describe('inspect --kind', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    const cloned = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'basic'],
      out,
    );
    expect(cloned.code, `clone failed: ${cloned.stderr}`).toBe(0);
    projectDir = (JSON.parse(cloned.stdout.trim()) as { projectDir: string }).projectDir;
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: `--kind` is what inspect-elements and customize-clone use to ask a narrow question. It must
  // project the SAME classification, not re-run a narrowed table — otherwise `inspect` and
  // `inspect --kind cta` could disagree about which element is the CTA.
  it('projects a single role out of the full inventory', async () => {
    const all = await runCli(['inspect', projectDir], out);
    const only = await runCli(['inspect', projectDir, '--kind', 'cta'], out);
    expect(only.code).toBe(0);

    const fullCta = (JSON.parse(all.stdout) as InspectDocument).elements.filter(
      (e) => e.role === 'cta',
    );
    const projected = JSON.parse(only.stdout) as InspectDocument;
    expect(projected.elements).toEqual(fullCta);
    expect(projected.colors).toBe('see tokens.json');
  });

  // why: spec 05 — an invalid `--kind` is a usage error (exit 1), NOT an empty inventory. Exiting 0
  // with `elements: []` would read to the calling skill as "this clone has no logos" when the truth
  // is "you misspelled the flag". Nothing may reach stdout, or the skill would parse the lie.
  it('exits 1 on an unknown role, printing nothing to stdout', async () => {
    const result = await runCli(['inspect', projectDir, '--kind', 'hero'], out);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/error: invalid --kind "hero"/);
    expect(result.stderr).toContain('hero-heading');
  });

  // why: spec 05 — "An empty result for a role is NOT an error — exit 0 with whatever was found."
  // A clone with no footer is a normal clone; failing here would make the skills treat a legitimate
  // design (no footer) as a broken tool.
  it('exits 0 with an empty array when a role is absent', async () => {
    const copy = path.join(tmpOut(), 'basic');
    fs.cpSync(projectDir, copy, { recursive: true });
    const indexPath = path.join(copy, 'clone', 'index.html');
    const stripped = fs.readFileSync(indexPath, 'utf8').replace(/<footer[\s\S]*?<\/footer>/, '');
    expect(stripped).not.toContain('<footer');
    fs.writeFileSync(indexPath, stripped);

    const result = await runCli(['inspect', copy, '--kind', 'footer'], out);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ elements: [], colors: 'see tokens.json' });
  });

  // why: spec 05 — "Candidates lacking a data-dl-id attribute MUST be skipped with a stderr warning."
  // Because `inspect` re-renders the clone AS IT IS NOW, a hand-edited element really can arrive
  // without an id; reporting it would hand the agent a `[data-dl-id="null"]` selector. The skip must
  // also not kill the role: with the `<h1>` un-addressable, hero-heading falls to its largest-text
  // fallback (confidence 0.8) instead of vanishing.
  it('warns and skips a candidate with no data-dl-id, then falls back', async () => {
    const copy = path.join(tmpOut(), 'basic');
    fs.cpSync(projectDir, copy, { recursive: true });
    const indexPath = path.join(copy, 'clone', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const stripped = html.replace(/(<h1\b[^>]*?)\s+data-dl-id="[^"]*"/, '$1');
    expect(stripped, 'the h1 carried a data-dl-id to strip').not.toBe(html);
    fs.writeFileSync(indexPath, stripped);

    const result = await runCli(['inspect', copy], out);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('warning: candidate without data-dl-id skipped: <h1>');
    expect(result.stderr).toContain('(role hero-heading)');

    const heading = (JSON.parse(result.stdout) as InspectDocument).elements.filter(
      (e) => e.role === 'hero-heading',
    );
    expect(heading).toHaveLength(1);
    expect(heading[0].tag).not.toBe('h1');
    expect(heading[0].confidence).toBe(0.8);
  });
});

describe('inspect on a directory that is not a clone', () => {
  // why: spec 05 reserves exit 1 for a missing `clone/index.html` (plus bind/launch failures). The
  // check must happen BEFORE a port is bound or Chromium is launched, so a typo'd path costs nothing
  // and leaves no orphan browser behind.
  it('exits 1 with an error on stderr and never launches a browser', async () => {
    const empty = tmpOut();
    try {
      const result = await runCli(['inspect', empty], empty);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/error: not a design-lens clone project/);
      expect(result.stderr).not.toMatch(/serving/);
      expect(result.stdout).toBe('');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
