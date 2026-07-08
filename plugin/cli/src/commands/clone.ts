/**
 * The `clone <url>` command — the orchestrator that drives the M1 spine end to end.
 *
 * This module owns ONLY sequencing and I/O: every stage is an already-unit-tested pure/side-effect
 * module (capture/*, localize/*, output/*). The ordered pipeline (spec 02-clone-engine §M1) is:
 *   1. launch Chromium with resource capture wired (capture/browser)
 *   1b. arm consent/cookie blocking before the first request goes out (capture/consent)
 *   2. navigate + settle, read robots.txt (capture/settle)
 *   3. stamp `data-dl-id` incl. open shadow roots, apply `--remove-selector` + the consent
 *      engine's cosmetic selectors (capture/stamp)
 *   4. serialize (@percy/dom, own CSSOM walk as fallback) (capture/serialize)
 *   5. refetch references the render never requested — unused srcset variants and CSS-discovered
 *      assets such as unused `@font-face` faces (localize/fetch-missing) — the last stage that
 *      needs the browser (its request client carries the real Chromium UA)
 *   5b. shoot `original-viewport.png` + `original-full.png` off the LIVE page — the last thing the
 *       browser is used for, since the page dies with it (spec 02 §M3)
 *   6. sanitize to an inert document (localize/html-rewrite)
 *   7. localize every captured reference to `assets/…` (localize/localize)
 *   8. beautify HTML + every localized stylesheet (output/beautify)
 *   9. write `clone/` + empty `dl-overrides.css` (output/writer)
 *   9b. re-render the WRITTEN clone from disk → `screenshots/clone-full.png` (the fidelity check)
 *   9c. verify the written clone against the format invariants (commands/verify) — warnings, never
 *       fatal (spec 02 §M3); its summary is what REPORT.md renders under `## Verify`
 *   10. write `manifest.json` + `REPORT.md` — LAST, because `stats.warnings` must count 9b's failures
 *
 * I/O discipline (guardrails / spec 02): human progress → stderr, the single result JSON → stdout.
 * The browser is ALWAYS closed (a `finally`), so a fatal navigation error still lets the process
 * exit rather than hang. Navigation and write failures are fatal (thrown ⇒ exit 1 in the action);
 * every other degradation is a recorded warning. Post-processing (stages 6–9) never touches the
 * browser, so it runs after the browser is closed on the captured bytes.
 *
 * Spec: specs/02-clone-engine.md §M1 spine; specs/03-clone-format.md (output contract).
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { OVERRIDES_LOCAL_PATH } from '../analyze/css-sources.js';
import { capturePng, launchCapture, renderScreenshotOfDir } from '../capture/browser.js';
import {
  applyConsentBlocking,
  createConsentBlocker,
  defaultFilterListCachePath,
  httpFilterListDownloader,
  resolveConsentFilterList,
  DEFAULT_FILTER_LIST_URL,
  type ConsentBlockingStatus,
} from '../capture/consent.js';
import { navigateAndSettle, checkRobotsDisallowed, lazyLoadSweep } from '../capture/settle.js';
import { stampDom } from '../capture/stamp.js';
import { serializeDom } from '../capture/serialize.js';
import { sanitizeHtml } from '../localize/html-rewrite.js';
import {
  collectCssUrls,
  collectSrcsetUrls,
  fetchMissing,
  MAX_CSS_IMPORT_DEPTH,
} from '../localize/fetch-missing.js';
import { localizeDocument, type LocalizedAsset } from '../localize/localize.js';
import { isCssResource, isFontResource, isImageResource } from '../localize/media-type.js';
import { beautifyHtml, beautifyCss } from '../output/beautify.js';
import {
  buildManifest,
  manifestJson,
  resourceEntry,
  type ManifestResource,
  type ManifestStats,
} from '../output/manifest.js';
import { COMPLETION_NOTICE, provenanceComment } from '../output/provenance.js';
import { buildReport, fontFilesFrom, type CaptureRow } from '../output/report.js';
import { screenshotPath, writeCloneTree, writePng, writeProjectDocs } from '../output/writer.js';
import { summarizeVerify, verifyClone } from './verify.js';
import { baseSlug, nextFreeSlug } from '../lib/slug.js';
import { PLAYWRIGHT_PIN } from '../lib/pins.js';

/**
 * `page.goto` budget for the `clone-full.png` re-render. Not drawn from `--timeout`: that budget is
 * the LIVE capture's, and it is typically exhausted by the time we get here. The clone is a handful
 * of local files on loopback, so anything slower than this is a real failure, not a slow network.
 */
