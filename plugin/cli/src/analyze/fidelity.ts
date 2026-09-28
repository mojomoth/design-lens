/// <reference lib="dom" />

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import * as cheerio from 'cheerio';
import * as csstree from 'css-tree';
import type { Browser, Page } from 'playwright';

import type { PlaywrightModule } from '../capture/browser.js';
import { stabilize } from '../capture/stabilize.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { startStaticServer } from '../lib/static-server.js';
import {
  evidenceHash, hashTree, readEvidence, resolveEvidencePath, sha256,
  type EvidenceFile, type SourceCapture,
} from '../capture/evidence.js';
import { observePage, type ElementObservation, type ObservationDocument } from './observations.js';

/** Policy is recorded in every report; callers cannot lower tolerances to obtain a pass. */
export const FIDELITY_POLICY = {
  threshold: 0.1,
  includeAA: false,
  imageMismatchRatio: 0.005,
  regionMismatchRatio: 0.01,
  geometryToleranceCssPx: 1,
} as const;

export type FidelityStatus = 'pass' | 'fail' | 'unverified';

export interface ImageComparison {
  status: 'pass' | 'fail';
  source: { width: number; height: number };
  clone: { width: number; height: number };
  mismatchedPixels: number | null;
  mismatchRatio: number | null;
  limit: number;
  reason?: string;
  diff?: string;
}

export interface ElementComparison {
  sourceId: string;
  cloneId: string | null;
  semantic: string;
  status: 'pass' | 'fail';
  issues: string[];
  maxGeometryDelta: number | null;
  image?: ImageComparison;
}

export interface CaptureComparison {
  captureId: string;
  viewport: { width: number; height: number };
  status: FidelityStatus;
  /** Incomplete but intact evidence can explain differences without certifying a match. */
  diagnosticOnly?: boolean;
  issues: string[];
  viewportImage?: ImageComparison;
  fullImage?: ImageComparison;
  elements: ElementComparison[];
  observations?: ObservationDocument;
  screenshots?: { viewport: string; full: string };
}

export interface FidelityReport {
  schemaVersion: 1;
  generatedAt: string;
  status: FidelityStatus;
  policy: typeof FIDELITY_POLICY;
  evidenceHash: string | null;
  cloneHash: string | null;
  /** Composition metadata participates in comparison identity independently of clone bytes. */
  compositionHash?: string | null;
  cloneFiles: EvidenceFile[];
  captures: CaptureComparison[];
  issues: string[];
  /** Passive pixels alone cannot satisfy the editable, inert clone contract. */
  inertIssues: string[];
}

export interface FidelityResult {
  report: FidelityReport;
  json: string;
}

/** Decode exact pixels; a dimension mismatch is a failure, never a request to scale the images. */
export function comparePng(
  sourceBytes: Buffer,
  cloneBytes: Buffer,
  limit: number = FIDELITY_POLICY.imageMismatchRatio,
): { comparison: ImageComparison; diff: Buffer | null } {
  const source = PNG.sync.read(sourceBytes);
  const clone = PNG.sync.read(cloneBytes);
  const dimensions = {
    source: { width: source.width, height: source.height },
    clone: { width: clone.width, height: clone.height },
  };
  if (source.width !== clone.width || source.height !== clone.height) {
    return {
      comparison: {
        ...dimensions, status: 'fail', mismatchedPixels: null, mismatchRatio: null,
        limit, reason: 'image dimensions differ; images were not resized',
      },
      diff: null,
    };
  }
  const difference = new PNG({ width: source.width, height: source.height });
  const mismatchedPixels = pixelmatch(
    source.data, clone.data, difference.data, source.width, source.height,
    { threshold: FIDELITY_POLICY.threshold, includeAA: FIDELITY_POLICY.includeAA },
  );
  const mismatchRatio = mismatchedPixels / (source.width * source.height);
  return {
    comparison: { ...dimensions, status: mismatchRatio <= limit ? 'pass' : 'fail', mismatchedPixels, mismatchRatio, limit },
    diff: PNG.sync.write(difference),
  };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** IDs are scoped to a source capture. Semantic evidence must agree before any node can match. */
function identity(element: ElementObservation): string {
  return JSON.stringify([element.tag, element.semantic, normalizedText(element.text)]);
}

function ancestors(element: ElementObservation, elements: readonly ElementObservation[]): string {
  const byId = new Map(elements.map((candidate) => [candidate.dlId, candidate]));
  const parts: string[] = [];
  const visited = new Set<string>();
  let parentId = element.parentDlId;
  while (parentId && !visited.has(parentId) && parts.length < 5) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    // Parent text is deliberately excluded: an unrelated sibling edit should not lose identity.
    parts.push(`${parent.tag}:${parent.semantic}`);
    parentId = parent.parentDlId;
  }
  return JSON.stringify([element.rootPath, parts]);
}

