/**
 * The `setup` command — self-provisioning for installs that have no SessionStart hook.
 *
 * `plugin/scripts/bootstrap.sh` provisions `~/.design-lens/` for the two plugin channels (Claude
 * Code and Codex run it as a hook). But the `npx skills add` ecosystem copies SKILL.md directories
 * into agents that have no hook mechanism at all (Cursor, OpenCode, …), and the npm channel
 * (`npx design-lens`) ships only this bundle. Both land on a machine where the launcher the skills
 * hard-code (`~/.design-lens/bin/design-lens`, ADR-004) does not exist. `setup` is the TypeScript
 * port of bootstrap.sh that closes that gap (ADR-016): same layout, same launcher bytes, same
 * version+node-major marker semantics, and — load-bearing — the SAME dependency pins, because the
 * bundle keeps `playwright` and the adblocker `external` (tsup.config.ts) and is only correct
 * against the exact versions it was compiled with. `test/unit/setup.test.ts` fails if any of these
 * drift from bootstrap.sh or package.json.
 *
 * One deliberate divergence from bootstrap.sh: exit semantics. Bootstrap always exits 0 because a
 * SessionStart hook must never block a session; `setup` is user-invoked, so a failure here is the
 * user's whole errand and MUST exit 1 with an actionable message (CONVENTIONS forbids swallowing).
 *
 * The bundle source is this very file at run time: esbuild rewrites `import.meta.url` to
 * `pathToFileURL(__filename)` in the CJS bundle, so under `npx design-lens setup` it names the
 * npm-installed `dist/design-lens.cjs`, which is byte-identical to the committed bundle bootstrap
 * would have copied.
 *
 * I/O discipline (guardrails / spec 00): all human progress → stderr; stdout stays machine-clean.
 *
 * Spec: specs/01-packaging.md (§Runtime provisioning); ADR-007 (layout), ADR-016 (this channel).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';

import { designLensHome } from '../lib/home.js';
import { VERSION } from '../version.js';

/**
 * Exact pins, mirroring plugin/cli/package.json dependencies AND the literals in
 * plugin/scripts/bootstrap.sh. All three sources must agree — the unit suite asserts it.
 */
export const PLAYWRIGHT_PIN = '1.61.1';
export const ADBLOCKER_PIN = '2.18.1';

/**
 * The launcher, byte-identical to bootstrap.sh's `LAUNCHER_EOF` heredoc. It re-resolves
 * DESIGN_LENS_HOME at RUN time (never baking in this run's value) and execs the copied bundle;
 * NODE_PATH is a best-effort hint that loadRuntimeDep() backstops with an explicit-path require.
 */
export const LAUNCHER_CONTENT = `#!/usr/bin/env bash
DL_HOME="\${DESIGN_LENS_HOME:-$HOME/.design-lens}"
export NODE_PATH="$DL_HOME/runtime/node_modules\${NODE_PATH:+:$NODE_PATH}"
exec node "$DL_HOME/lib/design-lens.cjs" "$@"
`;

/** Marker file name scoping "provisioned" to plugin version + node major (bootstrap.sh step 1). */
export function markerName(version: string, nodeVersion: string): string {
  const major = nodeVersion.split('.')[0];
  return `.installed-${version.startsWith('v') ? version : `v${version}`}-node${major}`;
}

/** A command runner `runSetup` can execute through; tests inject a recorder, the CLI uses spawn. */
export type ExecFn = (cmd: string, args: string[]) => { status: number | null; error?: Error };

export interface SetupIO {
  exec: ExecFn;
  /** Human progress line → stderr. */
  say: (message: string) => void;
  /** Absolute path of the running bundle (or a stand-in under test). */
  bundleSrc: string;
  /** `process.version`-shaped node version string. */
  nodeVersion: string;
}

/** Real-process defaults: spawn with stdio routed to stderr so stdout stays machine-clean. */
export function realSetupIO(): SetupIO {
  return {
    exec: (cmd, args) => {
      const r = spawnSync(cmd, args, { stdio: ['ignore', process.stderr, process.stderr] });
      return { status: r.status, error: r.error };
    },
    say: (message) => process.stderr.write(`design-lens: ${message}\n`),
    bundleSrc: fileURLToPath(import.meta.url),
    nodeVersion: process.version,
  };
}

/** Returns true when <pkg> is present in the runtime prefix at exactly <version> (pin_ok). */
function pinOk(runtimeModules: string, name: string, version: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(runtimeModules, name, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version === version;
  } catch {
    return false;
  }
}

