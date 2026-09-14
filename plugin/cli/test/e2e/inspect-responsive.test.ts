/**
 * WHY this suite exists: responsive pages retain hidden desktop/mobile DOM simultaneously. The
 * built inspect command must measure the requested viewport and choose what is actually painted,
 * while keeping its original stdout shape. Synthetic probes cannot establish ancestor visibility
 * or CSS media-query behavior, so this suite serves a self-contained temporary clone on loopback.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const LOGO = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="24"%3E%3Crect width="80" height="24" fill="blue"/%3E%3C/svg%3E';

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
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

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; font-family: sans-serif; background: white; }
  header { display: flex; align-items: center; gap: 24px; height: 48px; }
  img { display: block; width: 80px; height: 24px; }
  h1 { font-size: 64px; margin: 16px 0; }
  button { display: block; margin: 8px 0; padding: 12px; }
  .transparent { position: absolute; top: 0; left: 0; opacity: 0; }
  .mobile { display: none; }
  .visibility-parent { visibility: hidden; }
  .restored { visibility: visible; }
  footer { margin-top: 1200px; height: 240px; }
  @media (max-width: 600px) {
    .mobile { display: block; }
    .desktop { display: none; }
    h1 { font-size: 32px; }
  }
</style></head><body>
  <div class="transparent" data-dl-id="dl-1">
    <header data-dl-id="dl-2"><img data-dl-id="dl-3" src='${LOGO}' alt="Transparent logo"></header>
    <h1 data-dl-id="dl-4">Transparent heading</h1>
    <nav data-dl-id="dl-5"><a data-dl-id="dl-6" href="#ghost">Transparent navigation</a></nav>
    <button class="cta" data-dl-id="dl-7">Transparent action</button>
  </div>
  <div class="mobile" data-dl-id="dl-8">
    <header data-dl-id="dl-9">
      <img data-dl-id="dl-10" src='${LOGO}' alt="Mobile logo">
      <nav data-dl-id="dl-11"><a data-dl-id="dl-12" href="#mobile">Mobile navigation</a></nav>
    </header>
    <h1 data-dl-id="dl-13">Mobile heading</h1>
    <button class="cta" data-dl-id="dl-14">Mobile action</button>
  </div>
  <div class="desktop" data-dl-id="dl-15">
    <header data-dl-id="dl-16">
      <img data-dl-id="dl-17" src='${LOGO}' alt="Desktop logo">
      <nav data-dl-id="dl-18"><a data-dl-id="dl-19" href="#desktop">Desktop navigation</a></nav>
    </header>
    <h1 data-dl-id="dl-20">Desktop heading</h1>
    <button class="cta" data-dl-id="dl-21">Desktop action</button>
  </div>
  <div class="visibility-parent" data-dl-id="dl-22">
    <button class="cta" data-dl-id="dl-23">Hidden action</button>
    <button class="cta restored" data-dl-id="dl-24">Restored action</button>
  </div>
  <footer data-dl-id="dl-25">Visible footer below the fold</footer>
</body></html>`;

describe('inspect responsive viewport and visibility', () => {
  let projectDir: string;
  let mobile: InspectDocument;
  let desktop: InspectDocument;
  let defaultDocument: InspectDocument;
  let defaultRaw: CliResult;

  function idsFor(document: InspectDocument, role: string): string[] {
    return document.elements.filter((element) => element.role === role).map((element) => element.dlId);
  }

  beforeAll(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-inspect-responsive-'));
    fs.mkdirSync(path.join(projectDir, 'clone'));
    fs.writeFileSync(path.join(projectDir, 'clone', 'index.html'), HTML, 'utf8');

    const mobileRaw = await runCli(['inspect', projectDir, '--viewport', '390x844'], projectDir);
    expect(mobileRaw.code, mobileRaw.stderr).toBe(0);
    mobile = JSON.parse(mobileRaw.stdout) as InspectDocument;

    const desktopRaw = await runCli(['inspect', projectDir, '--viewport', '1440x900'], projectDir);
    expect(desktopRaw.code, desktopRaw.stderr).toBe(0);
    desktop = JSON.parse(desktopRaw.stdout) as InspectDocument;

    defaultRaw = await runCli(['inspect', projectDir], projectDir);
    expect(defaultRaw.code, defaultRaw.stderr).toBe(0);
    defaultDocument = JSON.parse(defaultRaw.stdout) as InspectDocument;
  });

  afterAll(() => {
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  // why: hidden desktop markup must not occupy a mobile role or consume a single-result slot;
  // font-size also proves the command really applied the media-query viewport before measuring.
  it('selects the mobile logo, heading, navigation and action at 390x844', () => {
    expect(idsFor(mobile, 'logo')).toEqual(['dl-10']);
    expect(idsFor(mobile, 'hero-heading')).toEqual(['dl-13']);
    expect(idsFor(mobile, 'nav-link')).toEqual(['dl-12']);
    expect(idsFor(mobile, 'cta')).toEqual(['dl-14', 'dl-24']);
    expect(mobile.elements.find((element) => element.dlId === 'dl-13')?.styles.fontSize).toBe('32px');
  });

  // why: the mobile elements precede the desktop elements in DOM order; a selector-only
  // classifier would choose those hidden early matches despite the requested desktop viewport.
  it('skips the hidden first mobile elements at 1440x900', () => {
    expect(idsFor(desktop, 'logo')).toEqual(['dl-17']);
    expect(idsFor(desktop, 'hero-heading')).toEqual(['dl-20']);
    expect(idsFor(desktop, 'nav-link')).toEqual(['dl-19']);
    expect(idsFor(desktop, 'cta')).toEqual(['dl-21', 'dl-24']);
    expect(desktop.elements.find((element) => element.dlId === 'dl-20')?.styles.fontSize).toBe('64px');
  });

  // why: descendant computed opacity remains 1 beneath an opacity-zero parent, so checking
  // only the candidate's computed style can incorrectly identify invisible brand and CTA elements.
  it('excludes descendants of an opacity-zero ancestor from every role', () => {
    for (const document of [mobile, desktop, defaultDocument]) {
      const reported = document.elements.map((element) => element.dlId);
      for (const hiddenId of ['dl-1', 'dl-2', 'dl-3', 'dl-4', 'dl-5', 'dl-6', 'dl-7']) {
        expect(reported).not.toContain(hiddenId);
      }
    }
  });

  // why: unlike opacity, CSS visibility can be restored on a descendant. Treating every hidden
  // ancestor as an unconditional veto would discard a button the browser actually paints.
  it('keeps restored visibility while dropping the sibling that inherits hidden visibility', () => {
    for (const document of [mobile, desktop]) {
      expect(idsFor(document, 'cta')).toContain('dl-24');
      expect(document.elements.map((element) => element.dlId)).not.toContain('dl-23');
    }
  });

  // why: visibility means participation in painting, not intersection with the viewport;
  // otherwise the global candidate filter would silently eliminate every ordinary footer.
  it('keeps the visible footer below the first viewport', () => {
    for (const document of [mobile, desktop]) {
      expect(idsFor(document, 'footer')).toEqual(['dl-25']);
      const footer = document.elements.find((element) => element.dlId === 'dl-25');
      expect(footer?.rect.y).toBeGreaterThan(900);
    }
  });

  // why: adding optional viewport inspection must not change the default geometry or introduce
  // new JSON fields into the existing stdout contract consumed by installed argument-free skills.
  it('preserves the default desktop result and exact original JSON shape', () => {
    expect(defaultDocument).toEqual(desktop);
    expect(defaultRaw.stdout.trim().split('\n')).toHaveLength(1);
    expect(defaultDocument.colors).toBe('see tokens.json');
    for (const document of [defaultDocument, desktop, mobile]) {
      expect(Object.keys(document).sort()).toEqual(['colors', 'elements']);
      for (const element of document.elements) {
        expect(Object.keys(element).sort()).toEqual([
          'confidence', 'dlId', 'rect', 'role', 'selector', 'src', 'styles', 'tag', 'text',
        ]);
        expect(Object.keys(element.styles).sort()).toEqual(['background', 'color', 'fontFamily', 'fontSize']);
      }
    }
    expect(fs.readdirSync(projectDir)).toEqual(['clone']);
    expect(fs.readdirSync(path.join(projectDir, 'clone'))).toEqual(['index.html']);
  });
});
