/**
 * `tokens <projectDir>` e2e: clone the `basic` fixture with the BUILT bundle, then run `tokens`
 * over the on-disk clone and assert the `tokens.json` contract.
 *
 * WHY this exists: this is the own-suite mirror of the sealed `.harness/e2e-assert.sh` A17, which
 * runs `tokens <PROJ> --stdout` against the SEALED fixture and greps for both brand colors and the
 * font family. Everything the unit suite proves about `extractTokens` is proved on synthetic CSS
 * strings; only here do we prove that the CSS the CLONE actually wrote to disk — localized url()s,
 * an `@import` chain split across two manifest resources, a beautified stylesheet — still yields
 * those tokens. If the manifest shape, the localized asset layout, or the CSS beautifier changed in
 * a way that hid a stylesheet from `tokens`, every unit test would stay green and only this fails.
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

/** The `basic` fixture's brand color and typeface — repeated across style.css and second.css. */
const BRAND_HEX = '#3347ff';
const BRAND_FAMILY = 'Brand Sans';

/**
 * Uses of the brand color in the CLONE (not in the raw fixture):
 *   7  style.css   — custom property, border-bottom, 3× color, background, outline
 * + 5  second.css  — reached only through the localized `@import` chain
 * + 2  an inline `<style>` block that @percy/dom writes when it materializes `:hover`/`:focus`
 *      state, spelled `rgb(51, 71, 255)` rather than `#3347ff`
 */
const BRAND_USES_TOTAL = 14;
/** The same count once second.css is gone — the @import chain is worth exactly its 5 uses. */
const BRAND_USES_WITHOUT_IMPORT = 9;

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

interface TokensDocument {
  colors: { hex: string; count: number; roles: string[]; clusterOf: string[] }[];
  palette: { primaryGuess: string | null; neutrals: string[]; accents: string[] };
  typography: {
    families: { name: string; usage: string; faces: string[] }[];
    sizesPx: number[];
    weights: number[];
  };
  spacing: { base: number; scalePx: number[] };
  radii: number[];
}

interface ManifestDocument {
  resources: { localPath: string; contentType: string }[];
}