/** Structural subset of the responsive manifest, validated before granting correspondence. */
export interface FidelityComposition {
  schemaVersion: 1;
  boundaryPolicy: 'nearest-width-then-height';
  variants: Array<{ captureId: string; viewport: { width: number; height: number }; media: string; hostId: string; rootId: string; bodyId: string }>;
  elements: Array<{ dlId: string; captureId: string; sourceId: string }>;
  warnings: string[];
}

type CaptureIdentity = Pick<SourceCapture, 'id' | 'viewport'>;

/** Invalid or incomplete metadata never enables a fallback to DOM-claimed provenance. */
export function validateFidelityComposition(value: unknown, captures?: readonly CaptureIdentity[]): FidelityComposition {
  const object = (entry: unknown): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry);
  const id = (entry: unknown): entry is string => typeof entry === 'string' && /^dl-[1-9][0-9]*$/.test(entry);
  const invalid = (): never => { throw new Error('invalid responsive composition metadata'); };
  if (!object(value) || value.schemaVersion !== 1 || value.boundaryPolicy !== 'nearest-width-then-height'
      || !Array.isArray(value.variants) || value.variants.length === 0 || !Array.isArray(value.elements)
      || !Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')) return invalid();
  const captureIds = new Set<string>();
  const canonicalIds = new Set<string>();
  for (const variant of value.variants) {
    if (!object(variant) || typeof variant.captureId !== 'string' || !variant.captureId || captureIds.has(variant.captureId)
        || typeof variant.media !== 'string' || !variant.media || !object(variant.viewport)
        || !Number.isSafeInteger(variant.viewport.width) || Number(variant.viewport.width) <= 0
        || !Number.isSafeInteger(variant.viewport.height) || Number(variant.viewport.height) <= 0) return invalid();
    captureIds.add(variant.captureId);
    for (const key of ['hostId', 'rootId', 'bodyId']) {
      const canonical = variant[key];
      if (!id(canonical) || canonicalIds.has(canonical)) return invalid();
      canonicalIds.add(canonical);
    }
    if (captures && !captures.some((capture) => capture.id === variant.captureId
      && capture.viewport.width === (variant.viewport as Record<string, unknown>).width
      && capture.viewport.height === (variant.viewport as Record<string, unknown>).height)) return invalid();
  }
  if (captures && (captures.length !== captureIds.size || captures.some((capture) => !captureIds.has(capture.id)))) return invalid();
  const sourceIds = new Set<string>();
  for (const element of value.elements) {
    if (!object(element) || !id(element.dlId) || !id(element.sourceId) || typeof element.captureId !== 'string'
        || !captureIds.has(element.captureId) || canonicalIds.has(element.dlId)) return invalid();
    const qualified = JSON.stringify([element.captureId, element.sourceId]);
    if (sourceIds.has(qualified)) return invalid();
    canonicalIds.add(element.dlId);
    sourceIds.add(qualified);
  }
  return value as unknown as FidelityComposition;
}

function recordedRootPath(source: ElementObservation, captureId: string, composition: FidelityComposition): string[] | null {
  const variant = composition.variants.find((entry) => entry.captureId === captureId);
  if (!variant) return null;
  const roots = source.rootPath.map((sourceId) => composition.elements.find((entry) => entry.captureId === captureId && entry.sourceId === sourceId)?.dlId);
  return roots.some((id) => !id) ? null : [variant.hostId, ...roots as string[]];
}

