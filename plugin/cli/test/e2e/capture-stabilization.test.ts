/**
 * Capture stabilization through the BUILT bundle: lazy promotion, media stills, SMIL pause, timer
 * freeze, late stamping, state attempts and their disclosures.
 *
 * WHY this exists: real captures (labs.chaingpt.org) never completed — native lazy images in
 * clipped horizontal tracks and display:none menus never load, a played video with a poster kept
 * its live sources as remote references, and every capture ended `complete:false`, so fidelity was
 * `unverified` and repair never ran. The `stabilization` fixture reproduces those pages offline.
 * These tests pin both the repaired default (complete with disclosures, fidelity pass) and the old
 * behavior under the legacy flags, so neither a regression nor a silent weakening goes unnoticed.
 * The in-page functions run from the minified bundle here, which in-process tests cannot prove.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const SITE = fileURLToPath(new URL('../fixtures/sites/stabilization', import.meta.url));

interface CliResult { code: number; stdout: string; stderr: string }

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], {
      cwd, env: { ...process.env, DESIGN_LENS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dl-home-')) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

interface Disclosure { code: string; detail: string; dlIds?: string[] }
interface Substitution { kind: string; referencedBy: string; captureId?: string; urls: string[]; stillFrom: string; currentTime?: number; lost: string[] }
interface Capture {
  id: string;
  complete: boolean;
  warnings: string[];
  observations: { complete: boolean; warnings: string[]; elements: Array<{ dlId: string; tag: string; visible: boolean; src?: string | null }> };
  stabilization: {
    policy: { media: string; lazyImages: string; freezeTimers: boolean; readiness: { timeoutMs: number; retries: number }; captureAttempts: number };
    readiness: Array<{ attempt: number; images: { pendingVisible: string[]; pendingHidden: string[] } }>;
    stateAttempts: Array<{ attempt: number; consistent: boolean; changed?: string }>;
    frozen: { timers: { frozen: boolean; suppressed: number }; smil: number };
    substitutions: Substitution[];
    disclosures: Disclosure[];
  };
}
interface Fidelity {
  status: string;
  captures: Array<{ captureId: string; status: string; issues: string[]; disclosures?: string[]; motionUnverified?: string[];
    elements: Array<{ sourceId: string; status: string; image?: { status: string } }> }>;
}
interface Project {
  dir: string;
  html: string;
  report: string;
  captures: Capture[];
  manifest: { remote: Array<{ url: string; reason: string }>; substituted?: Substitution[] };
  fidelity: Fidelity;
}

describe('capture stabilization (stabilization fixture)', () => {
  let server: StaticServer;
  let out: string;
  let counter = 0;

  async function clone(page: string, args: string[]): Promise<Project> {
    counter += 1;
    const result = await runCli(['clone', server.url(`/${page}`), '--out', out, '--project', `case-${counter}`,
      ...(args.includes('--viewports') ? [] : ['--viewport', '800x600']), '--settle', '300', '--no-block-cookies', ...args], out);
    expect(result.code, `clone failed: ${result.stderr}`).toBe(0);
    const dir = (JSON.parse(result.stdout.trim()) as { projectDir: string }).projectDir;
    const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8');
    return {
      dir, html: read('clone/index.html'), report: read('REPORT.md'),
      captures: (JSON.parse(read('evidence.json')) as { captures: Capture[] }).captures,
      manifest: JSON.parse(read('manifest.json')) as Project['manifest'],
      fidelity: JSON.parse(read('fidelity.json')) as Fidelity,
    };
  }

  const codes = (capture: Capture): string[] => capture.stabilization.disclosures.map((entry) => entry.code);

  beforeAll(async () => {
    server = await startStaticServer(SITE);
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-stabilization-'));
  });
  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: THE motivating failure. Clipped carousel slides and display:none menu icons with
  // loading=lazy, plus a played video with a poster, must now yield complete evidence whose
  // deviations are disclosed (not warned), a still frame in place of the live video sources, and a
  // fidelity verdict that is actually measured. Remove this and captures can silently fall back to
  // permanently `complete:false`.
  it('completes the lazy-carousel, hidden-menu, played-video page with disclosures and a measured pass', async () => {
    const project = await clone('index.html', []);
    const [capture] = project.captures;
    expect(capture.warnings).toEqual([]);
    expect(capture.complete).toBe(true);
    expect(capture.observations.complete, capture.observations.warnings.join('\n')).toBe(true);
    expect(capture.stabilization.policy).toEqual({
      media: 'poster', lazyImages: 'eager', freezeTimers: false, readiness: { timeoutMs: 5000, retries: 2 }, captureAttempts: 2,
    });
    const lazy = capture.stabilization.disclosures.find((entry) => entry.code === 'lazy-promoted');
    const imageId = (name: string): string | undefined => capture.observations.elements
      .find((element) => element.tag === 'img' && element.src === `img/${name}.svg`)?.dlId;
    // Menu icons (display:none) and the clipped slides can only load once promoted.
    for (const name of ['menu-1', 'menu-2', 'menu-3', 'slide-4', 'slide-5', 'slide-6']) {
      expect(lazy?.dlIds, name).toContain(imageId(name));
    }
    expect(capture.stabilization.readiness.at(-1)?.images.pendingVisible).toEqual([]);
    expect(codes(capture)).toEqual(expect.arrayContaining(['lazy-promoted', 'media-substituted', 'late-stamped']));

    const [still] = capture.stabilization.substitutions;
    expect(capture.stabilization.substitutions).toHaveLength(1);
    expect(still).toMatchObject({ kind: 'video-frame', stillFrom: 'captured-frame', lost: ['motion'] });
    expect(still.urls).toEqual([server.url('/media/clip.webm')]);
    expect(still.currentTime).toBeGreaterThan(0);
    expect(project.manifest.remote).toEqual([]);
    expect(project.manifest.substituted).toEqual(capture.stabilization.substitutions);

    // The live source survives only as an inert attribute; the painted frame is the poster.
    expect(project.html).toMatch(/<source[^>]*\bdata-dl-original-src="media\/clip\.webm"/);
    expect(project.html).not.toMatch(/\ssrc="media\/clip\.webm"/);
    expect(project.html).toMatch(/<video[^>]*\bposter="data:image\/png;base64,/);
    expect(project.html).toMatch(/<video[^>]*\bdata-dl-original-poster="img\/poster\.png"/);
    // The node inserted after stamping is addressable in the clone.
    expect(project.html).toMatch(/<img[^>]*class="late-pixel"[^>]*data-dl-id="dl-\d+"|<img[^>]*data-dl-id="dl-\d+"[^>]*class="late-pixel"/);
    for (const slide of [1, 2, 3, 4, 5, 6]) {
      expect(fs.readdirSync(path.join(project.dir, 'clone', 'assets'), { recursive: true }).map(String)
        .some((file) => file.endsWith(`slide-${slide}.svg`))).toBe(true);
    }

    expect(project.fidelity.status).toBe('pass');
    const compared = project.fidelity.captures[0];
    expect(compared.issues).toEqual([]);
    expect(compared.motionUnverified).toEqual([still.referencedBy]);
    expect(compared.disclosures?.some((line) => line.startsWith('media-substituted: '))).toBe(true);
    // object-fit: cover is honored by the substituted still, region by region.
    const video = compared.elements.find((element) => element.sourceId === still.referencedBy);
    expect(video?.status).toBe('pass');
    expect(video?.image?.status).toBe('pass');

    const leftRemote = project.report.split('## Left remote\n')[1]!.split('\n## ')[0]!;
    expect(leftRemote).toContain(`- Substituted (not remote): ${server.url('/media/clip.webm')} — video-frame at `);
    expect(project.report).toMatch(/- Disclosed: lazy-promoted: \d+ loading=lazy images or frames were loaded eagerly/);
    expect(project.report).toMatch(/- Disclosed: late-stamped: 1 element inserted after stamping was stamped late \(img×1\)/);
  });

  // why: pins the pre-0.4.0 behavior (and the opt-out flags) on the same page: native lazy
  // loading leaves the clipped slides pending and the video stays a remote reference, so the
  // capture is incomplete. If this ever passes as complete, the fixture no longer reproduces the
  // failure and the test above proves nothing.
  it('stays incomplete under the legacy media and lazy-image policies', async () => {
    const project = await clone('index.html', ['--media', 'remote', '--lazy-images', 'native', '--readiness-ms', '1000', '--readiness-retries', '0']);
    const [capture] = project.captures;
    expect(capture.complete).toBe(false);
    expect(capture.warnings.join('\n')).toMatch(/\d+ image loads exceeded capture readiness budget/);
    expect(capture.warnings).toContain(`remote media-skipped: ${server.url('/media/clip.webm')}`);
    expect(codes(capture)).toContain('hidden-images-unloaded');
    expect(codes(capture)).not.toContain('lazy-promoted');
    expect(project.manifest.substituted).toBeUndefined();
    expect(project.fidelity.status).toBe('unverified');
  });

  // why: negative control for the default policy. Only HIDDEN unloaded images may become a
  // disclosure; a visible image that fails to load must still warn in readiness and in the
  // observations, so lazy promotion and disclosures can never certify missing pixels.
  it('keeps a visible broken image incomplete under the default policy', async () => {
    const project = await clone('broken.html', []);
    const [capture] = project.captures;
    expect(capture.complete).toBe(false);
    expect(capture.warnings).toContain('1 images failed to load');
    const missing = capture.observations.elements.find((element) => element.src === 'img/does-not-exist.svg');
    expect(missing?.visible).toBe(true);
    expect(capture.observations.warnings).toContain(`unready or failed images: ${missing?.dlId}`);
    expect(codes(capture)).not.toContain('hidden-images-unloaded');
    // The hidden menu icon still loads through promotion, so it is neither warned nor disclosed.
    const icon = capture.observations.elements.find((element) => element.src === 'img/menu-1.svg');
    expect(capture.stabilization.disclosures.find((entry) => entry.code === 'lazy-promoted')?.dlIds).toEqual([icon?.dlId]);
    expect(project.fidelity.status).toBe('unverified');
  });

  // why: SMIL motion is invisible to the Web Animations freeze and to the mutation check, so
  // without an explicit pause the source screenshots and the clone re-render show different
  // stills. The pause must be disclosed, never verified as motion, and must not rewind.
  it('pauses SMIL in the source and re-renders the same still in the clone', async () => {
    const project = await clone('smil.html', []);
    const [capture] = project.captures;
    expect(capture.complete, capture.warnings.join('\n')).toBe(true);
    expect(capture.stabilization.frozen.smil).toBe(1);
    const smil = capture.stabilization.disclosures.find((entry) => entry.code === 'smil-paused');
    expect(smil?.dlIds).toHaveLength(1);
    const time = /<svg[^>]*\bdata-dl-smil-time="([\d.]+)"/.exec(project.html)?.[1];
    expect(Number(time)).toBeGreaterThan(0);
    expect(project.fidelity.status).toBe('pass');
    expect(project.fidelity.captures[0].motionUnverified).toEqual(smil?.dlIds);
    expect(project.report).toContain('- Disclosed: smil-paused: 1 SMIL-animated SVG document was paused');
  });

  // why: timers keep running by default, so a ticking page must stay explicitly incomplete — with
  // ONE state warning carrying a diff summary after the bounded attempts, not two vague ones.
  it('keeps a ticking page incomplete by default with one summarized state warning', async () => {
    const project = await clone('timer.html', []);
    const [capture] = project.captures;
    expect(capture.complete).toBe(false);
    const state = capture.warnings.filter((warning) => /source (state|observations) changed/.test(warning));
    expect(state).toHaveLength(1);
    expect(state[0]).toMatch(/inconsistent \(.*text dl-1.*\)$/);
    expect(capture.stabilization.stateAttempts.map((attempt) => attempt.consistent)).toEqual([false, false]);
    expect(capture.stabilization.frozen.timers.frozen).toBe(false);
  });

  // why: `--freeze-timers` is the documented recovery for pages that keep changing. Its wrappers
  // are installed only through the init-script argument, so only a bundle run proves them.
  it('completes the ticking page under --freeze-timers and discloses suppressed callbacks', async () => {
    const project = await clone('timer.html', ['--freeze-timers']);
    const [capture] = project.captures;
    expect(capture.warnings).toEqual([]);
    expect(capture.complete).toBe(true);
    expect(capture.stabilization.frozen.timers.frozen).toBe(true);
    expect(capture.stabilization.frozen.timers.suppressed).toBeGreaterThan(0);
    expect(codes(capture)).toContain('timers-frozen');
    expect(project.fidelity.status).toBe('pass');
  });

  // why: responsive composition renumbers element IDs, so every capture's substitutions must be
  // unioned with their source capture recorded, as remote references already are.
  it('unions substitutions per capture in a composed responsive clone', async () => {
    const project = await clone('index.html', ['--viewports', '800x600,420x700']);
    expect(project.captures.map((capture) => capture.complete)).toEqual([true, true]);
    expect(project.manifest.substituted?.map((entry) => entry.captureId).sort()).toEqual(['viewport-420x700', 'viewport-800x600']);
    expect(project.report).toMatch(/- Disclosed: viewport-420x700: media-substituted: /);
  });

  // why: a paused screenshot recalculates styles with scripts disabled, which rendered <noscript>
  // fallbacks as text that stayed after scripts resumed (the live labs.chaingpt.org recapture):
  // attempt 2 adopted the taller page as "consistent" and fidelity failed by the band height.
  it('keeps noscript fallbacks unrendered across paused screenshots', async () => {
    const project = await clone('noscript.html', []);
    const [capture] = project.captures;
    expect(capture.complete, capture.warnings.join('\n')).toBe(true);
    expect(capture.stabilization.stateAttempts).toEqual([expect.objectContaining({ attempt: 1, consistent: true })]);
    expect(project.html).not.toContain('<noscript');
    expect(project.fidelity.status).toBe('pass');
  });

  // why: the fidelity re-render must use the capture's media policy; under the legacy rule a hidden,
  // substituted, poster-less video always raised "video has no paintable frame or poster" and kept
  // an otherwise complete capture unverified forever.
  it('certifies a page whose hidden video was substituted under the default policy', async () => {
    const project = await clone('hidden-video.html', []);
    const [capture] = project.captures;
    expect(capture.complete, capture.warnings.join('\n')).toBe(true);
    expect(capture.stabilization.substitutions.map((entry) => entry.kind)).toEqual(['media-hidden']);
    expect(project.html).toContain('data-dl-original-src="media/clip.webm"');
    expect(project.fidelity.captures[0].issues).not.toContain('video has no paintable frame or poster');
    expect(project.fidelity.status).toBe('pass');
  });

  // why: a stopped marquee halts at whatever offset its motion reached, which differs between capture and the
  // fidelity re-render, so every marquee page failed fidelity although the marquee was disclosed as stabilized.
  it('certifies a marquee page by comparing everything but the stopped marquee box', async () => {
    const project = await clone('marquee.html', []);
    const [capture] = project.captures;
    expect(capture.complete, capture.warnings.join('\n')).toBe(true);
    const marquee = capture.stabilization.disclosures.find((entry) => entry.code === 'marquee-stopped');
    expect(marquee?.dlIds).toHaveLength(1);
    expect(project.fidelity.captures[0].motionUnverified).toEqual(marquee?.dlIds);
    expect(project.fidelity.captures[0].issues).toEqual([]);
    expect(project.fidelity.status).toBe('pass');
  });

  // why: --remove-selector is recorded as the capture policy; a banner the page re-inserts after the
  // first stamping was late-stamped into the clone while evidence still claimed it was removed.
  it('removes a --remove-selector match that the page re-inserts after stamping', async () => {
    const project = await clone('late-promo.html', ['--remove-selector', '.promo']);
    const [capture] = project.captures;
    expect(project.html).not.toContain('LATE BANNER');
    expect(project.html).not.toContain('EARLY BANNER');
    expect(capture.complete, capture.warnings.join('\n')).toBe(true);
    expect(codes(capture)).not.toContain('late-stamped');
  });

  // why: the new flags are validated with the others, before any browser starts; a conflicting
  // alias must never silently pick one meaning.
  it('rejects conflicting or out-of-range stabilization flags before capturing', async () => {
    for (const args of [
      ['--include-media', '--media', 'poster'],
      ['--media', 'frames'],
      ['--lazy-images', 'never'],
      ['--readiness-ms', '500'],
      ['--readiness-retries', '6'],
      ['--capture-attempts', '0'],
    ]) {
      const result = await runCli(['clone', server.url('/index.html'), '--out', out, '--project', 'invalid', ...args], out);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/^error: /m);
      expect(result.stderr).not.toContain('cloning');
    }
    expect(fs.existsSync(path.join(out, 'invalid'))).toBe(false);
  });
});

describe('capture readiness of a slow in-flow image', () => {
  let server: http.Server;
  let origin = '';
  let out: string;
  let imageRequests = 0;
  beforeAll(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-slow-image-'));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#36c"/></svg>';
    server = http.createServer((request, response) => {
      if (request.url?.startsWith('/hero.svg')) {
        imageRequests += 1;
        // Only the browser's first request stalls; the clone's refetch is answered at once.
        const delay = imageRequests === 1 ? 12_000 : 0;
        const timer = setTimeout(() => { response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(svg); }, delay);
        response.on('close', () => clearTimeout(timer));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      // The image starts loading when the capture stamps the page, i.e. after network idle and the
      // scroll sweep, so only readiness can notice that it is still pending.
      response.end('<!doctype html><html><body><h1 id="title">Slow hero</h1><script>new MutationObserver((records, observer) => { observer.disconnect(); const image = document.createElement("img"); image.alt = ""; image.src = "/hero.svg"; document.body.append(image); }).observe(document.getElementById("title"), { attributes: true });</script></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: a loading <img> without width/height has a 0x0 box by construction; classing it as hidden
  // turned a never-painted hero into complete evidence with only a "hidden image" disclosure.
  it('keeps the capture incomplete while a dimensionless visible image is still loading', async () => {
    const result = await runCli(['clone', `${origin}/`, '--out', out, '--project', 'slow', '--viewport', '800x600', '--settle', '300',
      '--no-block-cookies', '--readiness-ms', '1000', '--readiness-retries', '0'], out);
    expect(result.code, result.stderr).toBe(0);
    const dir = (JSON.parse(result.stdout.trim()) as { projectDir: string }).projectDir;
    const [capture] = (JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8')) as { captures: Capture[] }).captures;
    expect(capture.complete).toBe(false);
    expect(capture.warnings).toContain('1 image loads exceeded capture readiness budget');
    expect(capture.stabilization.readiness[0].images.pendingVisible).toHaveLength(1);
    expect(capture.stabilization.readiness[0].images.pendingHidden).toEqual([]);
    expect(capture.stabilization.disclosures.map((entry) => entry.code)).not.toContain('hidden-images-unloaded');
  });
});
