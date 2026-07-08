import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  defaultOutFile,
  resolveScreenshotFlags,
  resolveTarget,
  type ScreenshotTarget,
} from '../../src/commands/screenshot.js';

// why: `resolveTarget` is the only thing standing between the user and a browser launch. Every rule
// here is enforced BEFORE Chromium starts, so a typo costs nothing; and the http(s) guard is a real
// safety boundary — without it `screenshot --url file:///etc/passwd` would happily paint the user's
// disk into a PNG, and a `javascript:` URL would execute in the render context. If these cases
// regress, the command silently grows a local-file-read primitive.
describe('resolveTarget', () => {
  it('accepts a lone --url and keeps it verbatim', () => {
    expect(resolveTarget(undefined, 'https://example.com/a?b=1')).toEqual({
      kind: 'url',
      url: 'https://example.com/a?b=1',
    });
  });

  it('accepts a lone projectDir and resolves it to an absolute path', () => {
    const target = resolveTarget('.design-lens/example-com', undefined);
    expect(target.kind).toBe('project');
    expect(path.isAbsolute((target as { projectDir: string }).projectDir)).toBe(true);
  });

  it('rejects passing both a projectDir and --url', () => {
    expect(() => resolveTarget('some/dir', 'https://example.com')).toThrow(/not both/);
  });

  it('rejects passing neither', () => {
    expect(() => resolveTarget(undefined, undefined)).toThrow(/nothing to screenshot/);
  });

  it('rejects a non-http(s) --url (no file: disk reads, no javascript: execution)', () => {
    expect(() => resolveTarget(undefined, 'file:///etc/passwd')).toThrow(/expected an http\(s\) URL/);
    expect(() => resolveTarget(undefined, 'javascript:alert(1)')).toThrow(/expected an http\(s\) URL/);
  });

  it('rejects a --url that is not an absolute URL at all', () => {
    expect(() => resolveTarget(undefined, 'example.com')).toThrow(/not an absolute URL/);
  });
});

// why: these defaults ARE the spec's command table (spec 02 §Command surface): `--dsf` is 2 for
// `screenshot` (retina evidence) where `clone` uses 1, and the viewport defaults to the 1440x900
// capture viewport so a clone shot lines up with `original-viewport.png`. Silent drift here would
// make every skill's before/after comparison misleading rather than broken — the worst kind of bug.
// The positive-number guards keep a `--width 0` from reaching Chromium as an invalid viewport.
describe('resolveScreenshotFlags', () => {
  it('defaults to the 1440x900 capture viewport, dsf 2, viewport-only', () => {
    expect(resolveScreenshotFlags({})).toEqual({
      viewport: { width: 1440, height: 900 },
      dsf: 2,
      fullPage: false,
    });
  });

  it('parses the mobile-evidence flags from spec 04', () => {
    expect(resolveScreenshotFlags({ width: '390', height: '844' })).toEqual({
      viewport: { width: 390, height: 844 },
      dsf: 2,
      fullPage: false,
    });
  });

  it('honours --full-page and a --dsf override', () => {
    expect(resolveScreenshotFlags({ dsf: '1', fullPage: true })).toEqual({
      viewport: { width: 1440, height: 900 },
      dsf: 1,
      fullPage: true,
    });
  });

  it('rejects non-positive or non-numeric dimensions, naming the flag', () => {
    expect(() => resolveScreenshotFlags({ width: '0' })).toThrow(/--width/);
    expect(() => resolveScreenshotFlags({ height: '-5' })).toThrow(/--height/);
    expect(() => resolveScreenshotFlags({ dsf: 'retina' })).toThrow(/--dsf/);
  });
});

// why: `--out` is optional, so this decides where bytes land when a user omits it. A clone project
// owns `screenshots/`, and spec 06 requires the customize-clone before/after shots to sit beside
// `clone-full.png`; a live URL has no home, so it must land in the cwd rather than somewhere
// surprising. If this regressed, `screenshot <dir>` could scatter PNGs into the user's cwd.
describe('defaultOutFile', () => {
  it('puts a clone shot under the project dir screenshots/', () => {
    const target: ScreenshotTarget = { kind: 'project', projectDir: '/tmp/p/example-com' };
    expect(defaultOutFile(target, '/somewhere/else')).toBe(
      path.join('/tmp/p/example-com', 'screenshots', 'screenshot.png'),
    );
  });

  it('puts a live-URL shot in the cwd', () => {
    const target: ScreenshotTarget = { kind: 'url', url: 'https://example.com' };
    expect(defaultOutFile(target, '/work/here')).toBe(path.resolve('/work/here', 'screenshot.png'));
  });
});
