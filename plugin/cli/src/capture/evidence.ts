import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ObservationDocument } from '../analyze/observations.js';
import type { Viewport } from '../lib/viewport.js';

export interface EvidenceFile { path: string; sha256: string }
export interface SourceCapture {
  id: string;
  viewport: Viewport;
  deviceScaleFactor: number;
  capturedAt: string;
  browserVersion: string;
  userAgent: string;
  sourceUrl: string;
  finalUrl: string;
  policy: { reducedMotion: 'reduce'; colorScheme: 'light'; removeSelectors: string[] };
  observations: ObservationDocument;
  viewportScreenshot: string;
  fullScreenshot: string;
  snapshot: string;
  files: EvidenceFile[];
  complete: boolean;
  warnings: string[];
}
export interface EvidenceDocument { schemaVersion: 1; captures: SourceCapture[] }

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
export async function hashFile(file: string): Promise<string> { return sha256(await fs.readFile(file)); }

/** All paths are portable project-relative paths; symlinks cannot redirect evidence reads. */
export async function resolveEvidencePath(projectDir: string, relative: string): Promise<string> {
  if (relative.length === 0 || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)
      || relative.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new Error(`invalid evidence path: ${relative}`);
  }
  const root = await fs.realpath(projectDir);
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`evidence path contains symlink: ${relative}`);
  }
  if (!(await fs.stat(current)).isFile()) throw new Error(`evidence path is not a file: ${relative}`);
  return current;
}

