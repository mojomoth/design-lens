import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  ADBLOCKER_PIN,
  LAUNCHER_CONTENT,
  PLAYWRIGHT_PIN,
  markerName,
  runSetup,
  type ExecFn,
  type SetupIO,
} from '../../src/commands/setup.js';
import { VERSION } from '../../src/version.js';

/**
 * Guards the `setup` command (ADR-016) — the hook-less twin of `plugin/scripts/bootstrap.sh`.
 * bootstrap.test.ts pins bootstrap.sh's contracts; this file pins (a) that setup NEVER diverges
 * from bootstrap.sh where the two must agree — dependency pins and launcher bytes — and (b) the
 * provisioning semantics themselves, which unlike bootstrap's can be exercised in-process because
 * runSetup takes an injected exec.
 */
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const BOOTSTRAP = path.join(REPO, 'plugin/scripts/bootstrap.sh');
const CLI_PKG = path.join(REPO, 'plugin/cli/package.json');

let home: string;
const savedHome = process.env.DESIGN_LENS_HOME;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'dl-setup-'));
  process.env.DESIGN_LENS_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.DESIGN_LENS_HOME;
  else process.env.DESIGN_LENS_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

/** An exec that records calls and fakes npm's observable effect: the pinned runtime deps appear. */
function fakeExec(calls: string[][]): ExecFn {
  return (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'npm' && args[0] === 'install') {
      const modules = path.join(home, 'runtime/node_modules');
      for (const [name, version] of [
        ['playwright', PLAYWRIGHT_PIN],
        ['@ghostery/adblocker-playwright', ADBLOCKER_PIN],
      ]) {
        mkdirSync(path.join(modules, name), { recursive: true });
        writeFileSync(path.join(modules, name, 'package.json'), JSON.stringify({ name, version }));
      }
      mkdirSync(path.join(modules, '.bin'), { recursive: true });
      writeFileSync(path.join(modules, '.bin/playwright'), '#!/bin/sh\n', { mode: 0o755 });
    }
    return { status: 0 };
  };
}

function io(calls: string[][], overrides: Partial<SetupIO> = {}): SetupIO {
  const bundleSrc = path.join(home, 'fake-bundle.cjs');
  if (!existsSync(bundleSrc)) writeFileSync(bundleSrc, '#!/usr/bin/env node\n// bundle v1\n');
  return { exec: fakeExec(calls), say: () => {}, bundleSrc, nodeVersion: 'v20.12.2', ...overrides };
}

describe('setup pins and launcher stay in lockstep with bootstrap.sh', () => {
  // why: ADR-016's central hazard. The bundle keeps playwright + the adblocker `external`
  // (tsup.config.ts), so it is only correct against the exact versions it was compiled with. Three
  // places now name those versions — package.json (compile-time), bootstrap.sh (plugin channel),
  // setup.ts (npm/skills channel) — and a bump that misses ONE ships a runtime silently mismatched
  // from the bundle on that channel only. bootstrap.test.ts locks bootstrap.sh↔package.json; this
  // closes the triangle. Nothing else checks setup.ts's literals.
  it('setup.ts pins equal package.json and bootstrap.sh exactly', () => {
    const deps = (JSON.parse(readFileSync(CLI_PKG, 'utf8')) as { dependencies: Record<string, string> })
      .dependencies;
    expect(PLAYWRIGHT_PIN).toBe(deps['playwright']);
    expect(ADBLOCKER_PIN).toBe(deps['@ghostery/adblocker-playwright']);
    const bootstrap = readFileSync(BOOTSTRAP, 'utf8');
    expect(bootstrap).toContain(`PLAYWRIGHT_PIN="${PLAYWRIGHT_PIN}"`);
    expect(bootstrap).toContain(`ADBLOCKER_PIN="${ADBLOCKER_PIN}"`);
  });

  // why: ADR-004 makes ~/.design-lens/bin/design-lens the ONLY executable path skills reference,
  // and spec 01 pins the launcher's exact content. Whichever provisioner ran LAST wrote the
  // launcher, so if setup's bytes ever diverge from bootstrap's heredoc, behaviour becomes a
  // function of install order — the worst kind of bug to reproduce. Byte-compare, not feature-
  // compare, so any future edit must consciously touch both.
  it('setup writes byte-identically the launcher bootstrap.sh writes', () => {
    const heredoc = /<<'LAUNCHER_EOF'\n([\s\S]*?)LAUNCHER_EOF\n/.exec(readFileSync(BOOTSTRAP, 'utf8'));
    expect(heredoc, "bootstrap.sh must contain the quoted 'LAUNCHER_EOF' heredoc").not.toBeNull();
    expect(LAUNCHER_CONTENT).toBe(heredoc![1]);
  });
});

