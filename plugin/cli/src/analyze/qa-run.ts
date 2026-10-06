/**
 * `design-lens qa`: render a build (live URL or a static directory) at each viewport and measure
 * the defects screenshots alone did not catch — dead controls, stand-in links, fixed elements over
 * controls, masked overflow, white-square icons, invented numbers — plus, with `--project`, reuse of
 * reference assets/text, Build contract drift, measured lineage and tone. Every flag is validated
 * before a server or browser starts. Review images enforce looking at the screenshots.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import type { Browser, ElementHandle, Page, Request, Response } from 'playwright';
import { PNG } from 'pngjs';

import {
  capturePng, capturePngWithUnreadyFonts, guardFontRequests, waitForFonts, type FontReadiness, type PlaywrightModule,
} from '../capture/browser.js';
import { evidenceHash, resolveEvidencePath, sha256, type EvidenceDocument, type SourceCapture } from '../capture/evidence.js';
import { lazyLoadSweep, navigateAndSettle } from '../capture/settle.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { startStaticServer, type StaticServer } from '../lib/static-server.js';
import { parseViewports, type Viewport } from '../lib/viewport.js';
import type { Manifest, ManifestResource } from '../output/manifest.js';
import { normalizeFontFamily, parseBuildContract, type BuildContract, type BuildContractParse } from './build-contract.js';
import { decodePng, lightnessHistogram } from './pixels.js';
import {
  assetKind, clippedFindings, evaluateSignatureChecks, fontDrift, fontReadiness, glyphFallbackFindings, imageFindings, linkFindings, overlapFindings,
  solidIcon, sourceAssetSeverity, statusOf, toneDrift,
  type FontNetworkFacts, type HeadingGlyphs, type LinkSummary, type QaFinding, type QaSkipped, type QaStatus, type SignatureCheckResult,
} from './qa-checks.js';
import { cloneIdsAt, htmlDlIds, readCloneLineageInputs, retainedRatio, skeletonSimilarity, type BuildLineage, type LineageViewport } from './qa-lineage.js';
import { buildNumberCorpus, contentTexts, unsourcedNumbers, type NumberCorpus } from './qa-numbers.js';
import {
  candidateClip, collectControlCandidates, iconCover, installQaHelpers, measureFixedOverlap, planFixedOverlap, probeQaPage, probeSkeleton, readIconSource,
  startMutationCount, stopMutationCount,
  shadowLinkState,
  type ControlCandidate, type HeadingFont, type IconSource, type LinkFact, type PageFacts, type QaWindow, type SignatureObservation, type SkeletonToken,
} from './qa-probes.js';
import { compareImages, renderReviewImages, sliceTiles, type ReviewImage, type ReviewProof, type ReviewSpec } from './qa-review.js';
import { parseToneDocument, toneProfile, type ToneProfile } from './tone.js';

export const QA_DEFAULT_VIEWPORTS = '1440x900,768x1024,390x844';
export const QA_DEFAULT_MAX_CLICKS = 40;
export const QA_DEFAULT_TIMEOUT_S = 300;
const MAX_ICONS = 60;
const PER_GROUP = 6;
const SETTLE_MS = 300;

export interface QaRawOptions {
  url?: string;
  dir?: string;
  project?: string;
  mode?: string;
  content?: string[];
  brand?: string[];
  viewports?: string;
  out?: string;
  maxClicks?: string;
  timeout?: string;
}

export interface QaContent { path: string; sha256: string; texts: string[] }
export interface QaOptions {
  target: { kind: 'url'; url: string } | { kind: 'dir'; dir: string };
  project: string | null;
  mode: 'derive' | 'clone-base' | null;
  contract: BuildContractParse | null;
  content: QaContent[];
  brands: string[];
  viewports: Viewport[];
  out: string;
  maxClicks: number;
  timeoutMs: number;
  evidence: EvidenceDocument | null;
  manifest: Manifest | null;
  issues: string[];
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return false;
    throw error;
  }
}

export function newQaRunId(now = Date.now()): string {
  return `qa-${now}-${crypto.randomBytes(4).toString('hex')}`;
}

function wholeNumber(raw: string, flag: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`invalid ${flag} "${raw}"; expected a whole number ${min}-${max}`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`invalid ${flag} "${raw}"; expected a whole number ${min}-${max}`);
  return value;
}

/** Evidence parse without re-hashing every file: qa only needs viewports, text and screenshot paths. */
async function readEvidenceLoose(projectDir: string, issues: string[]): Promise<EvidenceDocument | null> {
  const file = path.join(projectDir, 'evidence.json');
  if (!(await isFile(file))) return null;
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<EvidenceDocument>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.captures)) throw new Error('unsupported evidence.json schema');
    return value as EvidenceDocument;
  } catch (error) {
    issues.push(`evidence.json is unreadable: ${message(error)}`);
    return null;
  }
}

async function readManifest(projectDir: string, issues: string[]): Promise<Manifest | null> {
  const file = path.join(projectDir, 'manifest.json');
  if (!(await isFile(file))) { issues.push('manifest.json is missing; source-asset and composed lineage are limited'); return null; }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Manifest;
  } catch (error) {
    issues.push(`manifest.json is unreadable: ${message(error)}`);
    return null;
  }
}