/**
 * Provision `~/.design-lens` (or DESIGN_LENS_HOME): layout, bundle copy, pinned runtime deps,
 * Chromium, launcher, marker — the exact step order of bootstrap.sh. Idempotent: the fast path
 * (marker present + launcher executable) only refreshes a changed bundle and returns.
 *
 * @throws on any provisioning failure — the command maps that to exit 1.
 */
export function runSetup(io: SetupIO): void {
  const home = designLensHome();
  const marker = path.join(home, markerName(VERSION, io.nodeVersion));
  const bundleDst = path.join(home, 'lib/design-lens.cjs');
  const launcher = path.join(home, 'bin/design-lens');

  if (!fs.existsSync(io.bundleSrc)) {
    throw new Error(`cannot locate the design-lens bundle at ${io.bundleSrc}`);
  }

  const refreshBundle = (): void => {
    // cmp -s equivalent: only rewrite when the bytes differ (or the copy does not exist yet).
    const same =
      fs.existsSync(bundleDst) && fs.readFileSync(io.bundleSrc).equals(fs.readFileSync(bundleDst));
    if (!same) {
      fs.copyFileSync(io.bundleSrc, bundleDst);
      io.say('refreshed CLI bundle');
    }
  };

  // Fast path — provisioned for this version+major already; bootstrap.sh step 2.
  if (fs.existsSync(marker) && isExecutable(launcher)) {
    refreshBundle();
    return;
  }

  io.say(`provisioning runtime ${VERSION} into ${home} (first run downloads Chromium)…`);

  for (const dir of ['bin', 'lib', 'runtime', 'cache']) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }

  refreshBundle();

  // Runtime dependencies, kept external to the bundle (bootstrap.sh step 5).
  const runtimeModules = path.join(home, 'runtime/node_modules');
  if (
    pinOk(runtimeModules, 'playwright', PLAYWRIGHT_PIN) &&
    pinOk(runtimeModules, '@ghostery/adblocker-playwright', ADBLOCKER_PIN)
  ) {
    io.say('runtime dependencies already at pinned versions');
  } else {
    io.say(`installing playwright@${PLAYWRIGHT_PIN} and @ghostery/adblocker-playwright@${ADBLOCKER_PIN}`);
    run(io, 'npm', [
      'install',
      '--prefix',
      path.join(home, 'runtime'),
      '--no-audit',
      '--no-fund',
      `playwright@${PLAYWRIGHT_PIN}`,
      `@ghostery/adblocker-playwright@${ADBLOCKER_PIN}`,
    ]);
  }

  // Chromium (bootstrap.sh step 6) — idempotent, honors PLAYWRIGHT_BROWSERS_PATH.
  const playwrightBin = path.join(runtimeModules, '.bin/playwright');
  if (!isExecutable(playwrightBin)) {
    throw new Error(`playwright CLI missing at ${playwrightBin} after install`);
  }
  io.say('ensuring Chromium is installed…');
  run(io, playwrightBin, ['install', 'chromium']);

  // Launcher (bootstrap.sh step 7) — the ONLY executable path skills may reference (ADR-004).
  // writeFileSync's `mode` only applies on CREATE; an existing non-executable launcher (the very
  // situation that forced this reprovision) keeps its bits, so chmod explicitly — bootstrap.sh's
  // unconditional `chmod +x "$LAUNCHER"`.
  fs.writeFileSync(launcher, LAUNCHER_CONTENT);
  fs.chmodSync(launcher, 0o755);

  // Marker (bootstrap.sh step 8) — clear stale markers FIRST so an interrupted upgrade can never
  // leave two behind and let the fast path short-circuit on an older version's evidence.
  for (const entry of fs.readdirSync(home)) {
    if (entry.startsWith('.installed-v')) fs.rmSync(path.join(home, entry));
  }
  fs.writeFileSync(marker, '');
  io.say(`design-lens ${VERSION} ready`);
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Run one provisioning step, translating any non-zero/failed spawn into an actionable throw. */
function run(io: SetupIO, cmd: string, args: string[]): void {
  const { status, error } = io.exec(cmd, args);
  if (error) throw new Error(`${cmd} could not be started: ${error.message}`, { cause: error });
  if (status !== 0) throw new Error(`\`${cmd} ${args.join(' ')}\` exited with status ${String(status)}`);
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('provision the design-lens runtime (~/.design-lens) without a plugin hook')
    .action(() => {
      runSetup(realSetupIO());
    });
}