export function matchObservation(
  source: ElementObservation,
  sourceElements: readonly ElementObservation[],
  cloneElements: readonly ElementObservation[],
  captureId?: string,
  composition?: FidelityComposition,
): { element: ElementObservation | null; reason?: string } {
  const key = identity(source);
  if (composition) {
    const mapping = composition.elements.filter((entry) => entry.captureId === captureId && entry.sourceId === source.dlId);
    if (mapping.length !== 1) return { element: null, reason: 'recorded capture-qualified source mapping is missing or ambiguous' };
    const mapped = cloneElements.filter((element) => element.dlId === mapping[0].dlId);
    if (mapped.length !== 1) return { element: null, reason: mapped.length === 0 ? 'recorded canonical source element is missing' : 'ambiguous canonical source identity' };
    const actual = mapped[0];
    const expectedRoot = captureId ? recordedRootPath(source, captureId, composition) : null;
    if (!expectedRoot || JSON.stringify(actual.rootPath) !== JSON.stringify(expectedRoot)) {
      return { element: null, reason: 'mapped source element is outside its recorded shadow root path' };
    }
    if (actual.generated || (actual.source && (actual.source.captureId !== captureId || actual.source.dlId !== source.dlId))) {
      return { element: null, reason: 'DOM provenance disagrees with the recorded source mapping' };
    }
    if (!actual.visible || identity(actual) !== key) return { element: null, reason: 'mapped source element is hidden or its semantic content differs' };
    return { element: actual };
  }
  // Legacy matching ignores untrusted provenance attributes; only a manifest can grant exemptions.
  const candidates = cloneElements.filter((element) => element.visible && identity(element) === key);
  if (candidates.length === 0) return { element: null, reason: 'visible semantic element is missing' };
  const context = ancestors(source, sourceElements);
  const contextual = candidates.filter((element) => ancestors(element, cloneElements) === context);
  if (contextual.length === 1) return { element: contextual[0] };
  if (contextual.length === 0 && candidates.length === 1) return { element: candidates[0] };
  const remaining = contextual.length > 0 ? contextual : candidates;
  const structure = remaining.filter((element) => element.domPath === source.domPath);
  if (source.domPath && structure.length === 1) return { element: structure[0] };
  return { element: null, reason: 'ambiguous semantic correspondence; no arbitrary ID match was used' };
}

function generatedPseudo(pseudo: ElementObservation['pseudo']['before']): boolean {
  return pseudo.content !== 'none' && pseudo.content !== 'normal'
    && pseudo.styles.display !== 'none' && pseudo.styles.visibility !== 'hidden' && pseudo.styles.opacity !== '0';
}

/** Localizing a generated image changes its URL, while its content structure stays the same. */
function pseudoContentIdentity(content: string): string {
  try {
    const value = csstree.parse(content, { context: 'value' });
    csstree.walk(value, (node) => { if (node.type === 'Url') node.value = 'localized-resource'; });
    return csstree.generate(value);
  } catch {
    // Unsupported syntax remains an exact-string comparison, never an assumed equivalence.
    return content;
  }
}

export function importantObservation(element: ElementObservation): boolean {
  return element.visible && (
    /^(header|nav|main|footer|section|article|form|table|thead|tbody|tr|th|td|h[1-6]|p|a|button|input|select|textarea|label|img|picture|svg|canvas|video|iframe)$/.test(element.tag) ||
    /logo|hero|card|container|banner|heading|navigation|button|image/.test(element.semantic) ||
    (element.styles.backgroundImage !== undefined && element.styles.backgroundImage !== 'none') ||
    generatedPseudo(element.pseudo.before) || generatedPseudo(element.pseudo.after)
  );
}

/** Text/geometry and image readiness can fail even if a tiny defect fits the whole-page budget. */
export function compareObservations(source: ObservationDocument, clone: ObservationDocument, captureId?: string, composition?: FidelityComposition): ElementComparison[] {
  const used = new Set<string>();
  return source.elements.filter(importantObservation).map((element) => {
    const matched = matchObservation(element, source.elements, clone.elements, captureId, composition);
    const result: ElementComparison = {
      sourceId: element.dlId, cloneId: matched.element?.dlId ?? null,
      semantic: element.semantic, status: 'pass', issues: [], maxGeometryDelta: null,
    };
    if (!matched.element) {
      result.status = 'fail';
      result.issues.push(matched.reason ?? 'element is missing');
      return result;
    }
    const actual = matched.element;
    if (used.has(actual.dlId)) result.issues.push('multiple source elements correspond to the same clone element');
    used.add(actual.dlId);
    result.maxGeometryDelta = Math.max(...(['x', 'y', 'width', 'height'] as const)
      .map((key) => Math.abs(element.rect[key] - actual.rect[key])));
    if (result.maxGeometryDelta > FIDELITY_POLICY.geometryToleranceCssPx) {
      result.issues.push(`position or size differs by ${result.maxGeometryDelta} CSS px`);
    }
    if (normalizedText(element.text).length > 0) {
      for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) {
        if (element.styles[key] !== actual.styles[key]) result.issues.push(`${key} differs from the source observation`);
      }
    }
    if (actual.image && (!actual.image.complete || actual.image.naturalWidth === 0 || actual.image.naturalHeight === 0)) {
      result.issues.push('visible image failed to load');
    }
    for (const side of ['before', 'after'] as const) {
      if (generatedPseudo(element.pseudo[side]) && (!generatedPseudo(actual.pseudo[side]) || pseudoContentIdentity(element.pseudo[side].content) !== pseudoContentIdentity(actual.pseudo[side].content))) {
        result.issues.push(`${side} pseudo-element is missing or its content differs`);
      }
    }
    result.status = result.issues.length > 0 ? 'fail' : 'pass';
    return result;
  });
}