/** All validation and file reads happen here, before any server or browser starts. */
export async function resolveQaOptions(raw: QaRawOptions, cwd: string, now = Date.now()): Promise<QaOptions> {
  const issues: string[] = [];
  if ((raw.url === undefined) === (raw.dir === undefined)) throw new Error('pass exactly one of --url <url> or --dir <buildDir>');
  let target: QaOptions['target'];
  if (raw.url !== undefined) {
    let parsed: URL;
    try { parsed = new URL(raw.url); } catch (error) { throw new Error(`invalid --url "${raw.url}": ${message(error)}`); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`invalid --url "${raw.url}": expected an http(s) URL`);
    target = { kind: 'url', url: parsed.href };
  } else {
    const dir = path.resolve(cwd, raw.dir!);
    if (!(await isFile(path.join(dir, 'index.html')))) throw new Error(`--dir ${dir} must contain index.html`);
    target = { kind: 'dir', dir };
  }
  const project = raw.project === undefined ? null : path.resolve(cwd, raw.project);
  if (project && !(await isFile(path.join(project, 'clone', 'index.html')))) throw new Error(`--project ${project} must contain clone/index.html`);
  if (raw.mode !== undefined && !project) throw new Error('--mode requires --project');
  if (raw.mode !== undefined && raw.mode !== 'derive' && raw.mode !== 'clone-base') throw new Error(`invalid --mode "${raw.mode}"; expected derive or clone-base`);

  const content: QaContent[] = [];
  for (const file of raw.content ?? []) {
    const resolved = path.resolve(cwd, file);
    let bytes: Buffer;
    try { bytes = await fs.readFile(resolved); } catch (error) { throw new Error(`--content ${resolved} is not readable: ${message(error)}`); }
    let texts: string[];
    try { texts = contentTexts(resolved, bytes.toString('utf8')); } catch (error) { throw new Error(`--content ${resolved} is not valid JSON: ${message(error)}`); }
    content.push({ path: resolved, sha256: sha256(bytes), texts });
  }
  const brands = (raw.brand ?? []).map((brand) => brand.trim());
  if (brands.some((brand) => brand === '')) throw new Error('--brand values must not be empty');
  const maxClicks = raw.maxClicks === undefined ? QA_DEFAULT_MAX_CLICKS : wholeNumber(raw.maxClicks, '--max-clicks', 0, 200);
  let timeoutMs = QA_DEFAULT_TIMEOUT_S * 1000;
  if (raw.timeout !== undefined) {
    const seconds = Number(raw.timeout);
    if (!/^\d+(\.\d+)?$/.test(raw.timeout.trim()) || !(seconds > 0) || seconds > 86_400) throw new Error(`invalid --timeout "${raw.timeout}"; expected seconds > 0`);
    timeoutMs = seconds * 1000;
  }

  let contract: BuildContractParse | null = null;
  let evidence: EvidenceDocument | null = null;
  let manifest: Manifest | null = null;
  if (project) {
    const variations = path.join(project, 'VARIATIONS.md');
    contract = (await isFile(variations))
      ? parseBuildContract(await fs.readFile(variations, 'utf8'))
      : { contract: null, checks: [], problems: ['VARIATIONS.md is missing'] };
    evidence = await readEvidenceLoose(project, issues);
    manifest = await readManifest(project, issues);
  }
  const mode = project ? (raw.mode as 'derive' | 'clone-base' | undefined) ?? contract?.contract?.mode ?? 'derive' : null;
  if (raw.mode !== undefined && contract?.contract && contract.contract.mode !== raw.mode) issues.push(`--mode ${raw.mode} overrides the Build contract mode ${contract.contract.mode}`);

  let viewports: Viewport[];
  if (raw.viewports !== undefined) viewports = parseViewports(raw.viewports);
  else if (evidence && evidence.captures.length > 0) {
    const unique = [...new Map(evidence.captures.map((capture) => [`${capture.viewport.width}x${capture.viewport.height}`, capture.viewport])).values()];
    viewports = unique.slice(0, 8).map((viewport) => ({ width: viewport.width, height: viewport.height }));
  } else viewports = parseViewports(QA_DEFAULT_VIEWPORTS);

  const out = raw.out !== undefined ? path.resolve(cwd, raw.out)
    : path.join(project ? path.join(project, 'qa') : path.join(cwd, '.design-lens', 'qa'), newQaRunId(now));
  if (await exists(out)) throw new Error(`output directory ${out} already exists`);
  return { target, project, mode, contract, content, brands, viewports, out, maxClicks, timeoutMs, evidence, manifest, issues };
}

const key = (viewport: Viewport): string => `${viewport.width}x${viewport.height}`;

export interface ControlSummary { candidates: number; clicked: number; live: number; dead: number; skipped: number }

export interface QaViewportReport {
  viewport: string;
  document: { width: number; height: number };
  fonts: FontReadiness;
  screenshots: { viewport: string | null; full: string | null };
  links: LinkSummary;
  /** Click-probed control candidates: how many were found, clicked, responded, were dead or skipped. */
  controls: ControlSummary;
  tone: ToneProfile | null;
  referenceTone: (ToneProfile & { captureId: string }) | null;
  resolvedFonts: Array<{ family: string; elements: number }>;
  findings: QaFinding[];
  timings: Record<string, number>;
}

export interface QaReport {
  schemaVersion: 1;
  generatedAt: string;
  url: string;
  dir: string | null;
  project: string | null;
  mode: 'derive' | 'clone-base' | null;
  status: QaStatus;
  counts: { fail: number; warn: number };
  content: Array<{ path: string; sha256: string }>;
  viewports: QaViewportReport[];
  signatureChecks: SignatureCheckResult[];
  lineage: BuildLineage | null;
  contract: BuildContract | null;
  review: { images: ReviewImage[]; proof: ReviewProof | null };
  skipped: QaSkipped[];
  issues: string[];
}

export interface QaRunResult { report: QaReport; out: string; reviewPaths: string[] }

interface ReferenceImage { capture: SourceCapture; bytes: Buffer; tone: ToneProfile }

interface ViewportOutcome {
  report: QaViewportReport;
  skipped: QaSkipped[];
  facts: PageFacts | null;
  full: Buffer | null;
  shot: Buffer | null;
  skeleton: SkeletonToken[] | null;
}

interface RunContext {
  options: QaOptions;
  url: string;
  origin: string;
  corpus: NumberCorpus | null;
  manifestBySha: Map<string, ManifestResource>;
  assetMatches: Set<string>;
  sourceTexts: Set<string>;
  references: Map<number, ReferenceImage>;
  issues: string[];
  log(line: string): void;
}

function normalizeText(text: string): string { return text.replace(/\s+/g, ' ').trim().toLowerCase(); }

function sourceAssetFinding(context: RunContext, resource: ManifestResource, where: string, viewport: string): QaFinding | null {
  const kind = assetKind(resource.contentType, resource.localPath);
  if (!kind) return null;
  if (context.assetMatches.has(resource.sha256)) return null;
  context.assetMatches.add(resource.sha256);
  const { severity, note } = sourceAssetSeverity(kind, resource.originalUrl, context.options.mode ?? 'derive', context.options.contract?.contract?.fonts ?? []);
  return { check: 'source-asset', severity, viewport, selector: null, text: where, detail: `${where} is byte-identical to the reference ${kind} ${resource.localPath} (from ${resource.originalUrl}): ${note}` };
}

async function hashBuildDir(dir: string, issues: string[]): Promise<Array<{ file: string; sha: string }>> {
  const result: Array<{ file: string; sha: string }> = [];
  const pending = [''];
  while (pending.length > 0) {
    if (result.length >= 5000) { issues.push('source-asset: only the first 5000 build files were hashed'); break; }
    const relative = pending.pop()!;
    const entries = await fs.readdir(path.join(dir, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== '.git') pending.push(child); continue; }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(dir, child));
      if (stat.size > 64 * 1024 * 1024) { issues.push(`source-asset: ${child} is larger than 64 MiB and was not hashed`); continue; }
      result.push({ file: child, sha: sha256(await fs.readFile(path.join(dir, child))) });
    }
  }
  return result;
}