describe('runSetup provisioning semantics', () => {
  it('provisions the full layout, launcher, and version+node-major marker', () => {
    const calls: string[][] = [];
    runSetup(io(calls));

    for (const dir of ['bin', 'lib', 'runtime', 'cache']) {
      expect(existsSync(path.join(home, dir)), `${dir}/ must exist`).toBe(true);
    }
    const launcher = path.join(home, 'bin/design-lens');
    expect(readFileSync(launcher, 'utf8')).toBe(LAUNCHER_CONTENT);
    expect(statSync(launcher).mode & 0o111, 'launcher must be executable').toBeGreaterThan(0);
    expect(readFileSync(path.join(home, 'lib/design-lens.cjs'), 'utf8')).toContain('bundle v1');
    expect(existsSync(path.join(home, markerName(VERSION, 'v20.12.2')))).toBe(true);

    // npm install with BOTH exact pins, then chromium via the runtime's own playwright CLI.
    const npm = calls.find((c) => c[0] === 'npm');
    expect(npm).toContain(`playwright@${PLAYWRIGHT_PIN}`);
    expect(npm).toContain(`@ghostery/adblocker-playwright@${ADBLOCKER_PIN}`);
    const chromium = calls.find((c) => c[0].endsWith('.bin/playwright'));
    expect(chromium?.slice(1)).toEqual(['install', 'chromium']);
  });

  // why: bootstrap.sh's fast path is what makes running on EVERY session start acceptable; setup
  // inherits the same marker contract so the two provisioners recognize each other's work. A setup
  // that re-ran npm+chromium over a bootstrap-provisioned home would cost minutes for nothing —
  // and one that skipped the bundle refresh would strand devs on stale code.
  it('fast path skips npm/chromium but still refreshes a changed bundle', () => {
    const first: string[][] = [];
    const setup = io(first);
    runSetup(setup);

    writeFileSync(setup.bundleSrc, '#!/usr/bin/env node\n// bundle v2\n');
    const second: string[][] = [];
    runSetup({ ...setup, exec: fakeExec(second) });

    expect(second, 'fast path must not exec anything').toEqual([]);
    expect(readFileSync(path.join(home, 'lib/design-lens.cjs'), 'utf8')).toContain('bundle v2');
  });

  // why: the stale-marker rule bootstrap.test.ts pins for the shell must hold here too — an
  // interrupted upgrade that leaves two markers lets the fast path short-circuit on the OLD
  // version's evidence forever.
  it('clears stale markers from earlier versions before writing its own', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, '.installed-v0.0.9-node20'), '');
    runSetup(io([]));
    expect(existsSync(path.join(home, '.installed-v0.0.9-node20'))).toBe(false);
    expect(existsSync(path.join(home, markerName(VERSION, 'v20.12.2')))).toBe(true);
  });

  // why: a marker for the same version but a DIFFERENT node major must NOT satisfy the fast path —
  // native modules and browser builds are not portable across majors (bootstrap.sh step 1).
  it('reprovisions when the marker belongs to another node major', () => {
    const calls: string[][] = [];
    const setup = io(calls);
    runSetup(setup);
    const before = calls.length;

    const next: string[][] = [];
    runSetup({ ...setup, exec: fakeExec(next), nodeVersion: 'v22.1.0' });
    expect(before).toBeGreaterThan(0);
    expect(next.length, 'a node-major change must retrigger provisioning').toBeGreaterThan(0);
    expect(existsSync(path.join(home, markerName(VERSION, 'v22.1.0')))).toBe(true);
  });

  // why: setup is user-invoked (unlike the never-block-session bootstrap), so a failed step must
  // surface as a throw → exit 1 with the command named, not a sealed marker over a broken runtime.
  it('throws on a failing step and does not write the marker', () => {
    const failAll: ExecFn = () => ({ status: 1 });
    expect(() => runSetup({ ...io([]), exec: failAll })).toThrow(/exited with status 1/);
    expect(existsSync(path.join(home, markerName(VERSION, 'v20.12.2')))).toBe(false);
  });

  it('throws actionably when the bundle cannot be found', () => {
    expect(() => runSetup({ ...io([]), bundleSrc: path.join(home, 'missing.cjs') })).toThrow(
      /cannot locate the design-lens bundle/,
    );
  });

  // why: a launcher that lost its executable bit (e.g. restored from a permissive backup) must not
  // satisfy the fast path — every skill would then fail with "permission denied" forever.
  it('reprovisions when the launcher exists but is not executable', () => {
    const setup = io([]);
    runSetup(setup);
    chmodSync(path.join(home, 'bin/design-lens'), 0o644);
    const calls: string[][] = [];
    runSetup({ ...setup, exec: fakeExec(calls) });
    expect(calls.length, 'a non-executable launcher must retrigger provisioning').toBeGreaterThan(0);
    expect(statSync(path.join(home, 'bin/design-lens')).mode & 0o111).toBeGreaterThan(0);
  });
});