/** A removed @font-face can leave the same computed family string while rendering a fallback. */
export function missingLoadedFonts(source: ObservationDocument, clone: ObservationDocument): string[] {
  const signature = (face: NonNullable<ObservationDocument['fontFaces']>[number]): string =>
    JSON.stringify([face.family.replace(/^["']|["']$/g, ''), face.style, face.weight, face.stretch]);
  const loaded = new Set((clone.fontFaces ?? []).filter((face) => face.status === 'loaded').map(signature));
  return (source.fontFaces ?? []).filter((face) => face.status === 'loaded' && !loaded.has(signature(face)))
    .map((face) => `source font face is missing or unloaded: ${face.family} (${face.style}, ${face.weight}, ${face.stretch})`);
}

/** Crop without scaling. Out-of-image geometry is reported rather than silently clamped away. */
function regionPng(png: PNG, rect: ElementObservation['rect'], dsf: number): Buffer | null {
  const x = Math.max(0, Math.floor(rect.x * dsf));
  const y = Math.max(0, Math.floor(rect.y * dsf));
  const right = Math.min(png.width, Math.ceil((rect.x + rect.width) * dsf));
  const bottom = Math.min(png.height, Math.ceil((rect.y + rect.height) * dsf));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  const crop = new PNG({ width, height });
  PNG.bitblt(png, crop, x, y, width, height, 0, 0);
  return PNG.sync.write(crop);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('clone stabilization exceeded its time budget')), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Audit nested documents before Chromium parses them; CSP blocks document scripts during measurement. */
export function activeContentIssues(markup: string, label = 'index.html', xml = false, depth = 0): string[] {
  if (depth > 16) return [`${label}: embedded document audit depth exceeded`];
  const issues: string[] = [];
  const $ = cheerio.load(markup, xml ? { xml: true } : undefined);
  $('*').each((_, element) => {
    if (!('attribs' in element)) return;
    const tag = element.name.toLowerCase();
    if (tag === 'script') issues.push(`${label}: <script> element`);
    if (tag === 'meta' && element.attribs['http-equiv']?.toLowerCase() === 'refresh') issues.push(`${label}: meta refresh navigation`);
    for (const [attribute, value] of Object.entries(element.attribs)) {
      if (/^on/i.test(attribute)) issues.push(`${label}: ${tag}[${attribute}] event handler`);
      const normalized = value.replace(/[\t\n\r\f]/g, '').trimStart();
      if (/^javascript:/i.test(normalized)) issues.push(`${label}: ${tag}[${attribute}] executable URL`);
      if (attribute.toLowerCase() === 'srcdoc') issues.push(...activeContentIssues(value, `${label} srcdoc`, false, depth + 1));
      if (/^(src|href|xlink:href|data)$/i.test(attribute) && /^data:/i.test(normalized)) {
        const comma = normalized.indexOf(',');
        const metadata = normalized.slice(5, comma).toLowerCase();
        if (comma > 0 && /^(text\/html|application\/xhtml\+xml|image\/svg\+xml)(;|$)/.test(metadata)) {
          try {
            const encoded = normalized.slice(comma + 1);
            const decoded = metadata.includes(';base64') ? Buffer.from(encoded, 'base64').toString('utf8') : decodeURIComponent(encoded);
            issues.push(...activeContentIssues(decoded, `${label} ${tag}[${attribute}]`, metadata.startsWith('image/svg+xml'), depth + 1));
          } catch (error) {
            issues.push(`${label}: cannot audit embedded document: ${message(error)}`);
          }
        }
      }
    }
  });
  return [...new Set(issues)];
}

function reportStatus(captures: readonly CaptureComparison[], issues: readonly string[], inertIssues: readonly string[]): FidelityStatus {
  if (issues.length > 0 || captures.length === 0 || captures.some((capture) => capture.status === 'unverified')) return 'unverified';
  return inertIssues.length > 0 || captures.some((capture) => capture.status === 'fail') ? 'fail' : 'pass';
}

/** Absolute filesystem paths and ephemeral local origins never enter the persisted observations. */
export function normalizeObservationUrls(document: ObservationDocument, origin: string): ObservationDocument {
  if (document.rootStyles) {
    for (const [key, value] of Object.entries(document.rootStyles)) document.rootStyles[key] = value.split(origin).join('');
  }
  for (const element of [...document.elements, ...(document.body ? [document.body] : [])]) {
    if (element.currentSrc?.startsWith(`${origin}/`)) element.currentSrc = element.currentSrc.slice(origin.length);
    for (const styles of [element.styles, element.pseudo.before.styles, element.pseudo.after.styles]) {
      for (const [key, value] of Object.entries(styles)) styles[key] = value.split(origin).join('');
    }
  }
  return document;
}

async function recordedEvidenceHash(root: string, name: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(await resolveEvidencePath(root, name), 'utf8'));
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error(`cannot read source baseline in ${name}: ${message(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || !('evidenceHash' in parsed) || parsed.evidenceHash === null) return null;
  if (typeof parsed.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.evidenceHash)) {
    throw new Error(`invalid source evidence hash in ${name}`);
  }
  return parsed.evidenceHash;
}

interface CompositionRecord {
  composition?: FidelityComposition;
  hash: string | null;
  warnings: string[];
}

/** A supported-looking raster result cannot certify a composition with known transformation gaps. */
async function readComposition(root: string, captures: readonly CaptureIdentity[]): Promise<CompositionRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(await resolveEvidencePath(root, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { hash: null, warnings: [] };
    throw error;
  }
  if (parsed === null || typeof parsed !== 'object' || !('composition' in parsed) || parsed.composition === undefined) return { hash: null, warnings: [] };
  const composition = validateFidelityComposition(parsed.composition, captures);
  const hash = sha256(JSON.stringify(parsed.composition));
  const warnings = composition.warnings.map((warning) => `responsive composition: ${warning}`);
  try {
    const css = await fs.readFile(await resolveEvidencePath(root, 'clone/assets/dl-overrides.css'), 'utf8');
    const ast = csstree.parse(css);
    let rootSelector = false;
    csstree.walk(ast, (node) => {
      if ((node.type === 'TypeSelector' && /^(?:.*\|)?(?:html|body)$/i.test(node.name))
          || (node.type === 'PseudoClassSelector' && node.name.toLowerCase() === 'root')) rootSelector = true;
    });
    if (rootSelector) warnings.push('responsive composition: shared override html/body/:root selectors do not address shadow proxies; use the generated root/body data-dl-id selectors');
  } catch (error) {
    if (!(error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      warnings.push(`responsive composition: cannot inspect shared override selectors: ${message(error)}`);
    }
  }
  return { composition, hash, warnings };
}

/** Check actual roots and raw attributes, including partial claims and inactive variant trees. */
async function auditCompositionDom(page: Page, captureId: string, composition?: FidelityComposition): Promise<{ issues: string[]; activeCaptureId?: string }> {
  return page.evaluate(({ captureId, composition }) => {
    const issues = new Set<string>();
    const records = new Map(composition?.elements.map((entry) => [entry.dlId, entry]) ?? []);
    const variants = new Map(composition?.variants.map((entry) => [entry.captureId, entry]) ?? []);
    const generated = new Map<string, { kind: string; captureId: string; rootPath: string[]; parent: string | null; tag: string }>();
    for (const variant of composition?.variants ?? []) {
      generated.set(variant.hostId, { kind: 'host', captureId: variant.captureId, rootPath: [], parent: null, tag: 'dl-variant' });
      generated.set(variant.rootId, { kind: 'root', captureId: variant.captureId, rootPath: [variant.hostId], parent: variant.hostId, tag: 'dl-root' });
      generated.set(variant.bodyId, { kind: 'body', captureId: variant.captureId, rootPath: [variant.hostId], parent: variant.rootId, tag: 'dl-body' });
    }
    const seen = new Set<string>();
    const active: string[] = [];
    const stack: Array<{ element: Element; rootPath: string[]; parentId: string | null }> = [{ element: document.documentElement, rootPath: [], parentId: null }];
    while (stack.length > 0) {
      const { element, rootPath, parentId } = stack.pop()!;
      const id = element.getAttribute('data-dl-id');
      const sourceCapture = element.getAttribute('data-dl-source-capture');
      const sourceId = element.getAttribute('data-dl-source-id');
      const kind = element.getAttribute('data-dl-generated');
      const record = id ? records.get(id) : undefined;
      const proxy = id ? generated.get(id) : undefined;
      if (id) {
        if (seen.has(id)) issues.add(`duplicate canonical element ID: ${id}`);
        seen.add(id);
      }
      if (record) {
        const hostId = variants.get(record.captureId)?.hostId;
        if (rootPath[0] !== hostId) issues.add(`source element ${id} is outside its recorded variant host`);
        if (kind !== null || (sourceCapture !== null && sourceCapture !== record.captureId) || (sourceId !== null && sourceId !== record.sourceId)) {
          issues.add(`DOM provenance disagrees with recorded source mapping: ${id}`);
        }
      } else if (proxy) {
        if (element.localName !== proxy.tag || JSON.stringify(rootPath) !== JSON.stringify(proxy.rootPath) || parentId !== proxy.parent
            || (kind !== null && kind !== proxy.kind) || (sourceCapture !== null && sourceCapture !== proxy.captureId) || sourceId !== null) {
          issues.add(`generated ${proxy.kind} does not match its recorded identity or structure: ${id}`);
        }
        if (proxy.kind === 'host') {
          if (!element.shadowRoot) issues.add(`recorded variant host has no open shadow root: ${id}`);
          if (getComputedStyle(element).display !== 'none') active.push(proxy.captureId);
        }
      } else if (sourceCapture !== null || sourceId !== null || kind !== null) {
        issues.add(`unrecorded DOM provenance claim: ${id ?? element.localName}`);
      }
      const children = Array.from(element.children);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ element: children[index], rootPath, parentId: id });
      if (element.shadowRoot) {
        const children = Array.from(element.shadowRoot.children);
        for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ element: children[index], rootPath: [...rootPath, id ?? 'unstamped-shadow-host'], parentId: id });
      }
    }
    for (const id of generated.keys()) if (!seen.has(id)) issues.add(`recorded generated element is missing: ${id}`);
    if (composition && (active.length !== 1 || active[0] !== captureId)) {
      issues.add(`responsive variant mismatch: expected ${captureId}, selected ${active.join(', ') || 'none'}`);
    }
    return { issues: [...issues], ...(active.length === 1 ? { activeCaptureId: active[0] } : {}) };
  }, { captureId, composition });
}

async function compareCapture(
  root: string, capture: SourceCapture, browser: Browser, origin: string, outputDir: string, composition?: FidelityComposition,
): Promise<CaptureComparison> {
  const result: CaptureComparison = {
    captureId: capture.id, viewport: capture.viewport, status: 'unverified', issues: [], elements: [],
  };
  if (!capture.complete) {
    result.diagnosticOnly = true;
    result.issues.push(...capture.warnings, 'source capture is incomplete');
  }
  if (capture.browserVersion !== browser.version()) {
    result.diagnosticOnly = true;
    result.issues.push(`browser version differs from capture: ${capture.browserVersion} versus ${browser.version()}`);
  }
  const source = capture.observations;
  if (!source.complete || source.fonts.status !== 'ready' || source.fonts.failedFamilies.length > 0) {
    result.diagnosticOnly = true;
    result.issues.push('source observations or fonts are incomplete', ...source.warnings);
  }
  if (!capture.viewportScreenshot && !capture.fullScreenshot) {
    result.issues.push('source images are unavailable; no image comparison was performed');
    return result;
  }
  const context = await browser.newContext({
    viewport: capture.viewport, deviceScaleFactor: capture.deviceScaleFactor,
    serviceWorkers: 'block', reducedMotion: capture.policy.reducedMotion, colorScheme: capture.policy.colorScheme,
    userAgent: capture.userAgent,
  });
  const failures = new Set<string>();
  try {
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      const url = new URL(requestUrl);
      if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') await route.continue();
      else {
        failures.add(`external request blocked: ${requestUrl}`);
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    page.on('requestfailed', (request) => failures.add(`request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.add(`HTTP ${response.status()}: ${response.url()}`);
    });
    await page.goto(`${origin}/index.html`, { waitUntil: 'load', timeout: 30_000 });
    const stabilized = await bounded(stabilize(page, Date.now() + 15_000, { activeResponsiveOnly: Boolean(composition) }), 16_000);
    if (!stabilized.complete) result.issues.push(...stabilized.warnings);
    const provenance = await auditCompositionDom(page, capture.id, composition);
    result.issues.push(...provenance.issues);
    const observations = normalizeObservationUrls(await observePage(page), origin);
    if (composition) observations.activeCaptureId = provenance.activeCaptureId;
    result.observations = observations;
    if (observations.activeCaptureId && observations.activeCaptureId !== capture.id) {
      result.issues.push(`responsive variant mismatch: expected ${capture.id}, selected ${observations.activeCaptureId}`);
    }
    for (const failure of missingLoadedFonts(source, observations)) failures.add(failure);
    if (!observations.complete) result.issues.push('clone observations are incomplete', ...observations.warnings);
    if (observations.fonts.status !== 'ready' || observations.fonts.failedFamilies.length > 0) {
      failures.add(`clone fonts are not ready: ${JSON.stringify(observations.fonts)}`);
    }
    for (const element of observations.elements) {
      if (element.visible && element.image && (!element.image.complete || element.image.naturalWidth === 0)) {
        failures.add(`visible image failed to load: ${element.dlId}`);
      }
    }
    if (observations.width * observations.height * observations.deviceScaleFactor ** 2 > 40_000_000) {
      result.issues.push('clone exceeds the full screenshot pixel limit');
      return result;
    }
    const cloneViewport = await page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide', timeout: 30_000 });
    const cloneFull = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', timeout: 30_000 });
    const sourceViewport = capture.viewportScreenshot ? await fs.readFile(await resolveEvidencePath(root, capture.viewportScreenshot)) : null;
    const sourceFull = capture.fullScreenshot ? await fs.readFile(await resolveEvidencePath(root, capture.fullScreenshot)) : null;
    const prefix = capture.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const write = async (name: string, bytes: Buffer): Promise<string> => {
      const file = path.join(outputDir, `${prefix}-${name}.png`);
      await fs.writeFile(file, bytes, { flag: 'wx' });
      return path.relative(root, file).split(path.sep).join('/');
    };
    result.screenshots = { viewport: await write('clone-viewport', cloneViewport), full: await write('clone-full', cloneFull) };
    const viewport = sourceViewport ? comparePng(sourceViewport, cloneViewport) : null;
    const full = sourceFull ? comparePng(sourceFull, cloneFull) : null;
    if (viewport?.diff) viewport.comparison.diff = await write('diff-viewport', viewport.diff);
    if (full?.diff) full.comparison.diff = await write('diff-full', full.diff);
    if (viewport) result.viewportImage = viewport.comparison;
    else result.issues.push('source viewport image is unavailable');
    if (full) result.fullImage = full.comparison;
    else result.issues.push('source full image is unavailable');
    result.elements = compareObservations(source, observations, capture.id, composition);
    const sourcePng = sourceFull ? PNG.sync.read(sourceFull) : null;
    const clonePng = PNG.sync.read(cloneFull);
    let comparedPixels = 0;
    for (let index = 0; index < result.elements.length; index += 1) {
      const compared = result.elements[index];
      if (!compared.cloneId || !sourcePng) continue;
      const original = source.elements.find((element) => element.dlId === compared.sourceId);
      const actual = observations.elements.find((element) => element.dlId === compared.cloneId);
      if (!original || !actual) continue;
      comparedPixels += original.rect.width * original.rect.height * capture.deviceScaleFactor ** 2;
      if (comparedPixels > 100_000_000) {
        result.issues.push('regional comparison pixel budget exceeded; remaining regions are unverified');
        break;
      }
      const expectedRegion = regionPng(sourcePng, original.rect, capture.deviceScaleFactor);
      const actualRegion = regionPng(clonePng, actual.rect, capture.deviceScaleFactor);
      if (!expectedRegion || !actualRegion) {
        compared.status = 'fail';
        compared.issues.push('visible region is outside the captured image');
        continue;
      }
      const region = comparePng(expectedRegion, actualRegion, FIDELITY_POLICY.regionMismatchRatio);
      compared.image = region.comparison;
      if (region.comparison.status === 'fail') {
        compared.status = 'fail';
        compared.issues.push('regional pixels differ from the source');
        if (region.diff) compared.image.diff = await write(`diff-region-${index + 1}`, region.diff);
      }
    }
    result.status = result.issues.length > 0 ? 'unverified' :
      failures.size > 0 || viewport?.comparison.status === 'fail' || full?.comparison.status === 'fail' ||
      result.elements.some((element) => element.status === 'fail') ? 'fail' : 'pass';
    result.issues.push(...failures);
    return result;
  } finally {
    await context.close();
  }
}

/** Re-render the current clone, offline, against immutable capture evidence. */
export async function runFidelity(projectDir: string): Promise<FidelityResult> {
  const root = path.resolve(projectDir);
  const report: FidelityReport = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'unverified',
    policy: FIDELITY_POLICY, evidenceHash: null, cloneHash: null, cloneFiles: [], captures: [], issues: [], inertIssues: [],
  };
  await fs.access(root);
  let browser: Browser | undefined;
  let server: Awaited<ReturnType<typeof startStaticServer>> | undefined;
  try {
    // Preserve an established baseline across failed reruns; replacing it would bless an edit
    // on the very next invocation. Recapture belongs in a new project, never in this evidence.
    const priorHash = await recordedEvidenceHash(root, 'fidelity.json');
    report.evidenceHash = priorHash;
    const manifestHash = await recordedEvidenceHash(root, 'manifest.json');
    report.evidenceHash = priorHash ?? manifestHash;
    if (priorHash && manifestHash && priorHash !== manifestHash) throw new Error('recorded source evidence baselines disagree');
    const evidence = await readEvidence(root);
    const currentEvidenceHash = evidenceHash(evidence);
    if (report.evidenceHash !== null && report.evidenceHash !== currentEvidenceHash) {
      throw new Error('source evidence changed since capture or a previous comparison; recapture into a new project');
    }
    report.evidenceHash = currentEvidenceHash;
    report.cloneFiles = await hashTree(path.join(root, 'clone'));
    report.cloneHash = sha256(JSON.stringify(report.cloneFiles));
    for (const file of report.cloneFiles) {
      if (!/\.(html?|svg|xhtml|xml)$/i.test(file.path)) continue;
      const markup = await fs.readFile(path.join(root, 'clone', file.path), 'utf8');
      report.inertIssues.push(...activeContentIssues(markup, file.path, /\.(svg|xml|xhtml)$/i.test(file.path)));
    }
    if (evidence.captures.some((capture) => !capture.complete)) report.issues.push('source evidence is incomplete');
    if (evidence.captures.length === 0) report.issues.push('source evidence contains no captures');
    const compositionRecord = await readComposition(root, evidence.captures.filter((capture) => capture.snapshot));
    report.compositionHash = compositionRecord.hash;
    const compositionIssues = compositionRecord.warnings;
    report.issues.push(...compositionIssues);
    const outputDir = path.join(root, 'screenshots', `fidelity-${Date.now()}-${randomUUID()}`);
    await fs.mkdir(outputDir, { recursive: true });
    // A CSP blocks document scripts without disabling browser timers used by the measurement
    // callbacks. Playwright's javaScriptEnabled:false also suspends those timers and can hang
    // an asynchronous evaluate call. The header applies to HTML, frames and SVG responses.
    server = await startStaticServer(path.join(root, 'clone'), { contentSecurityPolicy: "script-src 'none'" });
    const { chromium } = loadRuntimeDep<PlaywrightModule>('playwright');
    browser = await chromium.launch({ headless: true });
    for (const capture of evidence.captures) {
      try {
        const compared = await compareCapture(root, capture, browser, server.origin, outputDir, compositionRecord.composition);
        if (compositionIssues.length > 0) {
          compared.status = 'unverified';
          compared.diagnosticOnly = true;
          compared.issues.push(...compositionIssues);
        }
        report.captures.push(compared);
      } catch (error) {
        report.captures.push({ captureId: capture.id, viewport: capture.viewport, status: 'unverified', elements: [], issues: [message(error)] });
      }
    }
    if ((await readComposition(root, evidence.captures.filter((capture) => capture.snapshot))).hash !== report.compositionHash) report.issues.push('responsive composition metadata changed during comparison');
    if (sha256(JSON.stringify(await hashTree(path.join(root, 'clone')))) !== report.cloneHash) report.issues.push('clone files changed during comparison');
    if (evidenceHash(await readEvidence(root)) !== report.evidenceHash) report.issues.push('source evidence changed during comparison');
  } catch (error) {
    report.issues.push(message(error));
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (server) await server.close();
    }
  }
  report.status = reportStatus(report.captures, report.issues, report.inertIssues);
  const json = `${JSON.stringify(report)}\n`;
  await fs.writeFile(path.join(root, 'fidelity.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { report, json };
}