async function referenceImages(options: QaOptions, issues: string[], skipped: QaSkipped[]): Promise<Map<number, ReferenceImage>> {
  const result = new Map<number, ReferenceImage>();
  if (!options.project) return result;
  const project = options.project;
  let tone: ReturnType<typeof parseToneDocument> | null = null;
  if (options.evidence && (await isFile(path.join(project, 'tone.json')))) {
    try {
      const parsed = parseToneDocument(JSON.parse(await fs.readFile(path.join(project, 'tone.json'), 'utf8')) as unknown);
      if (parsed.evidenceHash === evidenceHash(options.evidence)) tone = parsed;
      else issues.push('tone.json is stale (evidence changed); reference tone is measured from the evidence images');
    } catch (error) {
      issues.push(`tone.json is unreadable: ${message(error)}`);
    }
  }
  for (const viewport of options.viewports) {
    const capture = options.evidence?.captures.find((item) => item.viewport.width === viewport.width && item.fullScreenshot !== '');
    if (!capture) {
      skipped.push({ check: 'tone', viewport: key(viewport), reason: `no reference capture ${viewport.width}px wide in evidence.json`, affectsStatus: false });
      continue;
    }
    try {
      const entry = capture.files.find((file) => file.path === capture.fullScreenshot);
      if (!entry) throw new Error(`${capture.fullScreenshot} is not integrity protected`);
      const bytes = await fs.readFile(await resolveEvidencePath(project, capture.fullScreenshot));
      if (sha256(bytes) !== entry.sha256) throw new Error(`${capture.fullScreenshot} hash mismatch; recapture with clone-reference`);
      const fresh = tone?.captures.find((item) => item.captureId === capture.id && item.image.sha256 === entry.sha256)?.profile;
      result.set(viewport.width, { capture, bytes, tone: fresh ?? toneProfile(decodePng(bytes), capture.deviceScaleFactor) });
    } catch (error) {
      issues.push(`reference image for ${capture.id}: ${message(error)}`);
      skipped.push({ check: 'tone', viewport: key(viewport), reason: `reference image unavailable: ${message(error)}`, affectsStatus: false });
    }
  }
  return result;
}

const helpers = (page: Page): Promise<void> => page.evaluate(installQaHelpers);

async function elementAt(page: Page, index: number, selector: string): Promise<ElementHandle<Element> | null> {
  await helpers(page);
  const handle = await page.evaluateHandle(({ index, selector }) => {
    const qa = (window as unknown as QaWindow).__designLensQa;
    const element = qa?.elements(false)[index] ?? null;
    return element && qa?.path(element) === selector ? element : null;
  }, { index, selector });
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element;
}

async function restorePage(page: Page, url: string): Promise<void> {
  await navigateAndSettle(page, { url, gotoTimeoutMs: 30_000, settleMs: 200, deadline: Date.now() + 3000 });
  await helpers(page);
}

function differingPixels(before: Buffer, after: Buffer): number {
  const left = decodePng(before);
  const right = decodePng(after);
  if (left.width !== right.width || left.height !== right.height) return left.width * left.height + 1;
  return pixelmatch(left.data, right.data, undefined, left.width, left.height, { threshold: 0.1 });
}

interface PageEvents { navigations: number; popups: number; dialogs: number }

async function probeControl(page: Page, url: string, candidate: ControlCandidate, events: PageEvents): Promise<{ dead: boolean; detail: string } | { skipped: string }> {
  let handle = await elementAt(page, candidate.index, candidate.selector);
  if (!handle) {
    await restorePage(page, url);
    handle = await elementAt(page, candidate.index, candidate.selector);
    if (!handle) return { skipped: 'control could not be found again after re-navigation' };
  }
  try {
    await handle.scrollIntoViewIfNeeded({ timeout: 2000 });
    await handle.hover({ timeout: 2000 });
    await page.waitForTimeout(300);
    const clip = await page.evaluate(candidateClip, { index: candidate.index, container: candidate.container, controls: candidate.controls });
    if (!clip) return { skipped: 'control is outside the viewport after scrolling' };
    const area = { x: clip.x, y: clip.y, width: clip.width, height: clip.height };
    const before = await page.screenshot({ clip: area, animations: 'disabled', caret: 'hide', timeout: 5000 });
    await page.evaluate(startMutationCount);
    await page.waitForTimeout(400);
    const control = await page.evaluate(stopMutationCount);
    const startUrl = page.url();
    const counts = { ...events };
    await page.evaluate(startMutationCount);
    await handle.click({ timeout: 2000 });
    await page.waitForTimeout(400);
    const navigated = events.navigations !== counts.navigations || page.url() !== startUrl;
    if (navigated || events.popups !== counts.popups || events.dialogs !== counts.dialogs) {
      if (navigated) await restorePage(page, url);
      return { dead: false, detail: navigated ? 'navigated' : 'opened a window or dialog' };
    }
    const state = await page.evaluate(() => window.scrollY);
    const clicked = await page.evaluate(stopMutationCount);
    const after = await page.screenshot({ clip: area, animations: 'disabled', caret: 'hide', timeout: 5000 });
    const pixels = differingPixels(before, after);
    const dead = state === clip.scrollY && clicked - control <= 0 && pixels === 0;
    return { dead, detail: `same URL, scrollY ${state}, ${clicked} mutation(s) after the click vs ${control} in a 400 ms no-click window, ${pixels} differing pixel(s) in the control area` };
  } catch (error) {
    if (page.url() !== url) await restorePage(page, url);
    return { skipped: `click failed: ${message(error).split('\n')[0]}` };
  } finally {
    await handle.dispose();
  }
}

