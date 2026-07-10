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
    expect(indexHtml.split('\n')[0]).toContain('Cloned by design-lens v0.1.1');
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

  // why (T27, spec 10 §Layer 1): the license notice promises "font files and their source hosts are
  // listed above", and commercial-font licence checks depend on it. The basic fixture localizes
  // `fonts/brand.woff2` from the capture origin, so the real pipeline — not just the pure builder —
  // must surface that file AND its host under `## Capture results`. A regression that drops the font
  // list leaves the notice pointing at nothing while every other REPORT assertion still passes.
  it('lists each localized font file with its origin host under ## Capture results', () => {
    const report = fs.readFileSync(path.join(projectDir, 'REPORT.md'), 'utf8');
    expect(report).toContain('## Capture results');
    const captureSection = report.slice(
      report.indexOf('## Capture results'),
      report.indexOf('## Left remote'),
    );
    // The host is the live fixture origin (127.0.0.1:<ephemeral port>) — REPORT.md sits OUTSIDE
    // `clone/`, which is the only tree sealed assertion A4 forbids the capture host from.
    const originHost = new URL(server.origin).host; // `127.0.0.1:<ephemeral port>`
    const fontLine = new RegExp(
      `- clone/assets/\\S+brand\\S*\\.woff2 — from ${originHost.replace(/\./g, '\\.')}$`,
      'm',
    );
    expect(captureSection, `no font line in:\n${captureSection}`).toMatch(fontLine);
  });

  // why (T27, spec 10 §Layer 1): `robotsDisallowed` must be present on EVERY clone — a missing key is
  // indistinguishable from `false` to a naive reader, so the "record and proceed" stance would become
  // "silently omit". The fixture server serves no robots.txt, which is exactly the fetch-failure path
  // the spec says must record `false` without warning fatally, not abort the clone.
  it('records source.robotsDisallowed even when the origin serves no robots.txt', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
      source: { robotsDisallowed: boolean };
    };
    expect(manifest.source).toHaveProperty('robotsDisallowed');
    expect(manifest.source.robotsDisallowed).toBe(false);
    const report = fs.readFileSync(path.join(projectDir, 'REPORT.md'), 'utf8');
    expect(report.slice(report.indexOf('## Source'), report.indexOf('## Capture results'))).toContain(
      'robots.txt:',
    );
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
  let cloneStderr: string;

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
    cloneStderr = result.stderr;
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

  // why (T27, spec 10 §Layer 1): "Nothing in the clone may have untraceable origin." The spa fixture
  // references `img/absent.png`, which the server does not have — the one reference that CANNOT be
  // localized. It must therefore surface in `manifest.remote[]` with a reason and the element that
  // referenced it. Without this, a broken reference would vanish from the provenance record entirely:
  // absent from `resources[]` (never fetched) and absent from `remote[]` (never recorded), leaving
  // the clone pointing at the live web with nothing in the manifest saying so. The other manifest
  // assertions all cover resources that DID localize, so only this test exercises `remote[]` at all.
  it('records the un-localizable reference in manifest.remote[] with a reason and referrer', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
      remote: { url: string; reason: string; referencedBy: string }[];
      resources: { originalUrl: string }[];
    };
    const entry = manifest.remote.find((r) => r.url.endsWith('/img/absent.png'));
    expect(entry, `absent.png missing from manifest.remote[]: ${JSON.stringify(manifest.remote)}`).toBeDefined();
    expect(entry!.reason).toBe('fetch-failed');
    // `referencedBy` names the element that pointed at it, so a user can find it in the clone.
    expect(entry!.referencedBy).toMatch(/^dl-\d+$/);
    // It is remote precisely BECAUSE it never localized — it must not also claim to be a resource.
    expect(manifest.resources.some((r) => r.originalUrl.endsWith('/img/absent.png'))).toBe(false);
  });

  // why (T27, spec 10 §Layer 1 + §Interfaces): the completion one-liner is the last thing a human
  // sees, must be verbatim, and must go to stderr — stdout carries only the machine JSON that agents
  // parse. A stray `console.log` of this notice would corrupt every `JSON.parse(result.stdout)` in
  // this suite; asserting stdout stays parseable is what pins the I/O contract, not just the wording.
  it('prints the verbatim ethics notice to stderr as the last line of a clone', () => {
    const NOTICE =
      'Note: this clone is for private design study only — see REPORT.md "License & usage notice" before shipping anything derived.';
    expect(cloneStderr).toContain(NOTICE);
    const lines = cloneStderr.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe(NOTICE);
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

/**
 * Materialize `test/fixtures/sites/xorigin` into a temp dir with `__CDN_ORIGIN__` replaced by the
 * live CDN origin. The CDN runs on an ephemeral port, so its origin cannot be committed into the
 * fixture's CSS — but the fixture must still be readable/greppable on disk, so it holds a placeholder
 * rather than being generated from a string in this file. The site is flat (index.html + style.css).
 */
function materializeXorigin(cdnOrigin: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-xorigin-'));
  for (const entry of fs.readdirSync(path.join(SITES, 'xorigin'))) {
    const body = fs.readFileSync(path.join(SITES, 'xorigin', entry), 'utf8');
    fs.writeFileSync(path.join(dir, entry), body.split('__CDN_ORIGIN__').join(cdnOrigin), 'utf8');
  }
  return dir;
}

/**
 * T16 — cross-origin webfonts, and the `network` / `css-fetch` split that proves the pipeline knows
 * WHY it has each font's bytes. Own-suite analogue of sealed assertion A15 (alt-port CDN mirror).
 *
 * WHY this exists: browsers load fonts lazily. `webfont.css` (served cross-origin) declares two
 * faces; the page renders text in "CDN Sans" only. Chromium therefore requests cdn-sans.woff2 during
 * render and NEVER requests cdn-serif.woff2 — that URL exists solely inside stylesheet text, on a
 * different origin, reachable only by parsing the CSS and going back for the bytes with the browser
 * context's request client. Before T16 the serif face stayed a live `http://127.0.0.1:<cdn>/…` URL
 * inside the clone's CSS: a font that 404s the moment the clone moves machines, and a `via: css-fetch`
 * the manifest schema allowed but nothing ever emitted. Delete these and that regression is invisible.
 */
describe('clone xorigin (cross-origin webfont, css-fetch)', () => {
  interface ManifestResource {
    localPath: string;
    originalUrl: string;
    contentType: string;
    via: string;
  }

  let cdn: StaticServer;
  let page: StaticServer;
  let siteDir: string;
  let out: string;
  let projectDir: string;
  let resources: ManifestResource[];

  beforeAll(async () => {
    // The CDN must be up first: its origin is baked into the page's stylesheet.
    cdn = await startStaticServer(path.join(SITES, 'cdn'));
    siteDir = materializeXorigin(cdn.origin);
    page = await startStaticServer(siteDir);

    out = tmpOut();
    const result = await runCli(
      ['clone', page.url('/index.html'), '--out', out, '--project', 'xorigin'],
      out,
    );
    expect(result.code, `clone failed: ${result.stderr}`).toBe(0);
    projectDir = (JSON.parse(result.stdout.trim()) as { projectDir: string }).projectDir;
    resources = (
      JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
        resources: ManifestResource[];
      }
    ).resources;
  });

  afterAll(async () => {
    await page.close();
    await cdn.close();
    fs.rmSync(siteDir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why (T16 AC): the unused face is the one no browser ever asks for. It must still land under
  // clone/assets/ with its provenance told truthfully — `css-fetch`, not `network` (we did not
  // capture it) and not `refetch` (no DOM reference named it).
  it('localizes the unused cross-origin @font-face as via: css-fetch', () => {
    const serif = resources.find((r) => r.originalUrl === `${cdn.origin}/fonts/cdn-serif.woff2`);
    expect(serif, `cdn-serif.woff2 missing from manifest:\n${JSON.stringify(resources, null, 2)}`)
      .toBeDefined();
    expect(serif!.via).toBe('css-fetch');
    expect(serif!.localPath.startsWith('clone/assets/')).toBe(true);
    expect(fs.existsSync(path.join(projectDir, serif!.localPath))).toBe(true);
    expect(fs.statSync(path.join(projectDir, serif!.localPath)).size).toBeGreaterThan(0);
  });

  // why: the split is the claim. If css-fetch silently swallowed the rendered face too (e.g. the
  // collector ran before `drainResponses`, or fetchMissing stopped honouring the store), this catches
  // it — and it re-proves the ADR-011 cross-origin capture path (--disable-web-security + bypassCSP)
  // that sealed A15 depends on: a CORS-unheadered CDN font DOES load at render.
  it('still captures the USED cross-origin face at render, as via: network', () => {
    const sans = resources.find((r) => r.originalUrl === `${cdn.origin}/fonts/cdn-sans.woff2`);
    expect(sans, `cdn-sans.woff2 missing from manifest:\n${JSON.stringify(resources, null, 2)}`)
      .toBeDefined();
    expect(sans!.via).toBe('network');
    expect(fs.existsSync(path.join(projectDir, sans!.localPath))).toBe(true);
  });

  // why: the cross-origin @import chain must be followed and rewritten. The CDN stylesheet lands in
  // its OWN assets/<host>/ directory (a different host slug than the page's), and both faces are
  // rewritten to paths relative to THAT directory — not the page root. A base-URL bug here yields
  // `assets/<page-host>/fonts/…`, a path with no file behind it.
  it('localizes the cross-origin @import and rewrites both font src to relative paths', () => {
    const webfontCss = resources.find((r) => r.originalUrl === `${cdn.origin}/webfont.css`);
    expect(webfontCss, 'the cross-origin @import target was not localized').toBeDefined();

    const css = fs.readFileSync(path.join(projectDir, webfontCss!.localPath), 'utf8');
    expect(css).toMatch(/url\(fonts\/cdn-sans\.woff2\)/);
    expect(css).toMatch(/url\(fonts\/cdn-serif\.woff2\)/);

    // The page sheet's @import now points into the CDN's asset directory, not at the live CDN.
    const pageCss = resources.find((r) => r.originalUrl === `${page.origin}/style.css`);
    expect(pageCss, 'the page stylesheet was not localized').toBeDefined();
    expect(fs.readFileSync(path.join(projectDir, pageCss!.localPath), 'utf8')).toMatch(
      /@import url\((?!http)[^)]*webfont\.css\)/,
    );
  });

  // why: the point of localizing at all. Sealed A4 forbids the capture host anywhere inside clone/;
  // a css-fetch that wrote bytes but never rewrote the reference would still leave a live URL behind.
  it('leaves no reference to either live origin inside clone/', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // Only text files: a woff2's bytes could coincidentally spell the host substring.
        else if (/\.(?:html|css)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('127.0.0.1')) {
          offenders.push(full);
        }
      }
    };
    walk(path.join(projectDir, 'clone'));
    expect(offenders).toEqual([]);
  });

  // why: `stats.fonts` feeds the REPORT "Capture results" font row, whose byte counts back the
  // license notice's "font files and their source hosts are listed above" (spec 03). A font that
  // localizes but is not counted makes that notice a lie.
  it('counts both faces in manifest stats.fonts', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as {
      stats: { fonts: number };
    };
    expect(manifest.stats.fonts).toBe(2);
  });
});

