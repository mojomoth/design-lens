/**
 * The `clone <url>` command — the orchestrator that drives the M1 spine end to end.
 *
 * This module owns ONLY sequencing and I/O: every stage is an already-unit-tested pure/side-effect
 * module (capture/*, localize/*, output/*). The ordered pipeline (spec 02-clone-engine §M1) is:
 *   1. launch Chromium with resource capture wired (capture/browser)
 *   2. navigate + settle, read robots.txt (capture/settle)
 *   3. stamp `data-dl-id` incl. open shadow roots, apply `--remove-selector` (capture/stamp)
 *   4. own CSSOM-walk serialize (capture/serialize)
 *   5. sanitize to an inert document (localize/html-rewrite)
 *   6. localize every captured reference to `assets/…` (localize/localize)
 *   7. beautify HTML + every localized stylesheet (output/beautify)
 *   8. write `clone/` + empty `dl-overrides.css` + `manifest.json` + `REPORT.md` (output/*)
 *
 * I/O discipline (guardrails / spec 02): human progress → stderr, the single result JSON → stdout.
 * The browser is ALWAYS closed (a `finally`), so a fatal navigation error still lets the process
 * exit rather than hang. Navigation and write failures are fatal (thrown ⇒ exit 1 in the action);
 * every other degradation is a recorded warning. Post-processing (stages 5–8) never touches the
 * browser, so it runs after the browser is closed on the captured bytes.
 *
 * Spec: specs/02-clone-engine.md §M1 spine; specs/03-clone-format.md (output contract).
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { launchCapture } from '../capture/browser.js';
import { navigateAndSettle, checkRobotsDisallowed, lazyLoadSweep } from '../capture/settle.js';
import { stampDom } from '../capture/stamp.js';
import { serializeDom } from '../capture/serialize.js';
import { sanitizeHtml } from '../localize/html-rewrite.js';
import { localizeDocument, type LocalizedAsset } from '../localize/localize.js';
import { beautifyHtml, beautifyCss } from '../output/beautify.js';
import {
  buildManifest,
  manifestJson,
  resourceEntry,
  type ManifestResource,
  type ManifestStats,
} from '../output/manifest.js';
import { buildReport, type CaptureRow } from '../output/report.js';
import { writeClone } from '../output/writer.js';
import { baseSlug, nextFreeSlug } from '../lib/slug.js';
import { PLAYWRIGHT_PIN } from '../lib/pins.js';
import { VERSION } from '../version.js';

/** Fully-parsed, defaulted clone options (strings from commander are already converted here). */
export interface CloneRunOptions {
  /** `--project <name>` override for the slug; falls back to the URL host. */
  project?: string;
  /** Output root (`--out`), resolved against cwd inside {@link runClone}. */
  out: string;
  /** Render viewport (`--viewport WxH`). */
  viewport: { width: number; height: number };
  /** Device scale factor (`--dsf`). */
  dsf: number;
  /** Whole-run budget in milliseconds (from `--timeout <seconds>`). */
  timeoutMs: number;
  /** Extra quiet time after networkidle in ms (`--settle`). */
  settleMs: number;
  /** `--remove-selector` matches removed before stamping (repeatable). */
  removeSelectors: string[];
  /** `--no-scroll` disables the lazy-load scroll sweep (spec 02 §M2). */
  noScroll: boolean;
  /** `--user-agent` override; omitted ⇒ the real default Chromium UA. */
  userAgent?: string;
}

/** The single JSON line the command prints to stdout on success. */
export interface CloneResult {
  /** Absolute path to `<out>/<slug>`. */
  projectDir: string;
  /** Count of non-fatal warnings recorded during the run. */
  warnings: number;
}

/** A `.css` body must be beautified and never treated as opaque bytes; fonts/images pass through. */
function isCssAsset(asset: LocalizedAsset): boolean {
  return /text\/css/i.test(asset.contentType) || asset.assetPath.endsWith('.css');
}

function isFontAsset(asset: LocalizedAsset): boolean {
  return /^font\//i.test(asset.contentType) || /\.(?:woff2?|ttf|otf|eot)$/i.test(asset.assetPath);
}

function isImageAsset(asset: LocalizedAsset): boolean {
  return /^image\//i.test(asset.contentType) || /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp)$/i.test(asset.assetPath);
}

/** Sum the count/bytes of the assets matching `pred` into one REPORT capture row. */
function captureRow(assets: LocalizedAsset[], pred: (a: LocalizedAsset) => boolean): CaptureRow {
  const matched = assets.filter(pred);
  return { count: matched.length, bytes: matched.reduce((n, a) => n + a.body.byteLength, 0) };
}