async function checkControls(page: Page, url: string, viewport: string, maxClicks: number, deadline: number, events: PageEvents): Promise<{ findings: QaFinding[]; skipped: QaSkipped[]; summary: ControlSummary }> {
  const findings: QaFinding[] = [];
  const skipped: QaSkipped[] = [];
  const summary: ControlSummary = { candidates: 0, clicked: 0, live: 0, dead: 0, skipped: 0 };
  await helpers(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const candidates = await page.evaluate(collectControlCandidates, PER_GROUP);
  const selected = candidates.slice(0, maxClicks);
  summary.candidates = candidates.length;
  summary.skipped = candidates.length - selected.length;
  if (candidates.length > selected.length) skipped.push({ check: 'dead-control', viewport, reason: `${candidates.length - selected.length} candidate(s) beyond --max-clicks ${maxClicks} were not clicked`, affectsStatus: false });
  for (let index = 0; index < selected.length; index += 1) {
    if (Date.now() >= deadline) {
      skipped.push({ check: 'dead-control', viewport, reason: `deadline reached; ${selected.length - index} control(s) were not clicked`, affectsStatus: true });
      summary.skipped += selected.length - index;
      break;
    }
    const candidate = selected[index];
    const outcome = await probeControl(page, url, candidate, events);
    if ('skipped' in outcome) {
      skipped.push({ check: 'dead-control', viewport, reason: `${candidate.selector}: ${outcome.skipped}`, affectsStatus: false });
      summary.skipped += 1;
      continue;
    }
    summary.clicked += 1;
    if (outcome.dead) summary.dead += 1;
    else summary.live += 1;
    if (outcome.dead) {
      findings.push({
        check: 'dead-control', severity: 'fail', viewport, selector: candidate.selector, ...(candidate.text ? { text: candidate.text } : {}), rect: candidate.rect,
        detail: `${candidate.group !== null ? 'tab-like group member' : 'clickable-looking control'} does nothing when clicked: ${outcome.detail}`,
      });
    } else if (!candidate.focusable) {
      findings.push({
        check: 'inaccessible-control', severity: 'warn', viewport, selector: candidate.selector, ...(candidate.text ? { text: candidate.text } : {}), rect: candidate.rect,
        detail: 'responds to clicks but cannot be reached with the keyboard (not focusable); use a button or add tabindex and key handling',
      });
    }
  }
  return { findings, skipped, summary };
}

/**
 * Clicks each visible link whose fragment target exists only in its own shadow root (≤ 20) and
 * returns the indices whose click scrolled that target into the viewport: a script makes those
 * links work, while fragment navigation alone never reaches a shadow root.
 */
async function reachableShadowLinks(page: Page, url: string, links: readonly LinkFact[], viewportHeight: number, issues: string[]): Promise<Set<number>> {
  const reachable = new Set<number>();
  const candidates = links.filter((link) => link.targetInShadow && !link.targetExists && link.visible && link.targetId).slice(0, 20);
  if (candidates.length === 0) return reachable;
  const start = page.url();
  const withoutHash = (value: string): string => value.replace(/#.*$/, '');
  for (const link of candidates) {
    const handle = await elementAt(page, link.index, link.selector);
    if (!handle) continue;
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
      const before = await page.evaluate(shadowLinkState, { index: link.index, id: link.targetId! });
      await handle.click({ timeout: 2000 });
      await page.waitForTimeout(400);
      if (withoutHash(page.url()) !== withoutHash(start)) { await restorePage(page, url); continue; }
      const after = await page.evaluate(shadowLinkState, { index: link.index, id: link.targetId! });
      const inView = after.targetTop !== null && after.targetTop >= -2 && after.targetTop < viewportHeight / 2;
      const alreadyThere = before.targetTop !== null && Math.abs(before.targetTop) <= 2;
      if (inView && (after.scrollY !== before.scrollY || alreadyThere)) reachable.add(link.index);
    } catch (error) {
      issues.push(`stand-in-link: ${link.selector} could not be clicked: ${message(error).split('\n')[0]}`);
    } finally {
      await handle.dispose();
    }
  }
  await page.evaluate((original) => { history.replaceState(history.state, '', original); window.scrollTo(0, 0); }, start);
  return reachable;
}

/**
 * Fonts that painted each display heading's glyphs, read through CDP (≤ 20 headings). Only headings
 * that resolve to a loaded web font listed in display-fonts are measured: there `isCustomFont`
 * separates the display face from platform fallbacks.
 */
async function headingGlyphs(page: Page, headings: readonly HeadingFont[], contract: BuildContract, issues: string[]): Promise<HeadingGlyphs[]> {
  const display = new Set(contract.displayFonts.map(normalizeFontFamily));
  const measured = headings.filter((heading) => heading.loaded && display.has(normalizeFontFamily(heading.family))).slice(0, 20);
  if (measured.length === 0) return [];
  const session = await page.context().newCDPSession(page);
  const result: HeadingGlyphs[] = [];
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    await session.send('DOM.getDocument', { depth: -1, pierce: true });
    for (const heading of measured) {
      const evaluated = await session.send('Runtime.evaluate', { expression: `window.__designLensQa && window.__designLensQa.elements(false)[${heading.index}]` });
      if (!evaluated.result.objectId) continue;
      const { nodeId } = await session.send('DOM.requestNode', { objectId: evaluated.result.objectId });
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      result.push({ selector: heading.selector, family: heading.family, fonts: fonts.map((font) => ({ familyName: font.familyName, isCustomFont: font.isCustomFont, glyphCount: font.glyphCount })) });
    }
  } catch (error) {
    issues.push(`font-drift: heading glyph coverage could not be read: ${message(error).split('\n')[0]}`);
  } finally {
    await session.detach();
  }
  return result;
}

async function checkIcons(page: Page, facts: PageFacts, viewport: string): Promise<{ findings: QaFinding[]; skipped: QaSkipped[] }> {
  const findings: QaFinding[] = [];
  const skipped: QaSkipped[] = [];
  if (facts.icons.length > MAX_ICONS) skipped.push({ check: 'solid-icon', viewport, reason: `${facts.icons.length - MAX_ICONS} image(s) beyond the ${MAX_ICONS}-icon budget were not checked`, affectsStatus: false });
  for (const icon of facts.icons.slice(0, MAX_ICONS)) {
    const handle = await elementAt(page, icon.index, icon.selector);
    if (!handle) { skipped.push({ check: 'solid-icon', viewport, reason: `${icon.selector}: image could not be found again`, affectsStatus: false }); continue; }
    try {
      // A fixed or sticky overlay painted over the icon would be photographed instead of the icon.
      const cover = await page.evaluate(iconCover, icon.index);
      if (cover) {
        skipped.push({ check: 'solid-icon', viewport, reason: `${icon.selector}: icon covered by ${cover}; not measured`, affectsStatus: false });
        continue;
      }
      const rendered = lightnessHistogram(decodePng(await handle.screenshot({ animations: 'disabled', timeout: 5000 })), { insetRatio: 0.15 });
      if (rendered.modalShare < 0.98) continue;
      const source: IconSource = await page.evaluate(readIconSource, icon.index);
      if (source.status !== 'ok') {
        skipped.push({ check: 'solid-icon', viewport, reason: `${icon.selector}: source pixels ${source.status} (${source.reason})`, affectsStatus: false });
        continue;
      }
      const png = new PNG({ width: source.width, height: source.height });
      Buffer.from(source.data, 'base64').copy(png.data);
      const original = lightnessHistogram(png, { insetRatio: 0.15, background: source.background });
      if (solidIcon(rendered, original)) {
        findings.push({
          check: 'solid-icon', severity: 'fail', viewport, selector: icon.selector, rect: icon.rect,
          detail: `renders as one flat tone (modal share ${rendered.modalShare.toFixed(3)}) although the image has detail (modal share ${original.modalShare.toFixed(3)} on its background); a CSS filter or mask is flattening it`,
        });
      }
    } catch (error) {
      skipped.push({ check: 'solid-icon', viewport, reason: `${icon.selector}: ${message(error).split('\n')[0]}`, affectsStatus: false });
    } finally {
      await handle.dispose();
    }
  }
  return { findings, skipped };
}

