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
 *   3b. readiness (lazy promotion, bounded retries) and freeze (capture/readiness, capture/stabilize);
 *       repeated observe/serialize/photograph attempts until the state is consistent
 *   4. serialize (@percy/dom, own CSSOM walk as fallback) (capture/serialize); painted media becomes
 *      a still under `--media poster` (capture/media)
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
import { stampDom, stampLate } from '../capture/stamp.js';
import { serializeDom } from '../capture/serialize.js';
import { sanitizeHtml } from '../localize/html-rewrite.js';
import { parseViewport, parseViewports, type Viewport } from '../lib/viewport.js';
import { diffObservations, observePage, summarizeObservationDiff, type ObservationDocument } from '../analyze/observations.js';
import { counted, disclosureLine, reconcileBodyReads, type CaptureDisclosure } from '../capture/disclosures.js';
import { evidenceHash, hashTree, type CaptureStabilization, type EvidenceDocument, type SourceCapture } from '../capture/evidence.js';
import {
  collectMediaFacts, restoreFramePosters, setAsideFramePosters, substituteMedia, type MediaPolicy,
} from '../capture/media.js';
import { promoteLazyMedia, type ReadinessPolicy } from '../capture/readiness.js';
import { stabilize, type StabilizationResult } from '../capture/stabilize.js';
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
import { isBulkMediaResource, isCssResource, isFontResource, isImageResource } from '../localize/media-type.js';
import type { ResourceStore } from '../localize/resource-store.js';
import { beautifyHtml, beautifyCss } from '../output/beautify.js';
import {
  buildManifest,
  manifestJson,
  resourceEntry,
  type Manifest,
  type ManifestResource,
  type ManifestStats,
  type ManifestSubstitution,
} from '../output/manifest.js';
import { COMPLETION_NOTICE, provenanceComment } from '../output/provenance.js';
import { buildReport, fontFilesFrom, type CaptureRow, type ReportInput } from '../output/report.js';
import { composeResponsiveClone } from '../output/responsive.js';
import { screenshotPath, writeCloneTree, writePng, writeProjectDocs } from '../output/writer.js';
import { summarizeVerify, verifyClone } from './verify.js';
import { baseSlug, nextFreeSlug } from '../lib/slug.js';
import { PLAYWRIGHT_PIN } from '../lib/pins.js';
import { markPhase, timePhase, timePhaseSync } from '../lib/runlog.js';

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
  /** Independently loaded source states; multiple explicit samples compose the editable canonical clone. */
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
  /** `--media`: `poster` (default) reduces painted media to still pixels; `include` = `includeMedia`. */
  media?: MediaPolicy;
  /** `--lazy-images`: `eager` (default) loads `loading=lazy` images and frames before readiness. */
  lazyImages?: 'eager' | 'native';
  /** `--readiness-ms`: first readiness window in ms (default 5000). */
  readinessMs?: number;
  /** `--readiness-retries`: retries with a doubling window (default 2). */
  readinessRetries?: number;
  /** `--freeze-timers`: freeze page timers after readiness (default off). */
  freezeTimers?: boolean;
  /** `--capture-attempts`: serialize/screenshot attempts until the state is consistent (default 2). */
  captureAttempts?: number;
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
interface SingleCloneResult extends CloneResult { source: CaptureMetadata; report: ReportInput }
/** Captured bytes survive browser teardown; disk processing starts after every live source attempt. */
interface CollectedSource {
  projectDir: string;
  source: CaptureMetadata;
  serializedHtml: string;
  store: ResourceStore;
  styleRules: number;
  canvasConverted: number;
  shadowRootsSerialized: number;
  elementsStamped: number;
  title: string;
  robotsDisallowed: boolean;
  consentBlocking: ConsentBlockingStatus;
  originalViewportPng?: Buffer;
  originalFullPng?: Buffer;
}

/** Fully-defaulted capture stabilization policy (see the clone flags). */
export interface CapturePolicy {
  media: MediaPolicy;
  lazyImages: 'eager' | 'native';
  readinessMs: number;
  readinessRetries: number;
  freezeTimers: boolean;
  captureAttempts: number;
}

/** Programmatic callers may omit every stabilization option; `includeMedia` keeps its meaning. */
export function capturePolicy(opts: CloneRunOptions): CapturePolicy {
  return {
    media: opts.media ?? (opts.includeMedia ? 'include' : 'poster'),
    lazyImages: opts.lazyImages ?? 'eager',
    readinessMs: opts.readinessMs ?? 5_000,
    readinessRetries: opts.readinessRetries ?? 2,
    freezeTimers: opts.freezeTimers === true,
    captureAttempts: opts.captureAttempts ?? 2,
  };
}