/** Shape of the bits of `manifest.json` the T30 policy tests read. */
interface PolicyManifest {
  remote: { url: string; reason: string; referencedBy: string }[];
  resources: { localPath: string; originalUrl: string; via: string; bytes: number }[];
}

/** Read and parse a clone's `manifest.json`. */
function readManifest(projectDir: string): PolicyManifest {
  return JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')) as PolicyManifest;
}

/**
 * T30 — `--max-asset-mb`, the size gate.
 *
 * WHY: this flag is the only thing standing between a design clone and a mirror of every byte a
 * reference site serves. Its failure mode is silent — a clone that ignores the limit is still valid,
 * still inert, still passes every sealed assertion, just gigabytes large. `0.001` MiB (1048 bytes)
 * is chosen so the `basic` fixture straddles it: `hero.png` (990 B) localizes, `hero@2x.png`
 * (3014 B) does not. That pairing is what proves the gate is a per-body decision rather than a
 * blanket switch that stopped localizing anything.
 */
describe('clone basic --max-asset-mb (oversize policy)', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;
  let indexHtml: string;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    // 0.001 MiB = 1048.576 bytes — between hero.png (990 B) and hero@2x.png (3014 B).
    const result = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'basic-oversize', '--max-asset-mb', '0.001'],
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

  // why: an oversize body must be RECORDED, not merely dropped. A dropped reference leaves the clone
  // pointing at the live web with nothing in the manifest saying so — exactly the untraceable origin
  // spec 10 forbids. The `referencedBy` pin means a user can find the element that wanted it.
  it('leaves the oversize srcset variant remote with reason oversize', () => {
    const manifest = readManifest(projectDir);
    const entry = manifest.remote.find((r) => r.url.endsWith('/img/hero@2x.png'));

    expect(entry, `hero@2x.png missing from remote[]: ${JSON.stringify(manifest.remote)}`).toBeDefined();
    expect(entry!.reason).toBe('oversize');
    expect(entry!.referencedBy).toMatch(/^dl-\d+$/);
    // Remote precisely BECAUSE it did not localize: it must not also claim to be a resource on disk.
    expect(manifest.resources.some((r) => r.originalUrl.endsWith('/img/hero@2x.png'))).toBe(false);
  });

  // why: this is the discriminator. If the gate regressed into "localize nothing", the assertion
  // above would still pass. The 990-byte 1x variant sits just under the same limit that rejected the
  // 3014-byte 2x variant, so only a genuine per-body comparison satisfies both halves — and the
  // srcset attribute must carry one rewritten candidate beside one left exactly as authored.
  it('still localizes the same-srcset variant that fits under the limit', () => {
    const manifest = readManifest(projectDir);
    const kept = manifest.resources.find((r) => r.originalUrl.endsWith('/img/hero.png'));

    expect(kept, `hero.png should have localized: ${JSON.stringify(manifest.resources)}`).toBeDefined();
    expect(kept!.bytes).toBe(990);
    expect(fs.existsSync(path.join(projectDir, kept!.localPath))).toBe(true);

    const match = /<img[^>]*\bsrcset="([^"]+)"/i.exec(indexHtml);
    expect(match, `no srcset survived in the clone:\n${indexHtml}`).not.toBeNull();
    // 1x rewritten to a local path; 2x left byte-identical to how the fixture authored it.
    expect(match![1]).toMatch(/^assets\/\S+ 1x, img\/hero@2x\.png 2x$/);
  });

  // why: `remote[]` reasons are per-resource, not per-clone. This run produces BOTH `oversize` (the
  // 2x hero) and `fetch-failed` (the favicon Chromium never requests headless). A regression that
  // stamps one reason across every remote entry — easy to write, since they share a recorder — would
  // pass every single-reason assertion in this suite.
  it('records each remote reason independently, and renders them under ## Left remote', () => {
    const manifest = readManifest(projectDir);
    const reasons = new Set(manifest.remote.map((r) => r.reason));
    expect(reasons).toContain('oversize');
    expect(reasons).toContain('fetch-failed');

    const report = fs.readFileSync(path.join(projectDir, 'REPORT.md'), 'utf8');
    const leftRemote = report.split('## Left remote')[1]!.split('\n## ')[0]!;
    for (const entry of manifest.remote) {
      expect(leftRemote).toContain(`${entry.url} — ${entry.reason}`);
    }
  });

  // why: an oversize STYLESHEET prunes everything discovered by parsing it. `style.css` (1474 B) is
  // over the limit here, so its `@import`ed `second.css` and its `@font-face` woff2 are never even
  // seen. They must be absent from BOTH lists — a phantom `remote[]` entry for a URL we never looked
  // at would be a manifest claiming knowledge the run does not have.
  it('prunes the reference subtree under an oversize stylesheet without inventing entries', () => {
    const manifest = readManifest(projectDir);
    const urls = [
      ...manifest.remote.map((r) => r.url),
      ...manifest.resources.map((r) => r.originalUrl),
    ];
    expect(urls.some((u) => u.endsWith('/second.css'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/brand.woff2'))).toBe(false);
    // The parent itself IS recorded — we looked at it and rejected it.
    expect(manifest.remote.find((r) => r.url.endsWith('/style.css'))?.reason).toBe('oversize');
  });
});

/**
 * T30 — bulk media (`--include-media`), against the dedicated `media` fixture.
 *
 * WHY: a design clone wants the poster frame, not the 40 MB video behind it, so `mp4/webm/mp3/pdf/
 * zip` stay remote by default (spec 02 §6). Both branches are asserted from the SAME fixture, which
 * is what makes each one attributable to the flag rather than to the media never loading at all:
 *   • default          → mp4 + mp3 in `remote[]` as `media-skipped`, nothing on disk
 *   • `--include-media` → both localized under `clone/assets/`, `remote[]` empty
 * The fixture's `<video>` carries a `poster` beside its skipped `src`; asserting the poster survives
 * is what separates "skip the media reference" from "skip the media element".
 */
describe('clone media (bulk media policy)', () => {
  let server: StaticServer;
  let out: string;
  let defaultDir: string;
  let includedDir: string;
  let defaultHtml: string;
  let includedHtml: string;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'media'));
    out = tmpOut();
    const cloneMedia = async (args: string[], project: string): Promise<string> => {
      const result = await runCli(
        ['clone', server.url('/index.html'), '--out', out, '--project', project, ...args],
        out,
      );
      expect(result.code, `clone ${project} failed: ${result.stderr}`).toBe(0);
      return (JSON.parse(result.stdout.trim()) as { projectDir: string }).projectDir;
    };
    defaultDir = await cloneMedia([], 'media-default');
    includedDir = await cloneMedia(['--include-media'], 'media-included');
    defaultHtml = fs.readFileSync(path.join(defaultDir, 'clone', 'index.html'), 'utf8');
    includedHtml = fs.readFileSync(path.join(includedDir, 'clone', 'index.html'), 'utf8');
  }, 120_000);

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: the default. Chromium DOES fetch these bodies (`preload="auto"`), so they sit in the
  // ResourceStore — meaning the skip is a deliberate policy decision, not an accident of what the
  // render happened to request. Their references must survive byte-identical, and no media byte may
  // reach the clone tree.
  it('leaves mp4 and mp3 remote with reason media-skipped by default', () => {
    const manifest = readManifest(defaultDir);

    for (const file of ['/media/promo.mp4', '/media/tone.mp3']) {
      const entry = manifest.remote.find((r) => r.url.endsWith(file));
      expect(entry, `${file} missing from remote[]: ${JSON.stringify(manifest.remote)}`).toBeDefined();
      expect(entry!.reason).toBe('media-skipped');
      expect(entry!.referencedBy).toMatch(/^dl-\d+$/);
      expect(manifest.resources.some((r) => r.originalUrl.endsWith(file))).toBe(false);
    }

    // References left exactly as authored, and nothing media-shaped written under clone/assets/.
    expect(defaultHtml).toContain('src="media/promo.mp4"');
    expect(defaultHtml).toContain('src="media/tone.mp3"');
    const written = fs.readdirSync(path.join(defaultDir, 'clone', 'assets'), { recursive: true }) as string[];
    expect(written.filter((f) => /\.(?:mp4|mp3)$/.test(f))).toEqual([]);
  });

  // why (THE DISCRIMINATOR): the poster frame lives on the very `<video>` whose `src` is skipped. An
  // implementation that skips the media ELEMENT rather than the media REFERENCE passes the assertion
  // above and silently throws away the one image on that element a designer actually needs. Nothing
  // else in the suite would catch it.
  it('still localizes the poster frame on the skipped <video>', () => {
    const manifest = readManifest(defaultDir);
    const poster = manifest.resources.find((r) => r.originalUrl.endsWith('/img/poster.png'));

    expect(poster, `poster.png should have localized: ${JSON.stringify(manifest.resources)}`).toBeDefined();
    expect(fs.existsSync(path.join(defaultDir, poster!.localPath))).toBe(true);
    expect(defaultHtml).toMatch(/<video[^>]*\bposter="assets\/[^"]+\/img\/poster\.png"/);
    // …and the sibling <img> is untouched by the media policy.
    expect(manifest.resources.some((r) => r.originalUrl.endsWith('/img/still.png'))).toBe(true);
  });

  // why: `--include-media` has to actually turn the policy off — same URL mapping, verbatim bodies,
  // an empty `remote[]`. Byte counts are compared against the fixture files on disk so a truncated
  // or re-encoded media body (a real risk: Chromium may serve media from a partial Range response)
  // fails loudly instead of shipping a corrupt asset.
  it('localizes mp4 and mp3 under --include-media', () => {
    const manifest = readManifest(includedDir);
    expect(manifest.remote).toEqual([]);

    for (const [file, fixture] of [
      ['/media/promo.mp4', 'media/promo.mp4'],
      ['/media/tone.mp3', 'media/tone.mp3'],
    ]) {
      const entry = manifest.resources.find((r) => r.originalUrl.endsWith(file!));
      expect(entry, `${file} missing from resources[]: ${JSON.stringify(manifest.resources)}`).toBeDefined();
      expect(entry!.via).toBe('network');

      const written = path.join(includedDir, entry!.localPath);
      expect(fs.existsSync(written)).toBe(true);
      // Byte-for-byte identical to what the fixture server served.
      const source = fs.readFileSync(path.join(SITES, 'media', fixture!));
      expect(entry!.bytes).toBe(source.byteLength);
      expect(fs.readFileSync(written).equals(source)).toBe(true);
    }

    expect(includedHtml).toMatch(/<video[^>]*\bsrc="assets\/[^"]+\/media\/promo\.mp4"/);
    expect(includedHtml).toMatch(/<audio[^>]*\bsrc="assets\/[^"]+\/media\/tone\.mp3"/);
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