function numberFindings(facts: PageFacts, corpus: NumberCorpus, viewport: string): QaFinding[] {
  const grouped = new Map<string, { finding: QaFinding; count: number }>();
  for (const { token, severity } of unsourcedNumbers(facts.stream, corpus)) {
    const id = `${severity}|${token.raw.toLowerCase()}`;
    const known = grouped.get(id);
    if (known) { known.count += 1; continue; }
    const anchor = facts.anchors.find((item) => token.start >= item.start && token.start < item.end)
      ?? facts.anchors.find((item) => token.end > item.start && token.start < item.end);
    const what = token.date ? 'date/time' : token.cls === 'unitless' ? `number ${token.value}` : `${token.cls} ${token.value}`;
    grouped.set(id, {
      count: 1,
      finding: {
        check: 'unsourced-number', severity, viewport, selector: anchor?.selector ?? null, text: token.raw, ...(anchor ? { rect: anchor.rect } : {}),
        detail: `"${token.raw}" (${what}) is not stated in the --content files`,
      },
    });
  }
  return [...grouped.values()].map(({ finding, count }) => (count > 1 ? { ...finding, detail: `${finding.detail} (${count} occurrences)` } : finding));
}

function textFindings(facts: PageFacts, context: RunContext, viewport: string): QaFinding[] {
  const findings: QaFinding[] = [];
  if (context.sourceTexts.size > 0) {
    const seen = new Set<string>();
    const candidates: Array<{ text: string; selector: string; rect?: QaFinding['rect']; where: string }> = [
      ...facts.directTexts.map((item) => ({ text: item.text, selector: item.selector, rect: item.rect, where: 'text' })),
      ...facts.attributes.filter((item) => ['alt', 'title', 'aria-label'].includes(item.name) && item.value.trim().length >= 24)
        .map((item) => ({ text: item.value, selector: item.selector, where: `${item.name} attribute` })),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate.text).slice(0, 500);
      if (!context.sourceTexts.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      findings.push({ check: 'source-text', severity: 'fail', viewport, selector: candidate.selector, text: candidate.text.slice(0, 80), ...(candidate.rect ? { rect: candidate.rect } : {}), detail: `${candidate.where} repeats the reference page's copy verbatim; write the target's own copy` });
    }
  }
  for (const brand of context.options.brands) {
    const needle = brand.toLowerCase();
    const places: string[] = [];
    if (facts.stream.toLowerCase().includes(needle)) places.push('visible text');
    if (facts.title.toLowerCase().includes(needle)) places.push('document title');
    const attributes = facts.attributes.filter((item) => item.value.toLowerCase().includes(needle));
    for (const attribute of attributes.slice(0, 5)) places.push(`${attribute.name} of ${attribute.selector}`);
    if (places.length === 0) continue;
    findings.push({ check: 'brand-residue', severity: 'fail', viewport, selector: attributes[0]?.selector ?? null, text: brand, detail: `source brand "${brand}" appears in ${places.join(', ')}${attributes.length > 5 ? ` and ${attributes.length - 5} more attribute(s)` : ''}` });
  }
  return findings;
}