/** Readiness retries never spend the part of the per-viewport budget kept for the capture itself. */
export function readinessReserveMs(deadline: number, captureStart: number): number {
  return Math.max(15_000, 0.35 * Math.max(0, deadline - captureStart));
}

/** One disclosure per code: earlier lazy promotions (before frame capture) merge into readiness's. */
function stabilizationDisclosures(
  first: StabilizationResult, final: StabilizationResult, promotedEarly: readonly string[],
): CaptureDisclosure[] {
  const disclosures = first.readiness.disclosures.filter((entry) => entry.code !== 'lazy-promoted');
  const promoted = [...new Set([...promotedEarly, ...first.readiness.promotedLazy])];
  if (promoted.length > 0) {
    disclosures.unshift({ code: 'lazy-promoted', detail: `${counted(promoted.length, 'loading=lazy image or frame was', 'loading=lazy images or frames were')} loaded eagerly before readiness, as the clone loads them`, dlIds: promoted });
  }
  disclosures.push(...final.disclosures.filter((entry) => entry.code === 'smil-paused' || entry.code === 'marquee-stopped'));
  return disclosures;
}

async function collectSingleSource(url: string, opts: CloneRunOptions, deadline: number): Promise<CollectedSource> {
  const capturedAt = new Date().toISOString();
  const captureStart = Date.now();
  const policy = capturePolicy(opts);

  // Resolve a fresh project dir up front — the writer refuses to overwrite, and computing this
  // before touching the browser fails fast on a bad `--out` before a Chromium launch.
  const outAbs = path.resolve(process.cwd(), opts.out);
  const base = baseSlug({ url, project: opts.project });
  const slug = nextFreeSlug(base, (candidate) => fs.existsSync(path.join(outAbs, candidate)));
  const projectDir = path.join(outAbs, slug);

  process.stderr.write(`design-lens: cloning ${url}\n`);

  const capture = await timePhase('launch', () => launchCapture({
    viewport: opts.viewport,
    deviceScaleFactor: opts.dsf,
    ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    freezeTimers: policy.freezeTimers,
  }));

  let serializedHtml = '';
  let styleRules = 0;
  let canvasConverted = 0;
  let shadowRootsSerialized = 0;
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
  let stabilizationRecord: CaptureStabilization | undefined;
  let lateStamped = 0;
  // Held in memory across the browser teardown: the project dir does not exist until the tree is
  // written, and these are pictures of a page that will no longer exist by then.
  let originalViewportPng: Buffer | undefined;
  let originalFullPng: Buffer | undefined;
  try {
    // Consent blocking (optional, spec 02 §M2) — armed between launch and navigate so the very
    // first document's requests are already filtered. Any failure to obtain or parse a list is a
    // warning, never fatal: a clone with a cookie banner beats no clone at all.
    if (opts.blockCookies) {
      const consentStarted = performance.now();
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
      markPhase('consent', performance.now() - consentStarted);
    }

    let settle;
    try {
      settle = await timePhase('navigate', () => navigateAndSettle(capture.page, {
        url,
        gotoTimeoutMs: Math.max(1, deadline - Date.now()),
        settleMs: opts.settleMs,
        deadline,
      }));
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
        await timePhase('sweep', async () => {
          await lazyLoadSweep(capture.page, {
            viewportHeight: opts.viewport.height,
            settleMs: opts.settleMs,
            deadline,
          });
          await capture.drainResponses(deadline);
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        capture.warnings.push(`lazy-load scroll sweep failed: ${detail}`);
      }
    }
    robotsDisallowed = await timePhase('robots', () => checkRobotsDisallowed(capture.context, finalUrl, Math.min(3_000, deadline - Date.now())));
    userAgent = await capture.page.evaluate(() => navigator.userAgent);
    // `--remove-selector` matches AND everything the consent engine's cosmetic rules matched on this
    // page are REMOVED here (not hidden): a clone is markup, so a `display:none` banner would still
    // be in it. Cosmetic selectors are read now, after settle+sweep, so DOM-derived rules are in.
    elementsStamped = await timePhase('stamp', () => stampDom(capture.page, [...opts.removeSelectors, ...cosmeticSelectors()]));
    // Frames must already be loading when their documents are snapshotted.
    const promotedEarly = policy.lazyImages === 'eager' ? await timePhase('promote', () => promoteLazyMedia(capture.page)) : [];
    const readiness: ReadinessPolicy = {
      timeoutMs: policy.readinessMs, retries: policy.readinessRetries, lazyImages: policy.lazyImages,
      reserveMs: readinessReserveMs(deadline, captureStart),
    };
    const embedded = await timePhase('frames', () => captureFrames(capture.page, deadline, { readiness: { ...readiness, retries: 0 } }));
    capture.warnings.push(...embedded.warnings);
    const stabilizeStarted = performance.now();
    const firstStabilization = await stabilize(capture.page, deadline, { readiness, media: policy.media });
    // Readiness and freeze run inside one call; readiness reports its own elapsed time per attempt.
    const stabilizeMs = performance.now() - stabilizeStarted;
    const readinessMs = Math.min(stabilizeMs, firstStabilization.readiness.attempts.reduce((total, entry) => total + entry.elapsedMs, 0));
    markPhase('stabilize-readiness', readinessMs);
    markPhase('stabilize-freeze', stabilizeMs - readinessMs);
    let stabilization = firstStabilization;
    let frozenAnimations = { ...firstStabilization.animations };
    const stabilizationAt = capture.warnings.length;
    capture.warnings.push(...stabilization.warnings);
    if (opts.noScroll) {
      const deferred = await capture.page.evaluate(() => Array.from(document.querySelectorAll('img, source'))
        .some((element) => (element.hasAttribute('data-src') && !element.getAttribute('src'))
          || (element.hasAttribute('data-srcset') && !element.getAttribute('srcset'))));
      if (deferred) capture.warnings.push('scroll sweep disabled with dormant deferred assets; coverage is incomplete');
    }
    browserVersion = capture.browser.version();

    // Observe → serialize → photograph → re-observe. A changed state is re-frozen and captured again
    // (bounded); only the last attempt's artifacts and warnings are kept.
    const stateAttempts: CaptureStabilization['stateAttempts'] = [];
    const lateIds: string[] = [];
    const lateTags = new Map<string, number>();
    let substitutions: ManifestSubstitution[] = [];
    let attemptWarnings: string[] = [];
    const attemptsStarted = performance.now();
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      const warnings: string[] = [];
      let complete = true;
      // Script-inserted nodes (tracking pixels, widgets) are stamped so they stay measurable; removal
      // matches the page re-inserted after the first stamping are removed again first.
      const late = await stampLate(capture.page, [...opts.removeSelectors, ...cosmeticSelectors()]);
      lateIds.push(...late.ids);
      for (const [tag, count] of Object.entries(late.tags)) lateTags.set(tag, (lateTags.get(tag) ?? 0) + count);
      const observed = await observePage(capture.page, { deadline });
      const mediaFacts = policy.media === 'poster' ? await collectMediaFacts(capture.page) : [];
      const framed = mediaFacts.filter((fact) => fact.painted === 'captured-frame' && fact.poster !== null).map((fact) => fact.dlId);
      if (framed.length > 0) await setAsideFramePosters(capture.page, framed);
      let serialized;
      try {
        serialized = await serializeDom(capture.page);
      } finally {
        if (framed.length > 0) await restoreFramePosters(capture.page);
      }
      let html = embedFrameSnapshots(serialized.html, embedded.frames);
      if (policy.media === 'poster') {
        // Before refetch: substituted sources must neither be fetched nor become remote references.
        const substituted = substituteMedia(html, mediaFacts, finalUrl);
        html = substituted.html;
        substitutions = substituted.substitutions;
      }
      // Surface a percy-fallback (or any serializer) warning into the run's warning count.
      warnings.push(...serialized.warnings);
      // Photograph the same source state immediately after serialization, before optional refetch.
      let viewportPng: Buffer | undefined;
      let fullPng: Buffer | undefined;
      try {
        if (opts.viewport.width * opts.viewport.height * opts.dsf * opts.dsf > 40_000_000) {
          warnings.push('viewport screenshot pixel limit exceeded; coverage is incomplete');
          complete = false;
        } else if (observed.width * observed.height * opts.dsf * opts.dsf > 40_000_000) {
          warnings.push('full-page screenshot pixel limit exceeded; coverage is incomplete');
          complete = false;
          viewportPng = await capturePngWithUnreadyFonts(capture.page, false, opts.dsf);
        } else if (stabilization.fonts.status !== 'ready') {
          viewportPng = await capturePngWithUnreadyFonts(capture.page, false, opts.dsf);
          fullPng = await capturePngWithUnreadyFonts(capture.page, true, opts.dsf);
        } else {
          viewportPng = await capturePng(capture.page, false);
          fullPng = await capturePng(capture.page, true);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        warnings.push(`original screenshots failed: ${detail}`);
      }
      // Screenshot expansion can start resource requests; settle those before missing-asset discovery.
      await capture.drainResponses(deadline);
      const afterScreenshots = await observePage(capture.page, { deadline });
      let changed: string | undefined;
      let summary: string | undefined;
      const shotDiff = diffObservations(observed, afterScreenshots);
      if (!shotDiff.equal) {
        summary = summarizeObservationDiff(shotDiff);
        changed = `source state changed before screenshots completed; coverage is inconsistent (${summary})`;
      } else {
        const laterDiff = diffObservations(observed, await observePage(capture.page, { deadline }));
        if (!laterDiff.equal) {
          summary = summarizeObservationDiff(laterDiff);
          changed = `source observations changed after serialization; source state is inconsistent (${summary})`;
        }
      }
      const ms = Date.now() - started;
      stateAttempts.push({ attempt, ms, consistent: changed === undefined, ...(summary !== undefined ? { changed: summary } : {}) });
      observations = observed;
      serializedHtml = html;
      styleRules = serialized.styleRules;
      canvasConverted = serialized.canvasConverted;
      shadowRootsSerialized = serialized.shadowRootsSerialized;
      originalViewportPng = viewportPng;
      originalFullPng = fullPng;
      attemptWarnings = warnings;
      sourceComplete = stabilization.complete && embedded.warnings.length === 0 && complete;
      if (changed === undefined) break;
      if (attempt >= policy.captureAttempts || deadline - Date.now() < 1.5 * ms) {
        attemptWarnings.push(changed);
        break;
      }
      // Re-freeze what the page restarted; readiness already ran once with retries.
      const again = await stabilize(capture.page, deadline, { readiness: { ...readiness, retries: 0 }, media: policy.media });
      capture.warnings.splice(stabilizationAt, stabilization.warnings.length, ...again.warnings);
      frozenAnimations = {
        frozen: frozenAnimations.frozen + again.animations.frozen,
        unsupported: frozenAnimations.unsupported + again.animations.unsupported,
      };
      stabilization = again;
    }
    markPhase('attempts', performance.now() - attemptsStarted);
    capture.warnings.push(...attemptWarnings);
    lateStamped = lateIds.length;
    const suppressedTimers = stabilization.frozen.timers ? await capture.page.evaluate(() => {
      const runtime = (window as unknown as { __designLensCaptureRuntime?: { suppressedTimers?(): number } }).__designLensCaptureRuntime;
      return runtime?.suppressedTimers?.() ?? 0;
    }) : 0;
    // Refetch uncaptured references (optional stage, spec 02 §M2), through the browser context's
    // request client so every request carries the real Chromium UA — load-bearing for webfont CDNs,
    // which serve a lone TTF to an unknown UA but woff2 to Chrome. Individual URL failures come back
    // in `failed` and become warnings; the localize pass then records them in `manifest.remote[]` as
    // `fetch-failed`. A throw here degrades to ONE warning — a refetch must never block a clone
    // (degradation ladder, spec 02 §Error handling).
    const refetchStarted = performance.now();
    try {
      const attempted = new Set<string>();
      for (let round = 0; round < MAX_CSS_IMPORT_DEPTH; round++) {
        const missing = collectResourceReferences(serializedHtml, finalUrl, capture.store)
          .filter((ref) => !capture.store.has(ref.url) && !attempted.has(ref.url))
          // Media left remote by policy must not consume the optional design-asset capture budget.
          .filter((ref) => policy.media === 'include' || !isBulkMediaResource('', new URL(ref.url).pathname));
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
    markPhase('refetch', performance.now() - refetchStarted);
    // After refetch: a body Chromium would not hand back may have been stored from another response.
    const bodyReads = timePhaseSync('reconcile', () => reconcileBodyReads(capture.bodyReadFailures, (resourceUrl) => capture.store.has(resourceUrl)));
    capture.warnings.push(...bodyReads.warnings);

    const disclosures = stabilizationDisclosures(firstStabilization, stabilization, promotedEarly);
    if (substitutions.length > 0) {
      const kinds = [...new Set(substitutions.map((entry) => entry.kind))].join(', ');
      disclosures.push({ code: 'media-substituted', detail: `${counted(substitutions.length, 'media element was', 'media elements were')} reduced to still pixels (${kinds}); their sources stay in data-dl-original-src and are never fetched`, dlIds: substitutions.map((entry) => entry.referencedBy) });
    }
    if (stabilization.frozen.timers) {
      disclosures.push({ code: 'timers-frozen', detail: `timers frozen after readiness; ${suppressedTimers} callbacks suppressed` });
    }
    if (lateIds.length > 0) {
      disclosures.push({ code: 'late-stamped', detail: `${counted(lateIds.length, 'element inserted after stamping was', 'elements inserted after stamping were')} stamped late (${[...lateTags].map(([tag, count]) => `${tag}×${count}`).join(', ')})`, dlIds: lateIds });
    }
    disclosures.push(...bodyReads.disclosures);
    stabilizationRecord = {
      policy: {
        media: policy.media, lazyImages: policy.lazyImages, freezeTimers: policy.freezeTimers,
        readiness: { timeoutMs: policy.readinessMs, retries: policy.readinessRetries }, captureAttempts: policy.captureAttempts,
      },
      readiness: firstStabilization.readiness.attempts,
      stateAttempts,
      frozen: {
        animations: frozenAnimations.frozen, unsupported: frozenAnimations.unsupported, raf: stabilization.frozen.raf,
        timers: { frozen: stabilization.frozen.timers, suppressed: suppressedTimers }, media: stabilization.frozen.media,
        smil: stabilization.frozen.smil.length, marquee: stabilization.frozen.marquee.length,
      },
      substitutions,
      disclosures,
    };
  } finally {
    await timePhase('close', () => capture.browser.close());
  }

  if (!observations) throw new Error('source observation capture did not complete');
  return {
    projectDir, serializedHtml, store: capture.store, styleRules, canvasConverted,
    shadowRootsSerialized, elementsStamped: elementsStamped + lateStamped, title, robotsDisallowed, consentBlocking,
    originalViewportPng, originalFullPng,
    source: {
      viewport: opts.viewport, deviceScaleFactor: opts.dsf, capturedAt, browserVersion,
      userAgent, sourceUrl: url, finalUrl,
      policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [...opts.removeSelectors, ...cosmeticSelectors()] },
      observations,
      complete: sourceComplete && observations.complete && !!originalViewportPng && !!originalFullPng
        && capture.warnings.length === 0,
      warnings: [...capture.warnings],
      ...(stabilizationRecord ? { stabilization: stabilizationRecord } : {}),
    },
  };
}


/** Materialize only captured bytes: CPU work and disk writes cannot spend another source's budget. */
function materializeSingleSource(url: string, opts: CloneRunOptions, collected: CollectedSource): SingleCloneResult {
  const { projectDir, serializedHtml, styleRules, canvasConverted, shadowRootsSerialized,
    elementsStamped, title, robotsDisallowed, consentBlocking, originalViewportPng, originalFullPng } = collected;
  const { capturedAt, finalUrl, userAgent } = collected.source;
  const capture = { store: collected.store, warnings: [...collected.source.warnings] };
  const inertHtml = timePhaseSync('sanitize', () => sanitizeHtml(serializedHtml));
  const localized = timePhaseSync('localize', () => localizeDocument(inertHtml, finalUrl, capture.store, {
    maxAssetBytes: opts.maxAssetBytes,
    includeMedia: capturePolicy(opts).media === 'include',
    contentAddressed: opts.viewports !== undefined,
  }));
  capture.warnings.push(...localized.warnings);

  // Pretty-print every localized stylesheet BEFORE hashing, so the manifest sha256/bytes describe
  // the exact bytes written to disk (fonts/images stay byte-identical to the captured body).
  const beautifyStarted = performance.now();
  for (const asset of localized.assets) {
    if (isCssAsset(asset)) {
      asset.body = Buffer.from(beautifyCss(asset.body.toString('utf8')), 'utf8');
    }
  }

  // Template, version lock and the reason the source URL is absent all live in `output/provenance`
  // (ADR-011), which `verify` also reads — so a stamp this line writes can never be one verify rejects.
  const html = `${provenanceComment(capturedAt)}\n${beautifyHtml(localized.html)}\n`;
  markPhase('beautify', performance.now() - beautifyStarted);

  const resources: ManifestResource[] = localized.assets.map((asset) =>
    resourceEntry(asset.body, {
      assetPath: asset.assetPath,
      originalUrl: asset.originalUrl,
      contentType: asset.contentType,
      via: asset.via,
    }),
  );

  // Persist source evidence now; clone rendering is deferred until all source attempts finish.
  timePhaseSync('write', () => {
    writeCloneTree({ projectDir, html, assets: localized.assets });

    // Write failures here are fatal (an output-write failure, spec 02 §Error handling); a MISSING
    // buffer just means the shot already degraded to a warning above.
    if (originalViewportPng !== undefined) {
      writePng(screenshotPath(projectDir, 'original-viewport.png'), originalViewportPng);
    }
    if (originalFullPng !== undefined) {
      writePng(screenshotPath(projectDir, 'original-full.png'), originalFullPng);
    }
  });
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
    substituted: collected.source.stabilization?.substitutions ?? [],
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
  const verifyReport = timePhaseSync('verify', () => verifyClone({
    html: fs.readFileSync(path.join(projectDir, 'clone', 'index.html'), 'utf8'),
    manifestText,
    overridesExists: fs.existsSync(path.join(projectDir, OVERRIDES_LOCAL_PATH)),
    resourceExists: (localPath) => fs.existsSync(path.join(projectDir, localPath)),
  }));
  for (const check of verifyReport.checks) {
    if (!check.ok) process.stderr.write(`design-lens: warning: verify: ${check.id}: ${check.detail}\n`);
  }

  const report: ReportInput = {
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
    substituted: collected.source.stabilization?.substitutions ?? [],
    // Count only frames still remote after snapshot/localization, rather than claiming none exist.
    fidelity: { canvasConverted, shadowRootsSerialized, crossOriginIframes: localized.remote.filter((ref) => ref.reason === 'cross-origin-iframe').length },
    warnings: capture.warnings,
    disclosures: (collected.source.stabilization?.disclosures ?? []).map(disclosureLine),
    verify: summarizeVerify(verifyReport),
  };
  const reportMarkdown = buildReport(report);

  // The exact bytes `verifyClone` just parsed — never re-serialize, or the check described one
  // document and the disk holds another.
  timePhaseSync('write', () => writeProjectDocs({ projectDir, manifestJson: manifestText, reportMarkdown }));

  process.stderr.write(
    `design-lens: wrote ${resources.length} asset(s) to ${projectDir} (${warnings} warning(s))\n`,
  );

  return { projectDir, warnings, report, source: {
    ...collected.source,
    complete: collected.source.complete && capture.warnings.length === 0 && localized.remote.length === 0,
    warnings: [...capture.warnings, ...localized.remote.map((remote) => `remote ${remote.reason}: ${remote.url}`)],
  } };
}

/** An unavailable viewport inherits identity fields from the primary, never its stabilization record. */
function withoutStabilization(source: CaptureMetadata): CaptureMetadata {
  const copy = { ...source };
  delete copy.stabilization;
  return copy;
}

/** Preserve each source independently; later repairs cannot alter the evidence they are judged against. */
export async function runClone(url: string, opts: CloneRunOptions): Promise<CloneResult> {
  const viewports = opts.viewports ?? [opts.viewport];
  const deadline = Date.now() + opts.timeoutMs;
  const first = await collectSingleSource(url, { ...opts, viewport: viewports[0] },
    viewportCaptureDeadline(deadline, viewports.length));
  const evidenceRoot = path.join(first.projectDir, 'evidence');
  const collected: Array<{ source: CollectedSource } | { error: string; capturedAt: string }> = [{ source: first }];
  // Collect every live state before localization, formatting, writing, or hashing can use CPU time.
  // Optional network refetch remains inside each fair share of the one live-capture deadline.
  for (let index = 1; index < viewports.length; index++) {
    const viewport = viewports[index];
    const id = `viewport-${viewport.width}x${viewport.height}`;
    try {
      collected.push({ source: await collectSingleSource(url, { ...opts, viewport, out: evidenceRoot, project: id },
        viewportCaptureDeadline(deadline, viewports.length - index)) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`design-lens: warning: source viewport ${id} unavailable: ${detail}\n`);
      collected.push({ error: detail, capturedAt: new Date().toISOString() });
    }
  }
  const primary = materializeSingleSource(url, { ...opts, viewport: viewports[0] }, first);
  const captures: SourceCapture[] = [];
  const captureReports: ReportInput[] = [];
  const captureWarnings: string[] = [];
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
      const attempt = collected[index];
      if ('error' in attempt) {
        const detail = attempt.error;
        captures.push({ ...withoutStabilization(primary.source), id, viewport, complete: false,
          warnings: [`source viewport unavailable: ${detail}`], capturedAt: attempt.capturedAt,
          observations: { viewport, deviceScaleFactor: opts.dsf, width: viewport.width, height: viewport.height,
            rootFontSize: 'unknown', fonts: { status: 'unavailable', failedFamilies: [] }, elements: [],
            complete: false, warnings: [`source viewport unavailable: ${detail}`] },
          snapshot: '', viewportScreenshot: '', fullScreenshot: '', files: [] });
        warnings++;
        captureWarnings.push(`${id}: source viewport unavailable: ${detail}`);
        continue;
      }
      captured = materializeSingleSource(url, { ...opts, viewport }, attempt.source);
      warnings += captured.warnings;
    }
    captureReports.push(captured.report);
    captureWarnings.push(...(captured.report.warnings ?? []).map((warning) => viewports.length > 1 ? `${id}: ${warning}` : warning));
    const prefix = path.relative(primary.projectDir, captureDir).split(path.sep).join('/');
    const files = (await timePhase('evidence-hash', () => hashTree(captureDir))).map((file) => ({ ...file, path: `${prefix}/${file.path}` }));
    const available = (relative: string): string => files.some((file) => file.path === `${prefix}/${relative}`) ? `${prefix}/${relative}` : '';
    captures.push({ ...captured.source, id, files, snapshot: available('clone/index.html'),
      viewportScreenshot: available('screenshots/original-viewport.png'), fullScreenshot: available('screenshots/original-full.png') });
  }
  const evidence: EvidenceDocument = { schemaVersion: 1, captures };
  const manifestPath = path.join(primary.projectDir, 'manifest.json');
  let manifest = timePhaseSync('evidence-hash', () => {
    fs.writeFileSync(path.join(primary.projectDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    const sealed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
    sealed.evidenceHash = evidenceHash(evidence);
    fs.writeFileSync(manifestPath, manifestJson(sealed));
    return sealed;
  });
  const compositionWarnings: string[] = [];
  if (opts.viewports && opts.viewports.length > 1) {
    // Every source snapshot and hash is sealed before the canonical document is replaced.
    const composed = await timePhase('compose', () => composeResponsiveClone(primary.projectDir, captures));
    compositionWarnings.push(...composed.warnings.map((warning) => `responsive composition: ${warning}`));
    for (const warning of compositionWarnings) process.stderr.write(`design-lens: warning: ${warning}\n`);
    process.stderr.write(`design-lens: composed ${composed.composition?.variants.length ?? 0} sampled responsive variant(s) (${compositionWarnings.length} warning(s))\n`);
    // The composer adds namespaced resources and updates counters; keep that final manifest.
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  }
  // Local rendering cannot consume time reserved for a later live source viewport.
  const renderWarnings = await timePhase('re-render', () => renderCanonicalClone(primary.projectDir, { ...opts, viewport: viewports[0] }));
  warnings += compositionWarnings.length + renderWarnings.length;
  // Format findings remain outside this counter, as in each individual capture's manifest.
  manifest.stats.warnings = warnings;
  const manifestText = manifestJson(manifest);
  fs.writeFileSync(manifestPath, manifestText);
  const verifyReport = timePhaseSync('verify', () => verifyClone({
    html: fs.readFileSync(path.join(primary.projectDir, 'clone', 'index.html'), 'utf8'),
    manifestText,
    overridesExists: fs.existsSync(path.join(primary.projectDir, OVERRIDES_LOCAL_PATH)),
    resourceExists: (localPath) => fs.existsSync(path.join(primary.projectDir, localPath)),
  }));
  for (const check of verifyReport.checks) {
    if (!check.ok) process.stderr.write(`design-lens: warning: verify: ${check.id}: ${check.detail}\n`);
  }
  const fidelity = await timePhase('fidelity', () => runFidelity(primary.projectDir));
  const resourceRow = (matches: (resource: ManifestResource) => boolean): CaptureRow => {
    const resources = manifest.resources.filter(matches);
    return { count: resources.length, bytes: resources.reduce((total, resource) => total + resource.bytes, 0) };
  };
  const imageResource = (resource: ManifestResource): boolean => isImageResource(resource.contentType, resource.localPath);
  const fontResource = (resource: ManifestResource): boolean => isFontResource(resource.contentType, resource.localPath);
  const cssResource = (resource: ManifestResource): boolean => isCssResource(resource.contentType, resource.localPath);
  const sourceReports = manifest.composition ? captureReports : [primary.report];
  const reportInput: ReportInput = {
    ...primary.report,
    capture: {
      ...primary.report.capture,
      images: resourceRow(imageResource),
      fonts: resourceRow(fontResource),
      css: resourceRow(cssResource),
      other: resourceRow((resource) => !imageResource(resource) && !fontResource(resource) && !cssResource(resource)),
      fontFiles: fontFilesFrom(manifest.resources),
    },
    remote: manifest.remote,
    substituted: manifest.substituted ?? [],
    fidelity: {
      canvasConverted: sourceReports.reduce((total, report) => total + report.fidelity.canvasConverted, 0),
      shadowRootsSerialized: sourceReports.reduce((total, report) => total + report.fidelity.shadowRootsSerialized, 0),
      crossOriginIframes: manifest.remote.filter((remote) => remote.reason === 'cross-origin-iframe').length,
    },
    warnings: [...captureWarnings, ...compositionWarnings, ...renderWarnings],
    disclosures: captures.flatMap((capture) => (capture.stabilization?.disclosures ?? [])
      .map((disclosure) => viewports.length > 1 ? `${capture.id}: ${disclosureLine(disclosure)}` : disclosureLine(disclosure))),
    verify: summarizeVerify(verifyReport),
  };
  const responsiveNote = manifest.composition
    ? `- Responsive sampling warning: ${manifest.composition.variants.length} sampled DOM variant(s); CSS selects the nearest captured width, then height for equal widths, with midpoint ties choosing the larger sample. Intermediate sizes use sampled selection; fidelity verifies only the exact captured viewport sizes.\n`
    : '';
  const diagnosticNote = fidelity.report.status === 'unverified'
    ? '- Diagnostic only: this unverified result does not certify a match, even where individual image or element comparisons pass.\n'
    : '';
  const report = buildReport(reportInput).replace('## Fidelity notes\n',
    `## Fidelity notes\n- Measured responsive fidelity: ${fidelity.report.status}; see fidelity.json (${captures.length} source viewport(s)).\n${responsiveNote}${diagnosticNote}`);
  fs.writeFileSync(path.join(primary.projectDir, 'REPORT.md'), report);
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

/** Parse an integer flag within inclusive bounds, naming the flag in the error. */
function parseBoundedInteger(raw: string, flag: string, min: number, max: number): number {
  const n = Number(raw);
  if (!/^\s*\d+\s*$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`invalid ${flag} "${raw}"; expected an integer from ${min} to ${max}`);
  }
  return n;
}

/** Raw stabilization flag values as commander delivers them. */
export interface StabilizationFlags {
  media?: string;
  includeMedia?: boolean;
  lazyImages?: string;
  readinessMs: string;
  readinessRetries: string;
  freezeTimers?: boolean;
  captureAttempts: string;
}

/** Validate the stabilization flags before any browser starts; throws one actionable message. */
export function parseStabilizationFlags(flags: StabilizationFlags): Required<Pick<CloneRunOptions,
  'includeMedia' | 'media' | 'lazyImages' | 'readinessMs' | 'readinessRetries' | 'freezeTimers' | 'captureAttempts'>> {
  if (flags.media !== undefined && !['remote', 'poster', 'include'].includes(flags.media)) {
    throw new Error(`invalid --media "${flags.media}"; expected remote, poster or include`);
  }
  if (flags.includeMedia === true && flags.media !== undefined && flags.media !== 'include') {
    throw new Error(`--include-media conflicts with --media ${flags.media}; --include-media is an alias of --media include`);
  }
  if (flags.lazyImages !== undefined && !['eager', 'native'].includes(flags.lazyImages)) {
    throw new Error(`invalid --lazy-images "${flags.lazyImages}"; expected eager or native`);
  }
  const media = (flags.includeMedia === true ? 'include' : flags.media ?? 'poster') as MediaPolicy;
  return {
    media,
    includeMedia: media === 'include',
    lazyImages: (flags.lazyImages ?? 'eager') as 'eager' | 'native',
    readinessMs: parseBoundedInteger(flags.readinessMs, '--readiness-ms', 1_000, 600_000),
    readinessRetries: parseBoundedInteger(flags.readinessRetries, '--readiness-retries', 0, 5),
    freezeTimers: flags.freezeTimers === true,
    captureAttempts: parseBoundedInteger(flags.captureAttempts, '--capture-attempts', 1, 4),
  };
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
    .option('--media <mode>', 'media handling: poster (default; painted media becomes still pixels), remote (leave sources remote), include (localize media files)')
    .option('--include-media', 'alias of --media include: localize bulk media (mp4/webm/mp3/pdf/zip)')
    .option('--lazy-images <mode>', 'eager (default; load loading=lazy images and frames before readiness) or native')
    .option('--readiness-ms <ms>', 'first font/image readiness window in ms (at least 1000)', '5000')
    .option('--readiness-retries <n>', 'readiness retries with a doubling window, 0-5', '2')
    .option('--freeze-timers', 'freeze page timers after readiness so timer-driven pages hold still')
    .option('--capture-attempts <n>', 'serialize/screenshot attempts until the source state is consistent, 1-4', '2')
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
        } & StabilizationFlags,
        command: Command,
      ): Promise<void> => {
        try {
          if (options.viewports !== undefined && command.getOptionValueSource('viewport') === 'cli') {
            throw new Error('--viewport and --viewports cannot be used together');
          }
          const viewports = options.viewports === undefined ? undefined : parseViewports(options.viewports);
          const stabilization = parseStabilizationFlags(options);
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
            ...stabilization,
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
