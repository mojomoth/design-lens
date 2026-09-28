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
 *   5. shoot `original-viewport.png` + `original-full.png` from the serialized LIVE state
 *   5b. refetch references the render never requested — unused srcset variants and CSS-discovered
 *      assets such as unused `@font-face` faces (localize/fetch-missing) — the last stage that
 *      needs the browser (its request client carries the real Chromium UA)
 *   6. sanitize to an inert document (localize/html-rewrite)
 *   7. localize every captured reference to `assets/…` (localize/localize)
 *   8. beautify HTML + every localized stylesheet (output/beautify)
 *   9. write `clone/` + empty `dl-overrides.css` (output/writer)
 *   9b. after all source attempts, re-render the clone from disk → `screenshots/clone-full.png`
 *   9c. verify the written clone against the format invariants (commands/verify) — warnings, never
 *       fatal (spec 02 §M3); its summary is what REPORT.md renders under `## Verify`
 *   10. write `manifest.json` + `REPORT.md`; append deferred render diagnostics to canonical output
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
import { capturePng, capturePngWithUnreadyFonts, launchCapture, renderScreenshotOfDir } from '../capture/browser.js';
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
import { parseViewport, parseViewports, type Viewport } from '../lib/viewport.js';
import { observePage, type ObservationDocument } from '../analyze/observations.js';
import { evidenceHash, hashTree, type EvidenceDocument, type SourceCapture } from '../capture/evidence.js';
import { stabilize } from '../capture/stabilize.js';
import { captureFrames, embedFrameSnapshots } from '../capture/frames.js';
import { runFidelity } from './fidelity.js';
import {
  collectResourceReferences,
  fetchMissing,
  MAX_CSS_IMPORT_DEPTH,
} from '../localize/fetch-missing.js';
import {
  localizeDocument,
  BYTES_PER_MB,
  DEFAULT_MAX_ASSET_MB,
  type LocalizedAsset,
} from '../localize/localize.js';
import { isCssResource, isFontResource, isImageResource } from '../localize/media-type.js';
import { beautifyHtml, beautifyCss } from '../output/beautify.js';
import {
  buildManifest,
  manifestJson,
  resourceEntry,
  type Manifest,
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

/** Each pending viewport gets a fair share; unused time remains available to later captures. */
export function viewportCaptureDeadline(deadline: number, remainingViewports: number, now = Date.now()): number {
  if (deadline <= now) throw new Error('whole-run capture deadline exhausted before source viewport');
  return now + Math.max(1, Math.floor((deadline - now) / remainingViewports));
}

/** Capture evidence is already sealed when this optional local render starts. */
async function renderCanonicalClone(projectDir: string, options: CloneRunOptions): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const bytes = await renderScreenshotOfDir(path.join(projectDir, 'clone'), {
      viewport: options.viewport,
      deviceScaleFactor: options.dsf,
      fullPage: true,
      navigationTimeoutMs: CLONE_RERENDER_TIMEOUT_MS,
      settleMs: options.settleMs,
      onWarning: (warning) => warnings.push(`clone render: ${warning}`),
    });
    writePng(screenshotPath(projectDir, 'clone-full.png'), bytes);
  } catch (error) {
    warnings.push(`clone re-render screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return warnings;
}

/** Fully-parsed, defaulted clone options (strings from commander are already converted here). */
export interface CloneRunOptions {
  /** `--project <name>` override for the slug; falls back to the URL host. */
  project?: string;
  /** Output root (`--out`), resolved against cwd inside {@link runClone}. */
  out: string;
  /** Render viewport (`--viewport WxH`). */
  viewport: { width: number; height: number };
  /** Independently loaded source states; the first is the editable canonical clone. */
  viewports?: Viewport[];
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
  /** `--max-asset-mb <n>` converted to bytes: larger bodies stay remote as `oversize` (spec 02 §6). */
  maxAssetBytes: number;
  /** `--include-media` localizes `mp4/webm/mp3/pdf/zip` instead of leaving them `media-skipped`. */
  includeMedia: boolean;
}

/** The single JSON line the command prints to stdout on success. */
export interface CloneResult {
  /** Absolute path to `<out>/<slug>`. */
  projectDir: string;
  /** Count of non-fatal warnings recorded during the run. */
  warnings: number;
  fidelity?: 'pass' | 'fail' | 'unverified';
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
type CaptureMetadata = Omit<SourceCapture, 'id' | 'files' | 'snapshot' | 'viewportScreenshot' | 'fullScreenshot'>;
interface SingleCloneResult extends CloneResult { source: CaptureMetadata }

async function runSingleClone(url: string, opts: CloneRunOptions, deadline: number): Promise<SingleCloneResult> {
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
  let observations: ObservationDocument | undefined;
  let sourceComplete = true;
  let browserVersion = '';
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
        timeoutMs: Math.max(1, Math.min(deadline - Date.now(), 10_000)),
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
        await capture.drainResponses(deadline);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        capture.warnings.push(`lazy-load scroll sweep failed: ${detail}`);
      }
    }
    robotsDisallowed = await checkRobotsDisallowed(capture.context, finalUrl, Math.min(3_000, deadline - Date.now()));
    userAgent = await capture.page.evaluate(() => navigator.userAgent);
    // `--remove-selector` matches AND everything the consent engine's cosmetic rules matched on this
    // page are REMOVED here (not hidden): a clone is markup, so a `display:none` banner would still
    // be in it. Cosmetic selectors are read now, after settle+sweep, so DOM-derived rules are in.
    elementsStamped = await stampDom(capture.page, [...opts.removeSelectors, ...cosmeticSelectors()]);
    const embedded = await captureFrames(capture.page, deadline);
    capture.warnings.push(...embedded.warnings);
    const stabilization = await stabilize(capture.page, deadline);
    capture.warnings.push(...stabilization.warnings);
    sourceComplete = stabilization.complete && embedded.warnings.length === 0;
    observations = await observePage(capture.page, { deadline });
    if (opts.noScroll) {
      const deferred = await capture.page.evaluate(() => Array.from(document.querySelectorAll('img, source'))
        .some((element) => (element.hasAttribute('data-src') && !element.getAttribute('src'))
          || (element.hasAttribute('data-srcset') && !element.getAttribute('srcset'))));
      if (deferred) capture.warnings.push('scroll sweep disabled with dormant deferred assets; coverage is incomplete');
    }
    browserVersion = capture.browser.version();
    const serialized = await serializeDom(capture.page);
    serializedHtml = embedFrameSnapshots(serialized.html, embedded.frames);
    styleRules = serialized.styleRules;
    canvasConverted = serialized.canvasConverted;
    shadowRootsSerialized = serialized.shadowRootsSerialized;
    // Surface a percy-fallback (or any serializer) warning into the run's warning count.
    capture.warnings.push(...serialized.warnings);
    // Photograph the same source state immediately after serialization, before optional refetch.
    try {
      if (opts.viewport.width * opts.viewport.height * opts.dsf * opts.dsf > 40_000_000) {
        capture.warnings.push('viewport screenshot pixel limit exceeded; coverage is incomplete');
        sourceComplete = false;
      } else if (observations.width * observations.height * opts.dsf * opts.dsf > 40_000_000) {
        capture.warnings.push('full-page screenshot pixel limit exceeded; coverage is incomplete');
        sourceComplete = false;
        originalViewportPng = await capturePngWithUnreadyFonts(capture.page, false, opts.dsf);
      } else if (stabilization.fonts.status !== 'ready') {
        originalViewportPng = await capturePngWithUnreadyFonts(capture.page, false, opts.dsf);
        originalFullPng = await capturePngWithUnreadyFonts(capture.page, true, opts.dsf);
      } else {
        originalViewportPng = await capturePng(capture.page, false);
        originalFullPng = await capturePng(capture.page, true);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      capture.warnings.push(`original screenshots failed: ${detail}`);
    }
    // Screenshot expansion can start resource requests; settle those before missing-asset discovery.
    await capture.drainResponses(deadline);
    const afterScreenshots = await observePage(capture.page, { deadline });
    if (JSON.stringify(afterScreenshots) !== JSON.stringify(observations)) {
      capture.warnings.push('source state changed before screenshots completed; coverage is inconsistent');
    }
    // Refetch uncaptured references (optional stage, spec 02 §M2), through the browser context's
    // request client so every request carries the real Chromium UA — load-bearing for webfont CDNs,
    // which serve a lone TTF to an unknown UA but woff2 to Chrome. Individual URL failures come back
    // in `failed` and become warnings; the localize pass then records them in `manifest.remote[]` as
    // `fetch-failed`. A throw here degrades to ONE warning — a refetch must never block a clone
    // (degradation ladder, spec 02 §Error handling).
    try {
      const current = await observePage(capture.page, { deadline });
      if (JSON.stringify(current) !== JSON.stringify(observations)) {
        capture.warnings.push('source observations changed after serialization; source state is inconsistent');
      }
      const attempted = new Set<string>();
      for (let round = 0; round < MAX_CSS_IMPORT_DEPTH; round++) {
        const missing = collectResourceReferences(serializedHtml, finalUrl, capture.store)
          .filter((ref) => !capture.store.has(ref.url) && !attempted.has(ref.url));
        if (missing.length === 0) break;
        if (Date.now() >= deadline) {
          capture.warnings.push('resource capture deadline reached; coverage is incomplete');
          break;
        }
        for (const via of ['refetch', 'css-fetch'] as const) {
          const urls = missing.filter((ref) => ref.via === via).map((ref) => ref.url);
          for (const resourceUrl of urls) attempted.add(resourceUrl);
          if (urls.length === 0) continue;
          const outcome = await fetchMissing(capture.context.request, urls, capture.store, {
            timeoutMs: Math.max(1, Math.min(deadline - Date.now(), 15_000)), deadline, via,
          });
          for (const failure of outcome.failed) {
            capture.warnings.push(`${via} failed: ${failure.url} (${failure.detail})`);
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      capture.warnings.push(`refetch of uncaptured resources failed: ${detail}`);
    }
  } finally {
    await capture.browser.close();
  }

  // --- Post-processing (stages 5–8): pure over the captured bytes, no browser needed. ----------
  const inertHtml = sanitizeHtml(serializedHtml);
  const localized = localizeDocument(inertHtml, finalUrl, capture.store, {
    maxAssetBytes: opts.maxAssetBytes,
    includeMedia: opts.includeMedia,
    contentAddressed: opts.viewports !== undefined,
  });

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

  // Persist source evidence now; clone rendering is deferred until all source attempts finish.
  writeCloneTree({ projectDir, html, assets: localized.assets });

  // Write failures here are fatal (an output-write failure, spec 02 §Error handling); a MISSING
  // buffer just means the shot already degraded to a warning above.
  if (originalViewportPng !== undefined) {
    writePng(screenshotPath(projectDir, 'original-viewport.png'), originalViewportPng);
  }
  if (originalFullPng !== undefined) {
    writePng(screenshotPath(projectDir, 'original-full.png'), originalFullPng);
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
    // Count only frames still remote after snapshot/localization, rather than claiming none exist.
    fidelity: { canvasConverted, shadowRootsSerialized, crossOriginIframes: localized.remote.filter((ref) => ref.reason === 'cross-origin-iframe').length },
    warnings: capture.warnings,
    verify: summarizeVerify(verifyReport),
  });

  // The exact bytes `verifyClone` just parsed — never re-serialize, or the check described one
  // document and the disk holds another.
  writeProjectDocs({ projectDir, manifestJson: manifestText, reportMarkdown });

  process.stderr.write(
    `design-lens: wrote ${resources.length} asset(s) to ${projectDir} (${warnings} warning(s))\n`,
  );

  if (!observations) throw new Error('source observation capture did not complete');
  return { projectDir, warnings, source: {
    viewport: opts.viewport, deviceScaleFactor: opts.dsf, capturedAt, browserVersion,
    userAgent, sourceUrl: url, finalUrl,
    policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [...opts.removeSelectors, ...cosmeticSelectors()] },
    observations,
    complete: sourceComplete && observations.complete && !!originalViewportPng && !!originalFullPng
      && capture.warnings.length === 0 && localized.remote.length === 0,
    warnings: [...capture.warnings, ...localized.remote.map((remote) => `remote ${remote.reason}: ${remote.url}`)],
  } };
}

/** Preserve each source independently; later repairs cannot alter the evidence they are judged against. */
export async function runClone(url: string, opts: CloneRunOptions): Promise<CloneResult> {
  const viewports = opts.viewports ?? [opts.viewport];
  const deadline = Date.now() + opts.timeoutMs;
  const primary = await runSingleClone(url, { ...opts, viewport: viewports[0] },
    viewportCaptureDeadline(deadline, viewports.length));
  const evidenceRoot = path.join(primary.projectDir, 'evidence');
  const captures: SourceCapture[] = [];
  let warnings = primary.warnings;
  for (const [index, viewport] of viewports.entries()) {
    const id = `viewport-${viewport.width}x${viewport.height}`;
    let captured = primary;
    const captureDir = path.join(evidenceRoot, id);
    if (index === 0) {
      fs.mkdirSync(captureDir, { recursive: true });
      for (const entry of ['clone', 'screenshots', 'manifest.json', 'REPORT.md']) {
        const source = path.join(primary.projectDir, entry);
        if (fs.existsSync(source)) fs.cpSync(source, path.join(captureDir, entry), { recursive: true, errorOnExist: true });
      }
    } else {
      try {
        captured = await runSingleClone(url, { ...opts, viewport, out: evidenceRoot, project: id },
          viewportCaptureDeadline(deadline, viewports.length - index));
        warnings += captured.warnings;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`design-lens: warning: source viewport ${id} unavailable: ${detail}\n`);
        captures.push({ ...primary.source, id, viewport, complete: false,
          warnings: [`source viewport unavailable: ${detail}`], capturedAt: new Date().toISOString(),
          observations: { viewport, deviceScaleFactor: opts.dsf, width: viewport.width, height: viewport.height,
            rootFontSize: 'unknown', fonts: { status: 'unavailable', failedFamilies: [] }, elements: [],
            complete: false, warnings: [`source viewport unavailable: ${detail}`] },
          snapshot: '', viewportScreenshot: '', fullScreenshot: '', files: [] });
        warnings++;
        continue;
      }
    }
    const prefix = path.relative(primary.projectDir, captureDir).split(path.sep).join('/');
    const files = (await hashTree(captureDir)).map((file) => ({ ...file, path: `${prefix}/${file.path}` }));
    const available = (relative: string): string => files.some((file) => file.path === `${prefix}/${relative}`) ? `${prefix}/${relative}` : '';
    captures.push({ ...captured.source, id, files, snapshot: available('clone/index.html'),
      viewportScreenshot: available('screenshots/original-viewport.png'), fullScreenshot: available('screenshots/original-full.png') });
  }
  const evidence: EvidenceDocument = { schemaVersion: 1, captures };
  fs.writeFileSync(path.join(primary.projectDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const manifestPath = path.join(primary.projectDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  manifest.evidenceHash = evidenceHash(evidence);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // Local rendering cannot consume time reserved for a later live source viewport.
  const renderWarnings = await renderCanonicalClone(primary.projectDir, opts);
  warnings += renderWarnings.length;
  if (renderWarnings.length > 0) {
    manifest.stats.warnings += renderWarnings.length;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const fidelity = await runFidelity(primary.projectDir);
  const reportPath = path.join(primary.projectDir, 'REPORT.md');
  const report = fs.readFileSync(reportPath, 'utf8').replace('## Fidelity notes\n',
    `## Fidelity notes\n${renderWarnings.map((warning) => `- Warning: ${warning.replace(/\s+/g, ' ').trim()}\n`).join('')}- Measured responsive fidelity: ${fidelity.report.status}; see fidelity.json (${captures.length} source viewport(s)).\n`);
  fs.writeFileSync(reportPath, report);
  process.stderr.write(`${COMPLETION_NOTICE}\n`);
  return { projectDir: primary.projectDir, warnings, fidelity: fidelity.report.status };
}

/** Accumulate a repeatable commander option into an array (used by `--remove-selector`). */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
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
    .option('--viewports <list>', 'independent source viewports, e.g. 1440x900,768x1024,390x844')
    .option('--dsf <n>', 'device scale factor', '1')
    .option('--timeout <s>', 'source capture budget in seconds (default: 90 per requested viewport)')
    .option('--settle <ms>', 'extra quiet time after networkidle, in ms', '1500')
    .option('--no-scroll', 'disable the lazy-load scroll sweep before serialization')
    .option('--no-block-cookies', 'disable consent/cookie-banner blocking')
    .option('--filter-list <file>', 'local adblock filter list, replacing the default consent list')
    .option('--remove-selector <css>', 'remove matching elements before capture (repeatable)', collect, [])
    .option('--user-agent <ua>', 'override the Chromium user agent')
    .option(
      '--max-asset-mb <n>',
      'leave bodies larger than this many MiB remote (reason: oversize)',
      String(DEFAULT_MAX_ASSET_MB),
    )
    .option('--include-media', 'localize bulk media (mp4/webm/mp3/pdf/zip) instead of leaving it remote')
    .action(
      async (
        url: string,
        options: {
          project?: string;
          out: string;
          viewport: string;
          viewports?: string;
          dsf: string;
          timeout?: string;
          settle: string;
          scroll: boolean;
          blockCookies: boolean;
          filterList?: string;
          removeSelector: string[];
          userAgent?: string;
          maxAssetMb: string;
          includeMedia?: boolean;
        },
        command: Command,
      ): Promise<void> => {
        try {
          if (options.viewports !== undefined && command.getOptionValueSource('viewport') === 'cli') {
            throw new Error('--viewport and --viewports cannot be used together');
          }
          const viewports = options.viewports === undefined ? undefined : parseViewports(options.viewports);
          const parsed: CloneRunOptions = {
            ...(options.project !== undefined ? { project: options.project } : {}),
            out: options.out,
            viewport: viewports?.[0] ?? parseViewport(options.viewport),
            ...(viewports ? { viewports } : {}),
            dsf: parsePositive(options.dsf, '--dsf'),
            timeoutMs: (options.timeout === undefined ? 90 * (viewports?.length ?? 1) : parsePositive(options.timeout, '--timeout')) * 1000,
            settleMs: Number(options.settle),
            // Commander maps `--no-scroll` to `options.scroll === false`; default is true.
            noScroll: options.scroll === false,
            // Likewise `--no-block-cookies` arrives as `options.blockCookies === false`.
            blockCookies: options.blockCookies !== false,
            ...(options.filterList !== undefined ? { filterList: options.filterList } : {}),
            removeSelectors: options.removeSelector,
            ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
            maxAssetBytes: parsePositive(options.maxAssetMb, '--max-asset-mb') * BYTES_PER_MB,
            // A bare `--include-media` arrives as `true`; absent, commander leaves it undefined.
            includeMedia: options.includeMedia === true,
          };
          if (!Number.isFinite(parsed.settleMs) || parsed.settleMs < 0) throw new Error('--settle must be a non-negative number');
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
