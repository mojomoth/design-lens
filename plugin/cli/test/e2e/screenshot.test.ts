/**
 * T20 e2e: the PNG evidence trail — the three screenshots every clone must emit, and the standalone
 * `screenshot` command over both of its targets (a clone on disk, and a live URL).
 *
 * WHY this exists: screenshots are the ONLY evidence the reverse-design skill has for anything a
 * DOM dump cannot express — hierarchy, rhythm, colour in context (spec 04 §Evidence). A regression
 * that emitted zero-byte or truncated PNGs would pass every "does the file exist" check and quietly
 * blind the whole analysis flow, so each assertion checks the `\x89PNG` signature AND a >1KB body.
 * `clone-full.png` additionally proves fidelity: it is the WRITTEN clone re-rendered from disk, so
 * if the localize pass broke an asset path, this file is the one that would come back mostly blank.
 * Removing these tests would let a clone ship with no usable visual record.
 *
 * Tests only ever touch 127.0.0.1 fixtures on ephemeral ports (never 4630/4631, never the live web):
 * the "live URL" case points `--url` at the same loopback fixture server.
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

/** The eight-byte PNG signature every valid PNG starts with (spec/AC: `\x89PNG`). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A screenshot of a rendered page is always kilobytes; anything smaller is a blank or a stub. */
const MIN_PNG_BYTES = 1024;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** See clone.test.ts: consent blocking is on by default, so every run gets a seeded throwaway home. */
const SEEDED_DEFAULT_LIST = [
  '! design-lens e2e: stands in for the downloaded fanboy-cookiemonster list.',
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

/** Run the bundle with `args`; resolve with the exit code and captured streams (never rejects). */
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

/** Assert `file` is a real, non-trivial PNG: correct magic bytes and more than a kilobyte of pixels. */
function expectRealPng(file: string): void {
  expect(fs.existsSync(file), `missing PNG: ${file}`).toBe(true);
  const bytes = fs.readFileSync(file);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `not a PNG: ${file}`).toBe(true);
  expect(bytes.byteLength, `PNG too small to be a render: ${file}`).toBeGreaterThan(MIN_PNG_BYTES);
}

describe('screenshot (T20)', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-e2e-'));
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

  // why: spec 03 §Directory tree — "All three MUST exist after a successful clone". These are the
  // reverse-design skill's first three reads (spec 04 §1); without them it has nothing to look at.
  it('a clone auto-emits the three PNGs under screenshots/', () => {
    for (const name of ['original-viewport.png', 'original-full.png', 'clone-full.png']) {
      expectRealPng(path.join(projectDir, 'screenshots', name));
    }
  });

  // why: the fidelity check. `clone-full.png` renders the WRITTEN clone, `original-full.png` renders
  // the live page — both full-page shots of the same content at the same viewport. If localization
  // broke the stylesheet, the clone would collapse to unstyled text and shrink dramatically. A loose
  // ratio bound catches that class of breakage without asserting pixel equality (fonts/AA differ).
  it('clone-full.png is a plausible re-render of original-full.png (not a blank page)', () => {
    const original = fs.statSync(path.join(projectDir, 'screenshots', 'original-full.png')).size;
    const cloned = fs.statSync(path.join(projectDir, 'screenshots', 'clone-full.png')).size;
    expect(cloned).toBeGreaterThan(original * 0.25);
  });

  // why: THE mobile-evidence flow from spec 04 §5, verbatim (`--width 390 --height 844 --out f.png`).
  // The skills invoke exactly this; if the flag parsing or the live-URL path regressed, the optional
  // mobile view in every design analysis would silently fail.
  it('screenshot --url --width 390 --height 844 --out writes a real PNG', async () => {
    const file = path.join(out, 'mobile.png');
    const result = await runCli(
      ['screenshot', '--url', server.url('/index.html'), '--width', '390', '--height', '844', '--out', file],
      out,
    );
    expect(result.code, `screenshot failed: ${result.stderr}`).toBe(0);
    expectRealPng(file);
    // Machine JSON on stdout, human progress on stderr (CLI I/O contract, guardrails).
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ out: file });
  });

  // why: spec 06 §before/after — the customize-clone skill screenshots the PROJECT DIR (not a URL)
  // after each edit, comparing against `clone-full.png`. That path serves the clone on an ephemeral
  // port and must keep working independently of the clone pipeline that produced it.
  it('screenshot <projectDir> --full-page renders the clone from disk', async () => {
    const file = path.join(out, 'after-1.png');
    const result = await runCli(['screenshot', projectDir, '--full-page', '--out', file], out);
    expect(result.code, `screenshot failed: ${result.stderr}`).toBe(0);
    expectRealPng(file);
  });

  // why: `--out` is optional. A clone shot must default INTO the project's screenshots/ dir (spec 06
  // keeps before/after evidence beside clone-full.png), not into whatever cwd the agent happened to
  // be in. This is the only test that exercises the defaulted sink end to end.
  it('screenshot <projectDir> without --out defaults into the project screenshots/ dir', async () => {
    const result = await runCli(['screenshot', projectDir], out);
    expect(result.code, `screenshot failed: ${result.stderr}`).toBe(0);
    expectRealPng(path.join(projectDir, 'screenshots', 'screenshot.png'));
  });

  // why: the flag guard in `resolveTarget` must hold in the SHIPPED bundle, not just in unit tests —
  // this is the boundary that stops `--url file:///…` from painting a user's disk into a PNG. It also
  // proves a bad invocation exits 1 with a message on stderr rather than launching Chromium.
  it('rejects a non-http(s) --url with exit 1 and no browser launch', async () => {
    const result = await runCli(['screenshot', '--url', 'file:///etc/passwd', '--out', path.join(out, 'x.png')], out);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/expected an http\(s\) URL/);
    expect(fs.existsSync(path.join(out, 'x.png'))).toBe(false);
  });
});