describe('tokens on a basic clone', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;

  const readManifest = (): ManifestDocument =>
    JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as ManifestDocument;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    const result = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'basic'],
      out,
    );
    expect(result.code, `clone failed: ${result.stderr}`).toBe(0);
    projectDir = (JSON.parse(result.stdout.trim()) as { projectDir: string }).projectDir;
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: THE T17 acceptance criterion. Proves the command reads the clone's real, localized,
  // beautified CSS — spread across style.css AND its @import target second.css, each a separate
  // manifest resource — and recovers the fixture's brand color as the dominant non-neutral cluster
  // plus its typeface. This is the exact claim sealed assertion A17 makes about the sealed fixture.
  it('reports the brand color and the font family from the clone CSS', async () => {
    const result = await runCli(['tokens', projectDir], out);
    expect(result.code, `tokens failed: ${result.stderr}`).toBe(0);

    const tokens = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'tokens.json'), 'utf8'),
    ) as TokensDocument;

    expect(tokens.palette.primaryGuess).toBe(BRAND_HEX);
    const dominant = [...tokens.colors].sort((a, b) => b.count - a.count)[0];
    expect(dominant.hex).toBe(BRAND_HEX);
    expect(dominant.count).toBe(BRAND_USES_TOTAL);
    // The clone spells this color BOTH as `#3347ff` (stylesheets) and `rgb(51, 71, 255)` (percy's
    // materialized pseudo-state block). One hex in `clusterOf` proves the two notations were
    // normalized into one design token instead of reported as two brand colors.
    expect(dominant.clusterOf).toEqual([BRAND_HEX]);
    expect(fs.readFileSync(path.join(projectDir, 'clone', 'index.html'), 'utf8')).toContain(
      'rgb(51, 71, 255)',
    );

    expect(tokens.typography.families.map((f) => f.name)).toContain(BRAND_FAMILY);
    // The scale really is captured, not just the family name.
    expect(tokens.typography.sizesPx).toEqual([20, 48]);
    expect(tokens.typography.weights).toEqual([400, 600, 700]);
    expect(tokens.spacing.base).toBe(8);
    expect(tokens.radii).toEqual([6, 8]);
  });

  // why: sealed A17 consumes `tokens <PROJ> --stdout` and greps the stdout. If ANY progress line
  // leaked onto stdout the JSON would not parse; if `--stdout` printed something different from the
  // file, the gate's `|| cat tokens.json` fallback would silently test a different document.
  // Also pins the CLI I/O contract (guardrails): human progress → stderr, machine JSON → stdout.
  it('prints exactly the tokens.json bytes on --stdout, with progress on stderr', async () => {
    const bare = await runCli(['tokens', projectDir], out);
    expect(bare.stdout).toBe('');
    expect(bare.stderr).toMatch(/design-lens: /);

    const piped = await runCli(['tokens', projectDir, '--stdout'], out);
    expect(piped.code).toBe(0);
    expect(piped.stdout).toBe(fs.readFileSync(path.join(projectDir, 'tokens.json'), 'utf8'));
    expect(() => JSON.parse(piped.stdout)).not.toThrow();
    expect(piped.stdout).toContain(BRAND_HEX);
    expect(piped.stdout).toContain(BRAND_FAMILY);
  });

  // why: ADR-013. A reference inside a stylesheet is localized relative to THAT stylesheet, so the
  // face path is `fonts/brand.woff2`, not `assets/…/fonts/brand.woff2`. This pins the ADR against
  // the real localizer output — if either side changes, the spec sentence is stale and this fails.
  it('records @font-face src paths exactly as written in the localized stylesheet', () => {
    const tokens = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'tokens.json'), 'utf8'),
    ) as TokensDocument;
    const brand = tokens.typography.families.find((f) => f.name === BRAND_FAMILY);
    expect(brand?.faces).toEqual(['fonts/brand.woff2']);

    const stylesheet = readManifest().resources.find((r) => r.localPath.endsWith('style.css'));
    const css = fs.readFileSync(path.join(projectDir, stylesheet!.localPath), 'utf8');
    expect(css).toContain('url(fonts/brand.woff2)');
  });

  // why: `dl-overrides.css` is the user's edit layer. If `tokens` ever read it, the reported
  // "reference design" would drift toward the user's own customizations with every edit — the
  // analysis would end up describing the copy instead of the original. The unit suite covers the
  // filter; only here do we prove it holds when the file is BOTH on disk AND listed as a manifest
  // resource (which is exactly what a future writer change might do).
  it('never analyzes the user override stylesheet, even when the manifest lists it', async () => {
    const overridePath = path.join(projectDir, 'clone', 'assets', 'dl-overrides.css');
    // A color that appears nowhere in the fixture, used often enough to dominate if it were read.
    fs.writeFileSync(overridePath, '.a,.b,.c,.d,.e{color:#00ff88;border-color:#00ff88}\n');

    const manifest = readManifest();
    manifest.resources.push({ localPath: 'clone/assets/dl-overrides.css', contentType: 'text/css' });
    fs.writeFileSync(path.join(projectDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const result = await runCli(['tokens', projectDir, '--stdout'], out);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('00ff88');
    expect(result.stdout).toContain(BRAND_HEX);
  });

  // why: a clone whose asset was deleted (or never written) must degrade to a warning and exit 0 —
  // spec 05 reserves exit 1 for "this is not a clone project". Crashing here would make `tokens`
  // unusable on any partially-fetched clone, which is the common case on a flaky reference site.
  it('warns and still exits 0 when a manifest-listed stylesheet is missing on disk', async () => {
    const stylesheet = readManifest().resources.find((r) => r.localPath.endsWith('second.css'));
    expect(stylesheet, 'the basic fixture @imports second.css').toBeDefined();
    fs.rmSync(path.join(projectDir, stylesheet!.localPath));

    const result = await runCli(['tokens', projectDir, '--stdout'], out);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/warning: manifest CSS missing on disk/);

    // The surviving sources still carry the brand color, minus exactly second.css's 5 uses.
    const tokens = JSON.parse(result.stdout) as TokensDocument;
    expect(tokens.palette.primaryGuess).toBe(BRAND_HEX);
    expect([...tokens.colors].sort((a, b) => b.count - a.count)[0].count).toBe(
      BRAND_USES_WITHOUT_IMPORT,
    );
    expect(BRAND_USES_TOTAL - BRAND_USES_WITHOUT_IMPORT).toBe(5);
  });
});

describe('tokens on a directory that is not a clone', () => {
  // why: spec 05 makes exactly two conditions fatal — no `clone/index.html`, no `manifest.json`.
  // Exiting 0 with an empty tokens.json would let a skill silently analyze nothing and report a
  // site as having no design tokens at all.
  it('exits 1 with an error on stderr', async () => {
    const empty = tmpOut();
    try {
      const result = await runCli(['tokens', empty], empty);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/error: not a design-lens clone project/);
      expect(result.stdout).toBe('');
      expect(fs.existsSync(path.join(empty, 'tokens.json'))).toBe(false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
