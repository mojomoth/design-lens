/**
 * M1 spine e2e: drive the BUILT bundle (`dist/design-lens.cjs`) against the plugin's own fixture
 * sites served on ephemeral loopback ports, and assert the on-disk clone contract.
 *
 * WHY this exists: these are the own-suite mirror of the sealed `.harness/e2e-assert.sh --m1`
 * (which runs the same bundle against the SEALED fixture). If any spine stage regresses — launch,
 * settle, stamp, CSSOM-walk serialize, sanitize, localize, beautify, write — one of these fails.
 * They spawn the committed bundle (not the TS source) so they also catch a stale/broken `dist/`.
 * Removing them would let a broken clone pipeline ship green. Tests only ever touch 127.0.0.1
 * fixtures on ephemeral ports (never 4630/4631, never the live web).
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

/**
 * The REMOTE half of the default consent list, seeded into a fresh temp home's cache so the 7-day
 * TTL is satisfied and no download is ever attempted (tests never touch the live web — guardrails).
 *
 * Its single rule matches NOTHING in any fixture, on purpose: it stands in for fanboy-cookiemonster
 * without contributing any removal. Anything the default clone removes is therefore attributable to
 * design-lens's own built-in consent rules (ADR-012) — which is exactly what the default-clone test
 * below asserts, mirroring sealed assertion A16.
 */
const SEEDED_DEFAULT_LIST = [
  '! design-lens e2e: stands in for the downloaded fanboy-cookiemonster list.',
  '! Matches nothing in any fixture, so default-clone removals come from the built-in rules alone.',
  '###dl-e2e-remote-list-matches-nothing',
  '',
].join('\n');

/** Make a throwaway `DESIGN_LENS_HOME` whose consent filter-list cache is already fresh. */
function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-home-'));
  const cacheDir = path.join(home, 'cache', 'filterlists');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'fanboy-cookiemonster.txt'), SEEDED_DEFAULT_LIST, 'utf8');
  return home;
}

/**
 * Run the bundle with `args`; resolve with the exit code and captured streams (never rejects).
 *
 * Every run is pinned to a throwaway `DESIGN_LENS_HOME` (see {@link tmpHome}) because consent
 * blocking is ON by default: without a seeded cache the CLI would download its filter list, and
 * tests never touch the live web (guardrails). It also keeps runs independent of whatever the
 * developer's real `~/.design-lens` cache happens to hold.
 */
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

/** Make a throwaway temp dir for one clone run's `--out` root. */
function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dl-e2e-'));
}