async function runViewport(browser: Browser, context: RunContext, viewport: Viewport, deadline: number): Promise<ViewportOutcome> {
  const label = key(viewport);
  const { options } = context;
  const timings: Record<string, number> = {};
  const started = Date.now();
  const time = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try { return await run(); } finally { timings[name] = Date.now() - start; }
  };
  const findings: QaFinding[] = [];
  const skipped: QaSkipped[] = [];
  const report: QaViewportReport = {
    viewport: label, document: { width: 0, height: 0 }, fonts: { status: 'unavailable', failedFamilies: [] }, screenshots: { viewport: null, full: null },
    links: { total: 0, inPage: 0, standIn: 0 }, controls: { candidates: 0, clicked: 0, live: 0, dead: 0, skipped: 0 }, tone: null, referenceTone: null, resolvedFonts: [], findings, timings,
  };
  const outcome: ViewportOutcome = { report, skipped, facts: null, full: null, shot: null, skeleton: null };
  const browserContext = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  const consoleErrors = new Set<string>();
  const failedRequests = new Map<string, { sameOrigin: boolean; reason: string }>();
  const fontFacts: FontNetworkFacts = { status: 'unavailable', failedFamilies: [], networkFailures: [], httpFailures: [] };
  const bodyHashes: Array<Promise<void>> = [];
  let collecting = true;
  // Status of the main document while the initial navigation runs (redirects end on the last hop).
  let documentStatus: { status: number; url: string } | null = null;
  let initialNavigation = true;
  const events: PageEvents = { navigations: 0, popups: 0, dialogs: 0 };
  try {
    const page = await browserContext.newPage();
    browserContext.on('page', (popup) => {
      if (popup === page) return;
      events.popups += 1;
      popup.close().catch((error: unknown) => context.issues.push(`${label}: could not close a popup: ${message(error)}`));
    });
    page.on('dialog', (dialog) => {
      events.dialogs += 1;
      dialog.dismiss().catch((error: unknown) => context.issues.push(`${label}: could not dismiss a dialog: ${message(error)}`));
    });
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) events.navigations += 1; });
    // Each message names where it came from (script URL and line), so a warning can be acted on.
    // Same-origin URLs are written as paths: `--dir` serves on a random port, and details stay comparable across runs.
    const where = (url: string, line: number, column: number): string =>
      (url ? ` (at ${url.startsWith(`${context.origin}/`) ? url.slice(context.origin.length) : url}:${line + 1}:${column + 1})` : '');
    page.on('console', (entry) => {
      if (entry.type() !== 'error' || consoleErrors.size >= 50) return;
      const location = entry.location();
      consoleErrors.add(`${entry.text().slice(0, 300)}${where(location.url, location.lineNumber, location.columnNumber)}`);
    });
    page.on('pageerror', (error) => {
      if (consoleErrors.size >= 50) return;
      const frame = /\bat (?:.*? \()?((?:https?|file):\/\/[^\s)]+?):(\d+):(\d+)\)?$/m.exec(error.stack ?? '');
      consoleErrors.add(`uncaught ${error.name}: ${error.message.slice(0, 300)}${frame ? where(frame[1], Number(frame[2]) - 1, Number(frame[3]) - 1) : ''}`);
    });
    const sameOrigin = (request: Request): boolean => {
      try { return new URL(request.url()).origin === context.origin; } catch (error) { if (error instanceof TypeError) return false; throw error; }
    };
    page.on('requestfailed', (request) => {
      const reason = request.failure()?.errorText ?? 'failed';
      if (request.resourceType() === 'font') fontFacts.networkFailures.push({ url: request.url(), crossOrigin: !sameOrigin(request) });
      if (reason === 'net::ERR_ABORTED' || request.url().startsWith('data:')) return;
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) return;
      failedRequests.set(request.url(), { sameOrigin: sameOrigin(request), reason });
    });
    page.on('response', (response: Response) => {
      const request = response.request();
      if (initialNavigation && request.isNavigationRequest() && request.frame() === page.mainFrame()) documentStatus = { status: response.status(), url: response.url() };
      if (response.status() >= 400) {
        if (request.resourceType() === 'font') fontFacts.httpFailures.push(`${response.status()} ${response.url()}`);
        if (!(request.isNavigationRequest() && request.frame() === page.mainFrame())) failedRequests.set(response.url(), { sameOrigin: sameOrigin(request), reason: `HTTP ${response.status()}` });
        return;
      }
      if (context.manifestBySha.size === 0 || response.status() < 200 || response.status() >= 300 || response.url().startsWith('data:')) return;
      bodyHashes.push(response.body().then((body) => {
        if (!collecting) return;
        const resource = context.manifestBySha.get(sha256(body));
        if (!resource) return;
        const finding = sourceAssetFinding(context, resource, response.url(), label);
        if (finding && collecting) findings.push(finding);
      }, (error: unknown) => { if (collecting) context.issues.push(`${label}: response body of ${response.url()} could not be hashed: ${message(error)}`); }));
    });
    const guard = await guardFontRequests(page);
    try {
      await time('navigate', () => navigateAndSettle(page, { url: context.url, gotoTimeoutMs: Math.max(1000, Math.min(60_000, deadline - Date.now())), settleMs: SETTLE_MS, deadline }));
    } catch (error) {
      skipped.push({ check: 'navigation', viewport: label, reason: `could not load ${context.url}: ${message(error).split('\n')[0]}`, affectsStatus: true });
      return outcome;
    }
    initialNavigation = false;
    const loaded = documentStatus as { status: number; url: string } | null;
    if (loaded && loaded.status >= 400) {
      findings.push({ check: 'navigation', severity: 'fail', viewport: label, selector: null, text: loaded.url, detail: `main document returned HTTP ${loaded.status} (${loaded.url}); qa measured an error page, not the build` });
    }
    const fonts = await time('fonts', () => waitForFonts(page, guard));
    report.fonts = fonts;
    if (Date.now() < deadline) {
      try {
        await time('sweep', () => lazyLoadSweep(page, { viewportHeight: viewport.height, settleMs: SETTLE_MS, deadline }));
      } catch (error) {
        if (Date.now() >= deadline || /deadline/i.test(message(error))) skipped.push({ check: 'lazy-load', viewport: label, reason: `scroll sweep cut by the deadline: ${message(error)}`, affectsStatus: true });
        else context.issues.push(`${label}: lazy-load sweep: ${message(error)}`);
      }
    } else skipped.push({ check: 'lazy-load', viewport: label, reason: 'deadline reached before the scroll sweep', affectsStatus: true });

    // A phase that throws is recorded as unverified work; later phases still run.
    const phase = async (check: string, name: string, run: () => Promise<void>, gated = false): Promise<void> => {
      if (gated && Date.now() >= deadline) {
        skipped.push({ check, viewport: label, reason: `deadline reached before ${name}`, affectsStatus: true });
        return;
      }
      try {
        await time(name, run);
      } catch (error) {
        skipped.push({ check, viewport: label, reason: `${name} could not run: ${message(error).split('\n')[0]}`, affectsStatus: true });
      }
    };
    const contract = options.contract?.contract;
    fontFacts.status = fonts.status;
    fontFacts.failedFamilies = fonts.failedFamilies;
    const readiness = fontReadiness(fontFacts, label);
    if (readiness.finding) findings.push(readiness.finding);
    if (readiness.skipped) skipped.push(readiness.skipped);
    await phase('probes', 'probes', async () => {
      await helpers(page);
      const checks = contract?.checks ?? [];
      const facts = await page.evaluate(probeQaPage, { checks: checks.map((check) => ({ selector: check.selector, property: check.property })) });
      outcome.facts = facts;
      if (options.mode === 'clone-base') outcome.skeleton = await page.evaluate(probeSkeleton);
      report.document = { width: facts.document.width, height: facts.document.height };
      const reachable = await reachableShadowLinks(page, context.url, facts.links, viewport.height, context.issues);
      const links = linkFindings(facts.links, label, reachable);
      report.links = links.summary;
      findings.push(...links.findings);
      if (facts.document.scrollWidth > facts.document.innerWidth + 1) {
        findings.push({ check: 'horizontal-overflow', severity: 'fail', viewport: label, selector: 'html', detail: `document scrollWidth ${facts.document.scrollWidth}px exceeds the ${facts.document.innerWidth}px viewport; the page scrolls sideways` });
      }
      findings.push(...clippedFindings(facts.clipped, label), ...imageFindings(facts.images, label));
      if (context.corpus) findings.push(...numberFindings(facts, context.corpus, label));
      findings.push(...textFindings(facts, context, label));
      report.resolvedFonts = facts.fonts.map((use) => ({ family: use.family, elements: use.elements }));
      if (contract) {
        findings.push(...fontDrift(facts.fonts, facts.headings, contract, label));
        findings.push(...glyphFallbackFindings(await headingGlyphs(page, facts.headings, contract, context.issues), label));
      }
    });
    await phase('screenshots', 'screenshots', async () => {
      const ready = fonts.status === 'ready';
      outcome.shot = ready ? await capturePng(page, false) : await capturePngWithUnreadyFonts(page, false, 1);
      outcome.full = ready ? await capturePng(page, true) : await capturePngWithUnreadyFonts(page, true, 1);
      const shotPath = `screenshots/${label}-viewport.png`;
      const fullPath = `screenshots/${label}-full.png`;
      await fs.writeFile(path.join(options.out, shotPath), outcome.shot, { flag: 'wx' });
      await fs.writeFile(path.join(options.out, fullPath), outcome.full, { flag: 'wx' });
      report.screenshots = { viewport: shotPath, full: fullPath };
    });
    if (outcome.full) {
      const full = outcome.full;
      await phase('tone', 'tone', async () => {
        report.tone = toneProfile(decodePng(full), 1);
        const reference = context.references.get(viewport.width);
        if (reference) report.referenceTone = { captureId: reference.capture.id, ...reference.tone };
        if (contract) findings.push(...toneDrift(report.tone, contract, label));
      });
    }
    const facts = outcome.facts;
    if (facts) {
      await phase('solid-icon', 'icons', async () => {
        const icons = await checkIcons(page, facts, label);
        findings.push(...icons.findings);
        skipped.push(...icons.skipped);
      }, true);
    }
    await phase('fixed-overlap', 'overlap', async () => {
      await helpers(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const plan = await page.evaluate(planFixedOverlap);
      if (plan.capped) skipped.push({ check: 'fixed-overlap', viewport: label, reason: 'more than 40 scroll positions; controls were evaluated at the nearest of 40', affectsStatus: false });
      const measured = [];
      for (const position of plan.positions) {
        if (Date.now() >= deadline) { skipped.push({ check: 'fixed-overlap', viewport: label, reason: 'deadline reached during scroll positions', affectsStatus: true }); break; }
        measured.push(...await page.evaluate(measureFixedOverlap, position));
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      findings.push(...overlapFindings(measured, label));
    }, true);
    await phase('dead-control', 'controls', async () => {
      const controls = await checkControls(page, context.url, label, options.maxClicks, deadline, events);
      findings.push(...controls.findings);
      skipped.push(...controls.skipped);
      report.controls = controls.summary;
    }, true);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(bodyHashes), new Promise((resolve) => { timer = setTimeout(resolve, 10_000); })]);
    clearTimeout(timer);
    collecting = false;
    for (const text of consoleErrors) findings.push({ check: 'console-error', severity: 'warn', viewport: label, selector: null, detail: text });
    for (const [url, failure] of failedRequests) {
      findings.push({ check: 'request-failed', severity: failure.sameOrigin ? 'fail' : 'warn', viewport: label, selector: null, text: url, detail: `${failure.sameOrigin ? 'same-origin' : 'cross-origin'} request failed: ${failure.reason} ${url}` });
    }
  } finally {
    // Body reads still pending after an early return must not add findings or issues to a finished viewport.
    collecting = false;
    await browserContext.close();
    timings.total = Date.now() - started;
  }
  return outcome;
}