/** Snapshot identity includes every file, not only images; symlinks are never followed. */
export async function hashTree(directory: string): Promise<EvidenceFile[]> {
  const result: EvidenceFile[] = [];
  async function walk(relative: string): Promise<void> {
    const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`evidence tree contains symlink: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) result.push({ path: child, sha256: await hashFile(path.join(directory, child)) });
      else throw new Error(`evidence tree contains non-regular file: ${child}`);
    }
  }
  await walk('');
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

/** Canonical semantic hash is independent of pretty-printing and JSON object key insertion. */
export function evidenceHash(evidence: EvidenceDocument): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  }
  return sha256(JSON.stringify(canonical(evidence)));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`invalid evidence: ${message}`);
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function viewport(value: unknown): value is Viewport {
  return object(value) && positive(value.width) && positive(value.height) && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height);
}
function validateObservations(value: unknown): asserts value is ObservationDocument {
  assert(object(value), 'observations must be an object');
  assert(viewport(value.viewport) && positive(value.deviceScaleFactor) && positive(value.width) && positive(value.height), 'invalid observation geometry');
  assert(typeof value.rootFontSize === 'string' && typeof value.complete === 'boolean' && strings(value.warnings), 'invalid observation metadata');
  assert(object(value.fonts) && ['ready', 'timeout', 'unavailable'].includes(String(value.fonts.status)) && strings(value.fonts.failedFamilies), 'invalid font readiness');
  if (value.fontFaces !== undefined) {
    assert(Array.isArray(value.fontFaces) && value.fontFaces.every((face) => object(face)
      && ['family', 'style', 'weight', 'stretch'].every((key) => typeof face[key] === 'string')
      && ['unloaded', 'loading', 'loaded', 'error'].includes(String(face.status))), 'invalid font face observations');
  }
  assert(Array.isArray(value.elements) && value.elements.length <= 20_000, 'invalid element observations');
  const ids = new Set<string>();
  const measuredElements = [...value.elements];
  if (value.body !== undefined) {
    assert(object(value.body) && value.body.tag === 'body' && value.body.domPath === 'body', 'invalid body observation');
    measuredElements.push({ ...value.body, dlId: '__document_body__' });
  }
  for (const element of measuredElements) {
    assert(object(element), 'element must be an object');
    assert(typeof element.dlId === 'string' && element.dlId.length > 0 && !ids.has(element.dlId), 'missing or duplicate element ID');
    ids.add(element.dlId);
    assert(['tag', 'text', 'semantic', 'domPath'].every((key) => typeof element[key] === 'string'), 'invalid element identity');
    assert(strings(element.rootPath) && strings(element.childDlIds) && (element.parentDlId === null || typeof element.parentDlId === 'string'), 'invalid element relationships');
    const rect = element.rect;
    assert(object(rect) && ['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key])), 'invalid element rectangle');
    assert(object(element.styles) && Object.values(element.styles).every((item) => typeof item === 'string'), 'invalid computed styles');
    assert(typeof element.visible === 'boolean' && (element.currentSrc === null || typeof element.currentSrc === 'string'), 'invalid element visibility or image source');
    if (element.src !== undefined) assert(element.src === null || typeof element.src === 'string', 'invalid attribute source');
    if (element.image !== undefined) {
      assert(object(element.image) && typeof element.image.complete === 'boolean'
        && typeof element.image.naturalWidth === 'number' && Number.isFinite(element.image.naturalWidth) && element.image.naturalWidth >= 0
        && typeof element.image.naturalHeight === 'number' && Number.isFinite(element.image.naturalHeight) && element.image.naturalHeight >= 0, 'invalid image readiness');
    }
    assert(object(element.pseudo), 'missing pseudo-element observations');
    for (const key of ['before', 'after']) {
      const pseudo = element.pseudo[key];
      assert(object(pseudo) && typeof pseudo.content === 'string' && object(pseudo.styles)
        && Object.values(pseudo.styles).every((item) => typeof item === 'string'), 'invalid pseudo-element observations');
    }
  }
}

/** Read-only, fail-closed validation. Missing legacy evidence is distinguished by the caller. */
export async function readEvidence(projectDir: string): Promise<EvidenceDocument> {
  const file = await resolveEvidencePath(projectDir, 'evidence.json');
  const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  assert(object(value) && value.schemaVersion === 1 && Array.isArray(value.captures) && value.captures.length > 0, 'unsupported schema or empty captures');
  const ids = new Set<string>();
  for (const capture of value.captures) {
    assert(object(capture), 'capture must be an object');
    assert(typeof capture.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(capture.id) && !ids.has(capture.id), 'invalid or duplicate capture ID');
    ids.add(capture.id);
    assert(viewport(capture.viewport) && positive(capture.deviceScaleFactor), 'invalid capture viewport');
    for (const key of ['capturedAt', 'browserVersion', 'userAgent', 'sourceUrl', 'finalUrl']) {
      assert(typeof capture[key] === 'string' && capture[key].length > 0, `missing capture ${key}`);
    }
    assert(typeof capture.complete === 'boolean' && strings(capture.warnings), 'invalid capture status');
    for (const key of ['viewportScreenshot', 'fullScreenshot', 'snapshot']) {
      assert(typeof capture[key] === 'string' && (!capture.complete || capture[key].length > 0), `missing capture ${key}`);
    }
    assert(object(capture.policy) && capture.policy.reducedMotion === 'reduce' && capture.policy.colorScheme === 'light' && strings(capture.policy.removeSelectors), 'invalid capture policy');
    validateObservations(capture.observations);
    assert(capture.observations.viewport.width === capture.viewport.width && capture.observations.viewport.height === capture.viewport.height
      && capture.observations.deviceScaleFactor === capture.deviceScaleFactor, 'capture and observation viewport differ');
    assert(Array.isArray(capture.files) && (!capture.complete || capture.files.length > 0), 'capture file hashes missing');
    const paths = new Set<string>();
    for (const entry of capture.files) {
      assert(object(entry) && typeof entry.path === 'string' && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'invalid file hash');
      assert(entry.path.startsWith(`evidence/${capture.id}/`) && !paths.has(entry.path), 'file outside capture directory or duplicate file');
      paths.add(entry.path);
      const actual = await hashFile(await resolveEvidencePath(projectDir, entry.path));
      assert(actual === entry.sha256, `file hash mismatch: ${entry.path}`);
    }
    for (const key of ['viewportScreenshot', 'fullScreenshot', 'snapshot']) {
      if (capture[key] !== '') assert(paths.has(capture[key] as string), `${key} is not integrity protected`);
    }
  }
  return value as unknown as EvidenceDocument;
}