describe('clone basic (M1 spine)', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;
  let indexHtml: string;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    const result = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'basic'],
      out,
    );
    // A failed clone here dooms every assertion below; surface the CLI's stderr in the message.
    expect(result.code, `clone failed: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { projectDir: string; warnings: number };
    projectDir = parsed.projectDir;
    expect(path.isAbsolute(projectDir)).toBe(true);
    indexHtml = fs.readFileSync(path.join(projectDir, 'clone', 'index.html'), 'utf8');
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('writes clone/index.html with the provenance comment on line 1', () => {
    expect(fs.existsSync(path.join(projectDir, 'clone', 'index.html'))).toBe(true);
    expect(indexHtml.split('\n')[0]).toContain('Cloned by design-lens v0.1.0');
  });

  it('stamps unique data-dl-id attributes on body elements', () => {
    const ids = [...indexHtml.matchAll(/data-dl-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('localizes the stylesheet and its @import chain under clone/assets/', () => {
    const cssFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.css') && entry.name !== 'dl-overrides.css') cssFiles.push(full);
      }
    };
    walk(path.join(projectDir, 'clone', 'assets'));
    // style.css + the @import target second.css must both be localized (chain followed).
    expect(cssFiles.length).toBeGreaterThanOrEqual(2);
    const allCss = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(allCss).toContain('.features'); // a selector that lives only in second.css
    // The <link href> in the HTML now points under assets/, not at the live server.
    expect(indexHtml).toMatch(/<link[^>]+href="assets\//);
  });

  it('localizes the @font-face woff2 captured during render', () => {
    const fonts: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.woff2')) fonts.push(full);
      }
    };
    walk(path.join(projectDir, 'clone', 'assets'));
    expect(fonts.length).toBeGreaterThanOrEqual(1);
  });

  it('rewrites inline style="" url() and leaves no reference to the live server', () => {
    // The inline panel background and CSS backgrounds must not point back at 127.0.0.1.
    const cloneDir = path.join(projectDir, 'clone');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (fs.readFileSync(full, 'utf8').includes('127.0.0.1')) offenders.push(full);
      }
    };
    // Only text files matter; binary reads that include the host substring are vanishingly unlikely.
    walk(cloneDir);
    expect(offenders).toEqual([]);
    // bg.png referenced from inline style + CSS is localized somewhere under assets/.
    const pngs: string[] = [];
    const walkPng = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkPng(full);
        else if (/bg.*\.png$/.test(entry.name)) pngs.push(full);
      }
    };
    walkPng(path.join(cloneDir, 'assets'));
    expect(pngs.length).toBeGreaterThanOrEqual(1);
  });

  it('produces an inert clone (no <script>, no on* handlers)', () => {
    expect(indexHtml).not.toMatch(/<script/i);
    expect(indexHtml).not.toMatch(/\son[a-z]+="/i);
  });

  it('preserves <pre> content byte-for-byte through beautification', () => {
    // The tab-indented return line must survive verbatim (beautify unformatted: pre).
    expect(indexHtml).toContain('\treturn "Hello, " + name;');
  });

  it('writes a manifest whose resource localPaths all exist on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
      resources: { localPath: string }[];
    };
    expect(manifest.resources.length).toBeGreaterThan(0);
    for (const resource of manifest.resources) {
      expect(resource.localPath.startsWith('clone/assets/')).toBe(true);
      expect(fs.existsSync(path.join(projectDir, resource.localPath))).toBe(true);
    }
  });

  // why (T14): the fixture's `srcset="img/hero.png 1x, img/hero@2x.png 2x"` makes Chromium request
  // ONLY the 1x candidate at the default `--dsf 1` — the 2x variant is referenced but never captured.
  // Without the post-render refetch pass it stays a live 127.0.0.1 URL (a broken image the moment the
  // clone moves machines) and the sealed A14 "both srcset candidates localized" fails. This pins the
  // whole chain: both variants on disk, the srcset attribute rewritten to both local paths with
  // descriptors intact, and the manifest telling the truth about how each variant's bytes arrived —
  // `network` for the rendered one, `refetch` for the one we had to go back for.
  it('localizes both srcset candidates and records the refetched one as via: refetch', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
      resources: { localPath: string; originalUrl: string; via: string }[];
    };
    const rendered = manifest.resources.find((r) => r.originalUrl.endsWith('/img/hero.png'));
    const refetched = manifest.resources.find((r) => r.originalUrl.endsWith('/img/hero@2x.png'));

    expect(rendered, `1x variant missing from manifest:\n${JSON.stringify(manifest.resources, null, 2)}`)
      .toBeDefined();
    expect(refetched, `2x variant missing from manifest:\n${JSON.stringify(manifest.resources, null, 2)}`)
      .toBeDefined();

    // Chromium fetched the 1x candidate while rendering; the 2x candidate only exists because of refetch.
    expect(rendered!.via).toBe('network');
    expect(refetched!.via).toBe('refetch');

    // Both are real files under clone/assets/, and the 2x bytes are the genuine larger variant
    // (1200x600, ~3 KB) — not a copy of the 1x image that a URL-mapping bug could produce.
    expect(fs.existsSync(path.join(projectDir, rendered!.localPath))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, refetched!.localPath))).toBe(true);
    expect(fs.statSync(path.join(projectDir, refetched!.localPath)).size).toBeGreaterThan(
      fs.statSync(path.join(projectDir, rendered!.localPath)).size,
    );

    // The rewritten srcset points at both local paths and preserves the `1x`/`2x` descriptors.
    const match = /<img[^>]*\bsrcset="([^"]+)"/i.exec(indexHtml);
    expect(match, `no srcset survived in the clone:\n${indexHtml}`).not.toBeNull();
    expect(match![1]).toMatch(/^assets\/\S+ 1x, assets\/\S+ 2x$/);
  });

  it('writes a REPORT.md carrying the license notice heading', () => {
    const report = fs.readFileSync(path.join(projectDir, 'REPORT.md'), 'utf8');
    expect(report).toContain('## License & usage notice');
  });

  it('creates an empty dl-overrides.css linked last in <head>', () => {
    const overrides = path.join(projectDir, 'clone', 'assets', 'dl-overrides.css');
    expect(fs.existsSync(overrides)).toBe(true);
    expect(fs.statSync(overrides).size).toBe(0);
    expect(indexHtml).toContain('href="assets/dl-overrides.css"');
  });
});

describe('clone spa (M1 CSSOM-walk serializer)', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;
  let indexHtml: string;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'spa'));
    out = tmpOut();
    const result = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'spa'],
      out,
    );
    expect(result.code, `clone failed: ${result.stderr}`).toBe(0);
    projectDir = (JSON.parse(result.stdout.trim()) as { projectDir: string }).projectDir;
    indexHtml = fs.readFileSync(path.join(projectDir, 'clone', 'index.html'), 'utf8');
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('folds an adoptedStyleSheets rule into the serialized output', () => {
    // The SPA injects `.dl-spa-marker { color: rgb(1, 2, 3) }` via a constructed sheet — invisible
    // to outerHTML. If the CSSOM walk regresses, this Chromium-normalized rule disappears.
    expect(indexHtml).toContain('rgb(1, 2, 3)');
  });

  it('serializes the JS-built DOM and stamps it', () => {
    expect(indexHtml).toContain('Injected via adoptedStyleSheets');
    const ids = [...indexHtml.matchAll(/data-dl-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('strips the building <script> so the SPA clone is inert', () => {
    expect(indexHtml).not.toMatch(/<script/i);
  });

  // why (T12): the @percy/dom serializer must convert the painted <canvas> — whose bitmap lives only
  // in GPU memory and is lost by outerHTML — into an inline data: <img>. If percy is not injected or
  // restore drops the canvas resource, the clone shows a blank/broken image instead of the chart.
  it('converts the painted canvas into an inline data: image (percy serializer)', () => {
    expect(indexHtml).toMatch(/<img[^>]+src="data:image\//i);
  });

  // why (T12): open shadow roots vanish from outerHTML; percy must emit them as declarative
  // `<template shadowroot>` so the clone renders the custom element's shadow content. A regression
  // to the outerHTML fallback drops the shadow tree entirely.
  it('serializes the open shadow root as a declarative <template shadowroot>', () => {
    expect(indexHtml).toMatch(/<template shadowroot/i);
  });

  // why (T12): the input value is set by JS as a property AFTER load, invisible to outerHTML. Percy
  // reflects the live value into a `value=""` attribute; without it the clone loses form state.
  it('captures the JS-set input value as an attribute', () => {
    expect(indexHtml).toContain('set-by-js@example.com');
  });

  // why (T13): the lazy <img> has NO real src at load — an IntersectionObserver three viewport
  // heights down sets it only on intersect. Without the lazy-load scroll sweep the browser never
  // requests img/lazy.png, so it is never captured, never localized, and the clone shows a broken
  // image. This asserts the sweep fired: lazy.png is localized under clone/assets/ and the <img src>
  // points at it. A regression that drops or disables the sweep fails here.
  it('triggers the IntersectionObserver lazy image and localizes it under clone/assets/', () => {
    // The <img src> now resolves to a localized assets/ path (not the load-time empty/data-src).
    const match = /<img[^>]*\bsrc="(assets\/[^"]*lazy[^"]*\.png)"/i.exec(indexHtml);
    expect(match, `lazy <img> src not localized under assets/:\n${indexHtml}`).not.toBeNull();
    // The referenced file must actually exist on disk under clone/.
    expect(fs.existsSync(path.join(projectDir, 'clone', match![1]))).toBe(true);
  });
});

/**
 * T15 — consent/cookie-banner blocking.
 *
 * WHY: a banner is the most common thing standing between a reference site and a usable design
 * clone, and its survival is invisible to every other assertion — a clone with a fixed-position
 * consent bar still exits 0 and still validates. Each removal test below is paired with a case that
 * makes the banner SURVIVE, so a passing test attributes the removal to the mechanism under test
 * rather than to some other stage (or to the banner never rendering at all):
 *   • `--no-block-cookies`                       → survives  (fixture sanity + kill switch)
 *   • default clone                              → removed   (built-in generic rules, ADR-012 / A16)
 *   • `--remove-selector` (+ blocking disabled)  → removed   (the flag alone did it)
 *   • `--filter-list <fixture>`                  → removed   (its `###cookie-banner` cosmetic rule)
 *   • `--filter-list <matches nothing>`          → survives  (the flag REPLACED the built-ins)
 *
 * Removal, not hiding, is the contract: the adblocker's native behaviour is to inject a
 * `display: none !important` stylesheet, which would leave the banner in `clone/index.html`.
 */
describe('clone banner (consent blocking)', () => {
  let server: StaticServer;
  const outs: string[] = [];

  /** Clone the banner fixture with `flags` and return the written `clone/index.html`. */
  async function cloneBanner(flags: string[], project: string): Promise<string> {
    const out = tmpOut();
    outs.push(out);
    const result = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', project, ...flags],
      out,
    );
    expect(result.code, `clone failed: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { projectDir: string };
    return fs.readFileSync(path.join(parsed.projectDir, 'clone', 'index.html'), 'utf8');
  }

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'banner'));
  });

  afterAll(async () => {
    await server.close();
    for (const out of outs) fs.rmSync(out, { recursive: true, force: true });
  });

  it('keeps the banner when --no-block-cookies disables the stage', async () => {
    // Anchors every other case: the fixture really does render a banner, and the kill switch really
    // does turn the stage off rather than being an ignored flag.
    const indexHtml = await cloneBanner(['--no-block-cookies'], 'banner-off');
    expect(indexHtml).toMatch(/id="cookie-banner"/);
    expect(indexHtml).toMatch(/We use cookies/);
  });

  it('removes the banner on a DEFAULT clone via the built-in generic rules', async () => {
    // The own-suite mirror of sealed A16. The seeded remote list matches nothing, so this passes
    // only because `consent-rules.ts` carries a generic `##.cookie-banner` / `###cookie-banner`
    // rule (ADR-012) — fanboy-cookiemonster scopes those per-domain and would leave the banner.
    const indexHtml = await cloneBanner([], 'banner-default');
    expect(indexHtml).not.toMatch(/id="cookie-banner"/);
    expect(indexHtml).not.toMatch(/We use cookies/);
    // Nothing else may be swept up with it.
    expect(indexHtml).toMatch(/id="pricing"/);
    expect(indexHtml).toMatch(/id="features"/);
  });

  it('removes the banner via --remove-selector', async () => {
    const indexHtml = await cloneBanner(['--remove-selector', '#cookie-banner'], 'banner-selector');
    expect(indexHtml).not.toMatch(/id="cookie-banner"/);
    // The rest of the page must survive: --remove-selector removes a subtree, not the document.
    expect(indexHtml).toMatch(/id="pricing"/);
  });

  it('removes the banner via --remove-selector even with consent blocking off', async () => {
    // Isolates the flag: with `--no-block-cookies` the built-in rules cannot be what removed it.
    const indexHtml = await cloneBanner(
      ['--no-block-cookies', '--remove-selector', '#cookie-banner'],
      'banner-selector-only',
    );
    expect(indexHtml).not.toMatch(/id="cookie-banner"/);
    expect(indexHtml).toMatch(/id="pricing"/);
  });

  it('removes the banner via a --filter-list cosmetic rule, without injecting a hide stylesheet', async () => {
    // `###cookie-banner` is a cosmetic rule. The engine would HIDE the element; the clone must not
    // contain it at all, nor the `display: none !important` blob the engine wanted to inject.
    const listPath = path.join(SITES, 'banner', 'filter-list.txt');
    const indexHtml = await cloneBanner(['--filter-list', listPath], 'banner-filter-list');
    expect(indexHtml).not.toMatch(/id="cookie-banner"/);
    expect(indexHtml).not.toMatch(/We use cookies/);
    expect(indexHtml).not.toMatch(/display:\s*none\s*!important/i);
    expect(indexHtml).toMatch(/id="pricing"/);
  });

  it('keeps the banner when --filter-list supplies a list that matches nothing', async () => {
    // Proves `--filter-list` REPLACES the built-in rules instead of adding to them. Without this,
    // the test above would pass even if the flag were ignored entirely (the built-ins would remove
    // the banner anyway) — and a user who passed an explicit list would get surprise removals.
    const out = tmpOut();
    outs.push(out);
    const listPath = path.join(out, 'matches-nothing.txt');
    fs.writeFileSync(listPath, '! no rule here matches the fixture\n###nothing-at-all\n', 'utf8');

    const indexHtml = await cloneBanner(['--filter-list', listPath], 'banner-inert-list');
    expect(indexHtml).toMatch(/id="cookie-banner"/);
  });
});

describe('clone unreachable URL', () => {
  it('exits 1 and writes no clone when navigation fails', async () => {
    // Bind then release a port so it is guaranteed free (connection refused, not a hang).
    const throwaway = await startStaticServer(path.join(SITES, 'basic'));
    const deadUrl = throwaway.url('/index.html');
    await throwaway.close();

    const out = tmpOut();
    const result = await runCli(['clone', deadUrl, '--out', out, '--project', 'dead', '--timeout', '20'], out);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/error:/);
    expect(fs.existsSync(path.join(out, 'dead'))).toBe(false);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