async function skeletonOfClone(browser: Browser, projectDir: string, viewports: readonly Viewport[], issues: string[]): Promise<Map<string, SkeletonToken[]>> {
  const result = new Map<string, SkeletonToken[]>();
  let server: StaticServer | null = null;
  try {
    server = await startStaticServer(path.join(projectDir, 'clone'), { contentSecurityPolicy: "script-src 'none'" });
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.route('**/*', (route) => (route.request().url().startsWith(server!.origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort()));
        await page.goto(server.url('/index.html'), { waitUntil: 'load', timeout: 30_000 });
        result.set(key(viewport), await page.evaluate(probeSkeleton));
      } catch (error) {
        issues.push(`clone skeleton at ${key(viewport)}: ${message(error).split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await server?.close();
  }
  return result;
}

async function servedIds(url: string, issues: string[]): Promise<Set<string>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return htmlDlIds(await response.text());
  } catch (error) {
    issues.push(`lineage: served HTML could not be fetched (${message(error)}); only live shadow DOM ids were counted`);
    return new Set();
  }
}

async function measureLineage(browser: Browser, context: RunContext, outcomes: readonly ViewportOutcome[], findings: Map<string, QaFinding[]>): Promise<BuildLineage | null> {
  const { options } = context;
  if (!options.project || !options.mode) return null;
  const clone = await readCloneLineageInputs(options.project, options.manifest);
  const build = await servedIds(context.url, context.issues);
  for (const outcome of outcomes) for (const id of outcome.facts?.dlIds ?? []) build.add(id);
  const skeletons = options.mode === 'clone-base' ? await skeletonOfClone(browser, options.project, options.viewports, context.issues) : new Map<string, SkeletonToken[]>();
  const viewports: LineageViewport[] = options.viewports.map((viewport, index) => {
    const ids = cloneIdsAt(clone.composition, clone.ids, viewport.width);
    const { retained, ratio } = retainedRatio(build, ids);
    const entry: LineageViewport = { viewport: key(viewport), cloneIds: ids.size, retainedIds: retained, retainedRatio: ratio };
    const cloneSkeleton = skeletons.get(key(viewport));
    const buildSkeleton = outcomes[index]?.skeleton;
    if (cloneSkeleton && buildSkeleton) {
      entry.skeleton = { clone: cloneSkeleton.map((token) => token.columns), build: buildSkeleton.map((token) => token.columns), similarity: skeletonSimilarity(cloneSkeleton, buildSkeleton) };
    }
    return entry;
  });
  const first = key(options.viewports[0]);
  const add = (viewport: string, finding: QaFinding): void => { findings.get(viewport)?.push(finding); };
  if (options.mode === 'clone-base') {
    const best = viewports.reduce((left, right) => (right.retainedRatio > left.retainedRatio ? right : left), viewports[0]);
    if (best && best.retainedRatio < 0.3) {
      add(best.viewport, { check: 'lineage', severity: 'fail', viewport: best.viewport, selector: null, detail: `clone-base build retains only ${best.retainedIds} of ${best.cloneIds} clone markup ids (best ratio ${best.retainedRatio} < 0.3); build on the copied clone or switch the Build contract to derive` });
    }
    for (const entry of viewports) {
      if (entry.skeleton && entry.skeleton.similarity < 0.5) {
        add(entry.viewport, { check: 'lineage', severity: 'warn', viewport: entry.viewport, selector: null, detail: `section skeleton similarity to the clone is ${entry.skeleton.similarity} (< 0.5): columns per section clone [${entry.skeleton.clone.join(',')}] vs build [${entry.skeleton.build.join(',')}]` });
      }
    }
  } else if (build.size > 0) {
    add(first, { check: 'lineage', severity: 'fail', viewport: first, selector: null, detail: `derived build contains clone markup ids (${build.size} data-dl-id value(s)); derive builds must not copy clone markup` });
  }
  // The composed clone inlines its captured CSS; the Build contract's `stylesheets` claim is measured here.
  const capturedStyleBlocks = Math.max(0, ...outcomes.map((outcome) => outcome.facts?.capturedStyles ?? 0));
  if (capturedStyleBlocks > 0) {
    const declared = options.contract?.contract?.stylesheets;
    const blocks = `${capturedStyleBlocks} captured reference style block(s) (style[data-dl-captured-styles])`;
    if (options.mode === 'derive') add(first, { check: 'source-asset', severity: 'fail', viewport: first, selector: 'style[data-dl-captured-styles]', detail: `${blocks} copied into a derived build` });
    else if (declared === 'rewritten') add(first, { check: 'source-asset', severity: 'fail', viewport: first, selector: 'style[data-dl-captured-styles]', detail: `the Build contract says stylesheets rewritten, but ${blocks} remain; rewrite them or record stylesheets retained` });
    else add(first, { check: 'source-asset', severity: 'warn', viewport: first, selector: 'style[data-dl-captured-styles]', detail: `${blocks} retained inline: reference stylesheet retained; rewrite it or confirm reuse rights before deploying` });
  }
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), url: context.url, project: options.project, mode: options.mode,
    clone: { indexSha256: clone.indexSha256, dlIdCount: clone.ids.size }, build: { dlIdCount: build.size, capturedStyleBlocks }, viewports,
  };
}

function reviewSpecs(options: QaOptions, outcomes: readonly ViewportOutcome[], references: Map<number, ReferenceImage>): ReviewSpec[] {
  const widths = options.viewports.map((viewport) => viewport.width);
  const widest = Math.max(...widths);
  const narrowest = Math.min(...widths);
  const order = options.viewports.map((viewport, index) => ({ viewport, outcome: outcomes[index] })).sort((left, right) => right.viewport.width - left.viewport.width);
  const specs: ReviewSpec[] = [];
  for (const { viewport, outcome } of order) {
    const label = key(viewport);
    if (!outcome?.full || !outcome.shot) continue;
    const edge = viewport.width === widest || viewport.width === narrowest;
    if (edge) {
      sliceTiles(outcome.full, viewport.height).forEach((tile, index) => {
        specs.push({ file: `review/${label}-tile-${String(index + 1).padStart(2, '0')}.png`, kind: 'tile', viewport: label, top: tile.top, bottom: tile.bottom, images: [tile.image] });
      });
    } else {
      specs.push({ file: `review/${label}-viewport.png`, kind: 'viewport', viewport: label, top: 0, bottom: viewport.height, images: [outcome.shot] });
    }
    const reference = references.get(viewport.width);
    if (edge && reference) {
      specs.push({ file: `review/${label}-compare.png`, kind: 'compare', viewport: label, top: 0, bottom: outcome.report.document.height, images: compareImages(reference.bytes, outcome.full) });
    }
  }
  return specs;
}

/** Runs every check, writes the qa directory, and returns the report (status decides the exit code). */
export async function runQa(options: QaOptions, log: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): Promise<QaRunResult> {
  const started = Date.now();
  const runDeadline = started + options.timeoutMs;
  const issues = [...options.issues];
  const skipped: QaSkipped[] = [];
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.mkdir(options.out);
  await fs.mkdir(path.join(options.out, 'screenshots'));
  if (options.content.length === 0) skipped.push({ check: 'unsourced-number', reason: 'no --content files were given; numbers cannot be checked against the facts', affectsStatus: true });
  if (options.project && !options.contract?.contract) {
    skipped.push({ check: 'contract', reason: `Build contract unavailable: ${(options.contract?.problems ?? ['VARIATIONS.md is missing']).join('; ')}`, affectsStatus: true });
  }
  const manifestBySha = new Map<string, ManifestResource>();
  for (const resource of options.manifest?.resources ?? []) if (resource.sha256) manifestBySha.set(resource.sha256, resource);
  const sourceTexts = new Set<string>();
  for (const capture of options.evidence?.captures ?? []) {
    for (const element of capture.observations?.elements ?? []) {
      const text = normalizeText(element.text ?? '');
      if (text.length >= 24) sourceTexts.add(text.slice(0, 500));
    }
  }
  const references = await referenceImages(options, issues, skipped);
  let server: StaticServer | null = null;
  let browser: Browser | null = null;
  const outcomes: ViewportOutcome[] = [];
  const extra = new Map<string, QaFinding[]>(options.viewports.map((viewport) => [key(viewport), []]));
  let lineage: BuildLineage | null = null;
  let images: ReviewImage[] = [];
  let proof: ReviewProof | null = null;
  let url: string;
  try {
    if (options.target.kind === 'dir') {
      server = await startStaticServer(options.target.dir);
      url = server.url('/index.html');
    } else url = options.target.url;
    const context: RunContext = {
      options, url, origin: new URL(url).origin, corpus: options.content.length > 0 ? buildNumberCorpus(options.content.flatMap((item) => item.texts)) : null,
      manifestBySha, assetMatches: new Set<string>(), sourceTexts, references, issues, log,
    };
    const first = key(options.viewports[0]);
    if (options.target.kind === 'dir' && manifestBySha.size > 0) {
      for (const file of await hashBuildDir(options.target.dir, issues)) {
        const resource = manifestBySha.get(file.sha);
        if (!resource) continue;
        const finding = sourceAssetFinding(context, resource, file.file, first);
        if (finding) extra.get(first)!.push(finding);
      }
    }
    const { chromium } = loadRuntimeDep<PlaywrightModule>('playwright');
    browser = await chromium.launch({ headless: true });
    const reserve = Math.min(60_000, options.timeoutMs * 0.2);
    for (const [index, viewport] of options.viewports.entries()) {
      const remaining = Math.max(0, runDeadline - reserve - Date.now());
      const deadline = Date.now() + remaining / (options.viewports.length - index);
      log(`design-lens: qa ${key(viewport)}: checking ${url}`);
      const outcome = await runViewport(browser, context, viewport, deadline);
      outcomes.push(outcome);
      skipped.push(...outcome.skipped);
    }
    const contract = options.contract?.contract;
    let signatureChecks: SignatureCheckResult[] = [];
    if (contract && contract.checks.length > 0) {
      const observations = outcomes.filter((outcome) => outcome.facts).map((outcome) => ({ viewport: outcome.report.viewport, results: outcome.facts!.signatures as SignatureObservation[] }));
      signatureChecks = evaluateSignatureChecks(contract.checks, observations);
      for (const result of signatureChecks.filter((item) => !item.pass)) {
        extra.get(first)!.push({ check: 'signature-check', severity: 'fail', viewport: first, selector: result.selector, detail: `rank ${result.rank}: ${result.selector} :: ${result.property} ${result.op} ${result.value} holds at no viewport (observed ${JSON.stringify(result.observed)})` });
      }
    }
    lineage = await measureLineage(browser, context, outcomes, extra);
    ({ images, proof } = await renderReviewImages(browser, options.out, reviewSpecs(options, outcomes, references)));
    for (const outcome of outcomes) outcome.report.findings.push(...(extra.get(outcome.report.viewport) ?? []));
    for (const [viewport, list] of extra) {
      if (!outcomes.some((outcome) => outcome.report.viewport === viewport) && list.length > 0) issues.push(`${list.length} finding(s) for ${viewport} had no viewport report`);
    }
    const findings = outcomes.flatMap((outcome) => outcome.report.findings);
    const report: QaReport = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), url, dir: options.target.kind === 'dir' ? options.target.dir : null,
      project: options.project, mode: options.mode, status: statusOf(findings, skipped),
      counts: { fail: findings.filter((finding) => finding.severity === 'fail').length, warn: findings.filter((finding) => finding.severity === 'warn').length },
      content: options.content.map((item) => ({ path: item.path, sha256: item.sha256 })),
      viewports: outcomes.map((outcome) => outcome.report), signatureChecks, lineage, contract: contract ?? null,
      review: { images, proof }, skipped, issues,
    };
    await fs.writeFile(path.join(options.out, 'qa.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    if (lineage) await fs.writeFile(path.join(options.out, 'build-lineage.json'), `${JSON.stringify(lineage, null, 2)}\n`, { flag: 'wx' });
    return { report, out: options.out, reviewPaths: images.map((image) => path.join(options.out, image.path)) };
  } finally {
    await browser?.close();
    await server?.close();
  }
}