const CLONE_RERENDER_TIMEOUT_MS = 30_000;

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
  /** `--no-block-cookies` disables consent blocking entirely (spec 02 §M2). */
  blockCookies: boolean;
  /** `--filter-list <file>`: a local adblock list REPLACING the downloaded default consent list. */
  filterList?: string;
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
  return isCssResource(asset.contentType, asset.assetPath);
}

function isFontAsset(asset: LocalizedAsset): boolean {
  return isFontResource(asset.contentType, asset.assetPath);
}

function isImageAsset(asset: LocalizedAsset): boolean {
  return isImageResource(asset.contentType, asset.assetPath);
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
  let consentBlocking: ConsentBlockingStatus = 'disabled';
  let cosmeticSelectors: () => string[] = () => [];
  // Held in memory across the browser teardown: the project dir does not exist until the tree is
  // written, and these are pictures of a page that will no longer exist by then.
  let originalViewportPng: Buffer | undefined;
  let originalFullPng: Buffer | undefined;
  try {
    // Consent blocking (optional, spec 02 §M2) — armed between launch and navigate so the very
    // first document's requests are already filtered. Any failure to obtain or parse a list is a
    // warning, never fatal: a clone with a cookie banner beats no clone at all.
    if (opts.blockCookies) {
      const list = await resolveConsentFilterList({
        ...(opts.filterList !== undefined ? { filterListPath: opts.filterList } : {}),
        cachePath: defaultFilterListCachePath(),
        listUrl: DEFAULT_FILTER_LIST_URL,
        // Bounded by the whole-run budget: a hanging list server must not eat the navigation's time.
        timeoutMs: Math.max(1_000, Math.min(deadline - Date.now(), 10_000)),
        now: Date.now(),
        download: httpFilterListDownloader,
        warnings: capture.warnings,
      });
      if (list === null) {
        consentBlocking = 'unavailable';
      } else {
        try {
          cosmeticSelectors = (await applyConsentBlocking(capture.page, createConsentBlocker(list.text)))
            .cosmeticSelectors;
          consentBlocking = 'enabled';
          process.stderr.write(`design-lens: consent blocking enabled (filter list: ${list.origin})\n`);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          capture.warnings.push(`consent blocking could not be enabled: ${detail}`);
          consentBlocking = 'unavailable';
        }
      }
    }

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
    // `--remove-selector` matches AND everything the consent engine's cosmetic rules matched on this
    // page are REMOVED here (not hidden): a clone is markup, so a `display:none` banner would still
    // be in it. Cosmetic selectors are read now, after settle+sweep, so DOM-derived rules are in.
    elementsStamped = await stampDom(capture.page, [...opts.removeSelectors, ...cosmeticSelectors()]);
    const serialized = await serializeDom(capture.page);
    serializedHtml = serialized.html;
    styleRules = serialized.styleRules;
    canvasConverted = serialized.canvasConverted;
    shadowRootsSerialized = serialized.shadowRootsSerialized;
    // Surface a percy-fallback (or any serializer) warning into the run's warning count.
    capture.warnings.push(...serialized.warnings);
    // Ensure every captured response body has landed in the store before we ask what is MISSING.
    await capture.drainResponses();
    // Refetch uncaptured references (optional stage, spec 02 §M2), through the browser context's
    // request client so every request carries the real Chromium UA — load-bearing for webfont CDNs,
    // which serve a lone TTF to an unknown UA but woff2 to Chrome. Individual URL failures come back
    // in `failed` and become warnings; the localize pass then records them in `manifest.remote[]` as
    // `fetch-failed`. A throw here degrades to ONE warning — a refetch must never block a clone
    // (degradation ladder, spec 02 §Error handling).
    try {
      const refetchTimeout = (): number => Math.max(1_000, Math.min(deadline - Date.now(), 15_000));

      // (a) srcset variants. Chromium requests exactly one candidate — the one matching this
      // viewport and `--dsf` — so every other variant is referenced but never captured. Go back for
      // them so the clone carries ALL candidates, not just the one this capture happened to pick.
      const srcsetMissing = collectSrcsetUrls(serializedHtml, finalUrl).filter(
        (url) => !capture.store.has(url),
      );
      if (srcsetMissing.length > 0) {
        const outcome = await fetchMissing(capture.context.request, srcsetMissing, capture.store, {
          timeoutMs: refetchTimeout(),
          via: 'refetch',
        });
        for (const failure of outcome.failed) {
          capture.warnings.push(`refetch failed: ${failure.url} (${failure.detail})`);
        }
      }

      // (b) CSS-discovered references: an unused `@font-face src`, a `background-image` on an
      // element this capture never painted, a nested `@import`. The browser never requested them,
      // and no DOM attribute names them — only stylesheet text does.
      //
      // This LOOPS because discovery depends on what is in the store: an `@import`ed sheet that was
      // itself uncaptured yields no references until its own bytes arrive. Each round fetches one
      // more level of the chain and re-collects. `attempted` makes the loop strictly monotone (a URL
      // is tried at most once, so a permanently-failing font cannot be retried every round), which
      // together with the round cap guarantees termination.
      const attempted = new Set<string>();
      for (let round = 0; round < MAX_CSS_IMPORT_DEPTH; round++) {
        const cssMissing = collectCssUrls(serializedHtml, finalUrl, capture.store).filter(
          (url) => !capture.store.has(url) && !attempted.has(url),
        );
        if (cssMissing.length === 0) break;
        for (const url of cssMissing) attempted.add(url);
        const outcome = await fetchMissing(capture.context.request, cssMissing, capture.store, {
          timeoutMs: refetchTimeout(),
          via: 'css-fetch',
        });
        for (const failure of outcome.failed) {
          capture.warnings.push(`css-fetch failed: ${failure.url} (${failure.detail})`);
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      capture.warnings.push(`refetch of uncaptured resources failed: ${detail}`);
    }

    // Screenshots of the LIVE page (spec 02 §M3, spec 03 §Directory tree). This is the last use of
    // the browser: the page dies in the `finally` below, so the bytes are held in memory and written
    // after the clone tree lands. A shot failure degrades to a warning — every byte of the clone is
    // already captured, and a missing PNG must not throw away a good clone (degradation ladder).
    //
    // Taken AFTER the refetch stage so a full-page shot (Chromium expands the viewport to take it)
    // cannot race the `store.has()` checks that decide what is missing. Any responses the expansion
    // does trigger are drained below, before the browser closes and the store is read.
    try {
      originalViewportPng = await capturePng(capture.page, false);
      originalFullPng = await capturePng(capture.page, true);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      capture.warnings.push(`original screenshots failed: ${detail}`);
    }
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

  // Template, version lock and the reason the source URL is absent all live in `output/provenance`
  // (ADR-011), which `verify` also reads — so a stamp this line writes can never be one verify rejects.
  const html = `${provenanceComment(capturedAt)}\n${beautifyHtml(localized.html)}\n`;

  const resources: ManifestResource[] = localized.assets.map((asset) =>
    resourceEntry(asset.body, {
      assetPath: asset.assetPath,
      originalUrl: asset.originalUrl,
      contentType: asset.contentType,
      via: asset.via,
    }),
  );

  // --- Write, then photograph what was written, THEN record. ------------------------------------
  // `manifest.json`/`REPORT.md` carry `stats.warnings`, and the clone re-render below can add one,
  // so the provenance documents are rendered last. Otherwise a failed re-render would be announced
  // on stdout but absent from the manifest that claims to describe this capture.
  writeCloneTree({ projectDir, html, assets: localized.assets });

  // Write failures here are fatal (an output-write failure, spec 02 §Error handling); a MISSING
  // buffer just means the shot already degraded to a warning above.
  if (originalViewportPng !== undefined) {
    writePng(screenshotPath(projectDir, 'original-viewport.png'), originalViewportPng);
  }
  if (originalFullPng !== undefined) {
    writePng(screenshotPath(projectDir, 'original-full.png'), originalFullPng);
  }

  // The fidelity check: re-render the clone FROM DISK, exactly as a browser sees it, so a broken
  // asset path shows up as a hole in the picture. Spec 03 is explicit that a failure here is a
  // `warnings[]` entry, never fatal — the clone itself is already on disk and valid.
  try {
    const cloneFullPng = await renderScreenshotOfDir(path.join(projectDir, 'clone'), {
      viewport: opts.viewport,
      deviceScaleFactor: opts.dsf,
      fullPage: true,
      navigationTimeoutMs: CLONE_RERENDER_TIMEOUT_MS,
      settleMs: opts.settleMs,
    });
    writePng(screenshotPath(projectDir, 'clone-full.png'), cloneFullPng);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    capture.warnings.push(`clone re-render screenshot failed: ${detail}`);
  }

  const warnings = capture.warnings.length;

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

  // The clone-format integrity check, run over what was ACTUALLY written (spec 02 §M3: "also run at
  // the end of clone as warnings, not fatal"). `index.html` is re-read from disk so a truncated write
  // is caught; the manifest can only be supplied as text, because it is written below — REPORT.md
  // embeds this very summary, so the documents must be rendered after the check that describes them.
  //
  // Findings are printed as warnings but deliberately do NOT increment `stats.warnings`: that counter
  // is already sealed inside the manifest bytes being verified. Counting a finding about the manifest
  // into the manifest would either need a second write-and-recheck pass or leave the number lying.
  const manifestText = manifestJson(manifest);
  const verifyReport = verifyClone({
    html: fs.readFileSync(path.join(projectDir, 'clone', 'index.html'), 'utf8'),
    manifestText,
    overridesExists: fs.existsSync(path.join(projectDir, OVERRIDES_LOCAL_PATH)),
    resourceExists: (localPath) => fs.existsSync(path.join(projectDir, localPath)),
  });
  for (const check of verifyReport.checks) {
    if (!check.ok) process.stderr.write(`design-lens: warning: verify: ${check.id}: ${check.detail}\n`);
  }

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
      consentBlocking,
      // Derived from the manifest resources, not from `localized.assets`: the report must list the
      // same `clone/assets/…` paths a reader will find in `manifest.json` (spec 10 §Layer 1).
      fontFiles: fontFilesFrom(resources),
    },
    remote: localized.remote,
    // Canvas → data: images and shadow roots → <template> come from the @percy/dom serializer;
    // cross-origin iframe capture is still deferred (spec 02 §M2), so that counter stays 0.
    fidelity: { canvasConverted, shadowRootsSerialized, crossOriginIframes: 0 },
    verify: summarizeVerify(verifyReport),
  });

  // The exact bytes `verifyClone` just parsed — never re-serialize, or the check described one
  // document and the disk holds another.
  writeProjectDocs({ projectDir, manifestJson: manifestText, reportMarkdown });

  process.stderr.write(
    `design-lens: wrote ${resources.length} asset(s) to ${projectDir} (${warnings} warning(s))\n`,
  );
  // Spec 10 §Layer 1: verbatim, on stderr (the human channel — stdout stays machine-only), and LAST,
  // so the ethics notice is the line still on screen when the clone finishes.
  process.stderr.write(`${COMPLETION_NOTICE}\n`);

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
    .option('--no-block-cookies', 'disable consent/cookie-banner blocking')
    .option('--filter-list <file>', 'local adblock filter list, replacing the default consent list')
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
          blockCookies: boolean;
          filterList?: string;
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
            // Likewise `--no-block-cookies` arrives as `options.blockCookies === false`.
            blockCookies: options.blockCookies !== false,
            ...(options.filterList !== undefined ? { filterList: options.filterList } : {}),
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