/**
 * Run the full clone pipeline for one URL and write the project directory. Returns the resolved
 * absolute project dir and warning count. Throws (fatal ⇒ exit 1 upstream) only on a navigation
 * failure or a write failure; every optional degradation is folded into the warning count.
 */
export async function runClone(url: string, opts: CloneRunOptions): Promise<CloneResult> {
  const start = Date.now();
  const deadline = start + opts.timeoutMs;
  const capturedAt = new Date().toISOString();

  // Resolve a fresh project dir up front — the writer refuses to overwrite, and computing this
  // before touching the browser fails fast on a bad `--out` before a Chromium launch.
  const outAbs = path.resolve(process.cwd(), opts.out);
  const base = baseSlug({ url, project: opts.project });
  const slug = nextFreeSlug(base, (candidate) => fs.existsSync(path.join(outAbs, candidate)));
  const projectDir = path.join(outAbs, slug);

  process.stderr.write(`design-lens: cloning ${url}\n`);

  const capture = await launchCapture({
    viewport: opts.viewport,
    deviceScaleFactor: opts.dsf,
    ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
  });

  let serializedHtml: string;
  let styleRules: number;
  let canvasConverted: number;
  let shadowRootsSerialized: number;
  let elementsStamped: number;
  let finalUrl: string;
  let title: string;
  let userAgent: string;
  let robotsDisallowed: boolean;
  try {
    let settle;
    try {
      settle = await navigateAndSettle(capture.page, {
        url,
        gotoTimeoutMs: Math.max(1, deadline - Date.now()),
        settleMs: opts.settleMs,
        deadline,
      });
    } catch (err) {
      // Navigation failure (DNS, timeout, connection refused) is fatal — one actionable line.
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`could not load ${url} (${detail}); check the URL is reachable or raise --timeout`);
    }
    finalUrl = settle.finalUrl;
    title = settle.title;
    // Lazy-load sweep (optional, spec 02 §M2): scroll the whole page so IntersectionObserver images
    // are requested and captured before serialization. A throw here degrades to a warning — a page
    // that never settles must not block the clone (spec 02 §Error handling degradation ladder).
    if (!opts.noScroll) {
      try {
        await lazyLoadSweep(capture.page, {
          viewportHeight: opts.viewport.height,
          settleMs: opts.settleMs,
          deadline,
        });
        await capture.drainResponses();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        capture.warnings.push(`lazy-load scroll sweep failed: ${detail}`);
      }
    }
    robotsDisallowed = await checkRobotsDisallowed(capture.context, finalUrl);
    userAgent = await capture.page.evaluate(() => navigator.userAgent);
    elementsStamped = await stampDom(capture.page, opts.removeSelectors);
    const serialized = await serializeDom(capture.page);
    serializedHtml = serialized.html;
    styleRules = serialized.styleRules;
    canvasConverted = serialized.canvasConverted;
    shadowRootsSerialized = serialized.shadowRootsSerialized;
    // Surface a percy-fallback (or any serializer) warning into the run's warning count.
    capture.warnings.push(...serialized.warnings);
    // Ensure every captured response body has landed in the store before we localize against it.
    await capture.drainResponses();
  } finally {
    await capture.browser.close();
  }

  // --- Post-processing (stages 5–8): pure over the captured bytes, no browser needed. ----------
  const inertHtml = sanitizeHtml(serializedHtml);
  const localized = localizeDocument(inertHtml, finalUrl, capture.store);

  // Pretty-print every localized stylesheet BEFORE hashing, so the manifest sha256/bytes describe
  // the exact bytes written to disk (fonts/images stay byte-identical to the captured body).
  for (const asset of localized.assets) {
    if (isCssAsset(asset)) {
      asset.body = Buffer.from(beautifyCss(asset.body.toString('utf8')), 'utf8');
    }
  }

  // The provenance comment deliberately omits the raw source URL: the sealed A4 assertion forbids
  // the capture host (e.g. `127.0.0.1`) from appearing anywhere inside `clone/`, and a loopback
  // source URL would smuggle it into line 1. The source URL + capture time live in
  // `manifest.source` and `REPORT.md` (both outside `clone/`), which A4 does not scan (ADR-011).
  const provenance = `<!-- Cloned by design-lens v${VERSION} at ${capturedAt} for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->`;
  const html = `${provenance}\n${beautifyHtml(localized.html)}\n`;

  const warnings = capture.warnings.length;

  const resources: ManifestResource[] = localized.assets.map((asset) =>
    resourceEntry(asset.body, {
      assetPath: asset.assetPath,
      originalUrl: asset.originalUrl,
      contentType: asset.contentType,
      via: asset.via,
    }),
  );

  const stats: ManifestStats = {
    elementsStamped,
    styleRules,
    fonts: localized.stats.fonts,
    images: localized.stats.images,
    cssFiles: localized.stats.cssFiles,
    warnings,
  };

  const manifest = buildManifest({
    playwrightVersion: PLAYWRIGHT_PIN,
    source: {
      url,
      finalUrl,
      title,
      capturedAt,
      viewport: opts.viewport,
      userAgent,
      robotsDisallowed,
    },
    resources,
    remote: localized.remote,
    stats,
  });

  const reportMarkdown = buildReport({
    title,
    source: { url, finalUrl, capturedAt, viewport: opts.viewport, robotsDisallowed },
    capture: {
      images: captureRow(localized.assets, isImageAsset),
      fonts: captureRow(localized.assets, isFontAsset),
      css: captureRow(localized.assets, isCssAsset),
      other: captureRow(
        localized.assets,
        (a) => !isImageAsset(a) && !isFontAsset(a) && !isCssAsset(a),
      ),
      consentBlocking: 'none (M1 spine; consent blocking lands in M2)',
    },
    remote: localized.remote,
    // Canvas → data: images and shadow roots → <template> come from the @percy/dom serializer;
    // cross-origin iframe capture is still deferred (spec 02 §M2), so that counter stays 0.
    fidelity: { canvasConverted, shadowRootsSerialized, crossOriginIframes: 0 },
    verify: 'Not run during clone; run `design-lens verify <projectDir>` (M3).',
  });

  writeClone({
    projectDir,
    html,
    assets: localized.assets,
    manifestJson: manifestJson(manifest),
    reportMarkdown,
  });

  process.stderr.write(
    `design-lens: wrote ${resources.length} asset(s) to ${projectDir} (${warnings} warning(s))\n`,
  );
  process.stderr.write(
    'design-lens: this clone is for private design study — review REPORT.md before deriving work from it.\n',
  );

  return { projectDir, warnings };
}

