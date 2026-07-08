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

/** Run the bundle with `args`; resolve with the exit code and captured streams (never rejects). */
function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], { cwd });
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
