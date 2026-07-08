/**
 * The `screenshot <projectDir|--url U>` command — a PNG of a clone on disk, or of a live URL.
 *
 * Two jobs, one renderer. `screenshot <projectDir>` serves `<projectDir>/clone/` on an ephemeral
 * loopback port and paints it: that is how the customize-clone skill produces its before/after
 * evidence (spec 06), and it must reflect `dl-overrides.css` and any agent edit made since the
 * clone — so it re-renders rather than reusing `clone-full.png`. `screenshot --url U` paints a live
 * page: the single deliberate live-web exception in the reverse-design flow, used for the optional
 * mobile view (`--width 390 --height 844`, spec 04).
 *
 * All the decision logic here is pure and unit-tested WITHOUT a browser ({@link resolveTarget},
 * {@link resolveScreenshotFlags}, {@link defaultOutFile}); the pixels come from
 * `capture/browser.ts#renderScreenshot`. Flags are validated before Chromium launches, so a typo
 * costs nothing.
 *
 * I/O discipline (guardrails): human progress → stderr, the single result JSON → stdout. Exit 1 on
 * a bad flag combination, a `projectDir` that is not a clone, or a navigation/launch failure.
 *
 * Spec: specs/02-clone-engine.md §Command surface; specs/04-design-analysis.md; specs/06-customization.md.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { renderScreenshot, renderScreenshotOfDir } from '../capture/browser.js';
import { writePng } from '../output/writer.js';

/** Defaults mirror the capture viewport so a clone shot lines up with `original-viewport.png`. */
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
/** Spec 02's command table pins `screenshot --dsf` to 2 (retina evidence), unlike `clone`'s 1. */
const DEFAULT_DSF = 2;
/** A live page may be slow; a clone on loopback never is. One budget covers both, generously. */
const NAVIGATION_TIMEOUT_MS = 60_000;
/** Quiet time after fonts resolve, for late reveal work. */
const SETTLE_MS = 500;

/** What to paint: a clone project on disk, or a live URL. Exactly one, never both. */
export type ScreenshotTarget =
  | { kind: 'project'; projectDir: string }
  | { kind: 'url'; url: string };

/** Fully-parsed, defaulted screenshot flags. */
export interface ResolvedScreenshotFlags {
  viewport: { width: number; height: number };
  dsf: number;
  fullPage: boolean;
}

/** The single JSON line the command prints to stdout on success. */
export interface ScreenshotResult {
  /** Absolute path of the PNG written. */
  out: string;
  /** Size of the PNG in bytes. */
  bytes: number;
}

/**
 * Decide what to paint. Throws (⇒ exit 1) when both or neither of `<projectDir>`/`--url` is given,
 * and when `--url` is not http(s) — a `file:` or `javascript:` URL here would read the user's disk
 * or run code, and this command's whole contract is "paint a web page".
 */
export function resolveTarget(
  projectDir: string | undefined,
  url: string | undefined,
): ScreenshotTarget {
  if (projectDir !== undefined && url !== undefined) {
    throw new Error('pass either <projectDir> or --url <url>, not both');
  }
  if (url !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`invalid --url "${url}": not an absolute URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`invalid --url "${url}": expected an http(s) URL`);
    }
    return { kind: 'url', url };
  }
  if (projectDir !== undefined) {
    return { kind: 'project', projectDir: path.resolve(projectDir) };
  }
  throw new Error('nothing to screenshot: pass a clone <projectDir> or --url <url>');
}

/** Parse a positive number flag, throwing with the flag name on a non-positive/NaN value. */
function parsePositive(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${flag} "${raw}"; expected a positive number`);
  }
  return n;
}

/** Convert commander's raw strings into a validated {@link ResolvedScreenshotFlags}. */
export function resolveScreenshotFlags(raw: {
  width?: string;
  height?: string;
  dsf?: string;
  fullPage?: boolean;
}): ResolvedScreenshotFlags {
  return {
    viewport: {
      width: parsePositive(raw.width, '--width', DEFAULT_WIDTH),
      height: parsePositive(raw.height, '--height', DEFAULT_HEIGHT),
    },
    dsf: parsePositive(raw.dsf, '--dsf', DEFAULT_DSF),
    fullPage: raw.fullPage === true,
  };
}

/**
 * Where the PNG lands when `--out` is omitted. A clone project owns a `screenshots/` directory, so
 * the shot belongs beside its siblings; a live URL has no home, so it lands in the cwd.
 */
export function defaultOutFile(target: ScreenshotTarget, cwd: string): string {
  return target.kind === 'project'
    ? path.join(target.projectDir, 'screenshots', 'screenshot.png')
    : path.resolve(cwd, 'screenshot.png');
}

/** Paint the target and write the PNG. Returns the absolute path and byte count. */
export async function runScreenshot(
  target: ScreenshotTarget,
  flags: ResolvedScreenshotFlags,
  outFile: string,
): Promise<ScreenshotResult> {
  const out = path.resolve(outFile);
  const render = {
    viewport: flags.viewport,
    deviceScaleFactor: flags.dsf,
    fullPage: flags.fullPage,
    navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
    settleMs: SETTLE_MS,
  };

  let png: Buffer;
  if (target.kind === 'project') {
    const cloneDir = path.join(target.projectDir, 'clone');
    const indexPath = path.join(cloneDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`not a design-lens clone project: missing ${indexPath}`);
    }
    process.stderr.write(`design-lens: rendering ${cloneDir}\n`);
    png = await renderScreenshotOfDir(cloneDir, render);
  } else {
    process.stderr.write(`design-lens: rendering ${target.url}\n`);
    png = await renderScreenshot(target.url, render);
  }

  writePng(out, png);
  process.stderr.write(`design-lens: wrote ${out} (${png.byteLength} bytes)\n`);
  return { out, bytes: png.byteLength };
}

export function registerScreenshotCommand(program: Command): void {
  program
    .command('screenshot')
    .argument('[projectDir]', 'a clone project directory; omit when using --url')
    .description('Write a PNG of a clone project or of a live URL.')
    .option('--url <url>', 'screenshot a live http(s) URL instead of a clone project')
    .option('--out <file>', 'output PNG path (default: <projectDir>/screenshots/screenshot.png)')
    .option('--full-page', 'capture the whole scrollable page (default: the viewport only)')
    .option('--width <px>', 'viewport width', String(DEFAULT_WIDTH))
    .option('--height <px>', 'viewport height', String(DEFAULT_HEIGHT))
    .option('--dsf <n>', 'device scale factor', String(DEFAULT_DSF))
    .action(
      async (
        projectDir: string | undefined,
        options: {
          url?: string;
          out?: string;
          fullPage?: boolean;
          width?: string;
          height?: string;
          dsf?: string;
        },
      ): Promise<void> => {
        try {
          const target = resolveTarget(projectDir, options.url);
          const flags = resolveScreenshotFlags(options);
          const outFile = options.out ?? defaultOutFile(target, process.cwd());
          const result = await runScreenshot(target, flags, outFile);
          process.stdout.write(`${JSON.stringify(result)}\n`);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          process.stderr.write(`error: ${detail}\n`);
          process.exitCode = 1;
        }
      },
    );
}