/** Accumulate a repeatable commander option into an array (used by `--remove-selector`). */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Parse a `WxH` viewport string; throws on a malformed value so the command exits 1 with a hint. */
function parseViewport(raw: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(raw.trim());
  if (match === null) {
    throw new Error(`invalid --viewport "${raw}"; expected WxH like 1440x900`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Parse a positive number flag, throwing with the flag name on a non-positive/NaN value. */
function parsePositive(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid ${flag} "${raw}"; expected a positive number`);
  }
  return n;
}

/**
 * Register the `clone` subcommand on the program. The action converts commander's raw string
 * options into a {@link CloneRunOptions}, runs the pipeline, prints the result JSON to stdout, and
 * maps any fatal error to `error: …` on stderr + exit code 1.
 */
export function registerCloneCommand(program: Command): void {
  program
    .command('clone')
    .argument('<url>', 'the reference URL to clone')
    .description('Clone a reference site into an editable local mirror under .design-lens/<slug>/.')
    .option('--project <name>', 'project directory name (defaults to the URL host)')
    .option('--out <dir>', 'output root directory', './.design-lens')
    .option('--viewport <WxH>', 'render viewport, e.g. 1440x900', '1440x900')
    .option('--dsf <n>', 'device scale factor', '1')
    .option('--timeout <s>', 'whole-run budget in seconds', '90')
    .option('--settle <ms>', 'extra quiet time after networkidle, in ms', '1500')
    .option('--no-scroll', 'disable the lazy-load scroll sweep before serialization')
    .option('--remove-selector <css>', 'remove matching elements before capture (repeatable)', collect, [])
    .option('--user-agent <ua>', 'override the Chromium user agent')
    .action(
      async (
        url: string,
        options: {
          project?: string;
          out: string;
          viewport: string;
          dsf: string;
          timeout: string;
          settle: string;
          scroll: boolean;
          removeSelector: string[];
          userAgent?: string;
        },
      ): Promise<void> => {
        try {
          const parsed: CloneRunOptions = {
            ...(options.project !== undefined ? { project: options.project } : {}),
            out: options.out,
            viewport: parseViewport(options.viewport),
            dsf: parsePositive(options.dsf, '--dsf'),
            timeoutMs: parsePositive(options.timeout, '--timeout') * 1000,
            settleMs: Number(options.settle),
            // Commander maps `--no-scroll` to `options.scroll === false`; default is true.
            noScroll: options.scroll === false,
            removeSelectors: options.removeSelector,
            ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
          };
          const result = await runClone(url, parsed);
          process.stdout.write(`${JSON.stringify(result)}\n`);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          process.stderr.write(`error: ${detail}\n`);
          process.exitCode = 1;
        }
      },
    );
}
