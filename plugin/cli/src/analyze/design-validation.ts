import fs from 'node:fs/promises';
import path from 'node:path';

import { converter, parse as parseColor } from 'culori';
import * as csstree from 'css-tree';

import type { ObservationDocument } from './observations.js';
import { evidenceHash, hashTree, readEvidence, resolveEvidencePath, sha256, type EvidenceDocument, type SourceCapture } from '../capture/evidence.js';

export const DESIGN_SECTION_PREFIXES = [
  '1. First Impression', '2. Design Intent', '3. Layout & Grid', '4. Visual Hierarchy',
  '5. Typography', '6. Color System', '7. Imagery & Iconography', '8. Motion & Interaction',
  '9. Component Patterns', '10. Signature Moves', '11. What NOT to Copy', '12. Reusable Principles',
] as const;
export const DESIGN_RECIPE_HEADINGS = [
  'Layout recipe', 'Typography recipe', 'Color roles', 'Spacing recipe', 'Component recipes', 'Responsive rules',
] as const;
export const DESIGN_CSS_HEADING = 'CSS recipe';
export const DESIGN_OBSERVATIONS_HEADING = 'Measured observations';
export const DESIGN_OBSERVATION_COLUMNS = ['Label', 'Capture', 'Viewport', 'Observation', 'Field', 'Value', 'Unit', 'Precision'] as const;
export const VARIATION_REQUIRED_HEADINGS = ['Target brief', 'Selected direction', 'Structural changes', 'Verification criteria'] as const;
export const DESIGN_NUMERIC_UNITS = ['px', 'rem', 'unitless'] as const;

export type DesignValidationStatus = 'pass' | 'fail' | 'unverified';
export interface DesignValidationCheck { id: string; status: DesignValidationStatus; detail: string }
export interface ValidatedMeasurement {
  line: number;
  label: string;
  capture: string;
  viewport: string;
  observation: string;
  field: string;
  value: string;
  unit: string;
  precision: string;
  status: DesignValidationStatus;
}
export interface DesignValidationReport {
  schemaVersion: 1;
  status: DesignValidationStatus;
  checks: DesignValidationCheck[];
  issues: string[];
  measurements: ValidatedMeasurement[];
}
export interface DesignValidationInput {
  design: string | null;
  variations: string | null;
  /** The I/O boundary validates file hashes and the established source baseline before use. */
  evidence: EvidenceDocument | null;
  sourceProblem?: string;
  /** Present only after the saved fidelity report's source and current clone hashes agree. */
  cloneObservations?: ReadonlyMap<string, ObservationDocument>;
  cloneProblem?: string;
}
export interface DesignValidationResult { report: DesignValidationReport; json: string }

interface Heading { level: number; title: string; line: number; body: string }
interface Table { columns: string[]; rows: Array<{ cells: string[]; line: number }> }

function unformat(value: string): string {
  const trimmed = value.trim();
  const code = /^(`+)([\s\S]*?)\1$/.exec(trimmed);
  if (code) return code[2].trim();
  return trimmed.replace(/^\*\*([\s\S]*)\*\*$/, '$1');
}

/** Pipes inside code spans or escaped cells belong to the value, not the table structure. */
export function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && index + 1 < line.length && /[|\\]/.test(line[index + 1])) {
      cell += line[index + 1]; index += 1;
    } else if (character === '`') {
      let count = 1;
      while (line[index + count] === '`') count += 1;
      if (codeTicks === 0) codeTicks = count;
      else if (codeTicks === count) codeTicks = 0;
      cell += '`'.repeat(count); index += count - 1;
    } else if (character === '|' && codeTicks === 0) {
      cells.push(unformat(cell)); cell = '';
    } else cell += character;
  }
  cells.push(unformat(cell));
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function headings(markdown: string): Heading[] {
  const lines = markdown.split(/\r?\n/);
  const found: Array<Omit<Heading, 'body'>> = [];
  let fence: { marker: string; count: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], count: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.count) fence = null;
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (match) found.push({ level: match[1].length, title: match[2], line: index + 1 });
  }
  return found.map((heading, index) => {
    const end = found.slice(index + 1).find((candidate) => candidate.level <= heading.level)?.line ?? lines.length + 1;
    return { ...heading, body: lines.slice(heading.line, end - 1).join('\n') };
  });
}

function tables(body: string, lineOffset: number): Table[] {
  const lines = body.split(/\r?\n/);
  const result: Table[] = [];
  let fence: { marker: string; count: number } | null = null;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], count: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.count) fence = null;
      continue;
    }
    if (fence || !lines[index].includes('|')) continue;
    const columns = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (columns.length < 2 || separator.length !== columns.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const rows: Table['rows'] = [];
    index += 2;
    while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
      rows.push({ cells: splitMarkdownRow(lines[index]), line: lineOffset + index + 1 });
      index += 1;
    }
    index -= 1;
    result.push({ columns, rows });
  }
  return result;
}

function unavailable(body: string): boolean { return /\bunavailable\b/i.test(body); }

function hasCssDeclaration(css: string): boolean {
  let declaration = false;
  try {
    csstree.walk(csstree.parse(css), (node) => {
      if (node.type === 'Declaration' && node.property.trim() && csstree.generate(node.value).trim()) declaration = true;
    });
  } catch { return false; }
  return declaration;
}

/** Only own data properties may be cited. Prototype names are never measurement paths. */
export function observedField(record: unknown, field: string): { found: boolean; value?: unknown } {
  const segments = field.split('.');
  if (segments.length > 12 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment)
      || ['__proto__', 'prototype', 'constructor'].includes(segment))) return { found: false };
  let value: unknown = record;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { found: false };
    value = (value as Record<string, unknown>)[segment];
  }
  return { found: true, value };
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(px|rem)?$/;
const toRgb = converter('rgb');

/** The observation itself establishes the unit; conversion never assumes a 16px root. */
export function compareMeasuredValue(
  actual: unknown, claim: { value: string; unit: string; precision: string; field: string; observation: string },
  document: ObservationDocument,
): string | null {
  if (claim.unit === 'css') {
    if (claim.precision !== '-') return 'CSS strings require Precision -';
    return typeof actual === 'string' && actual.trim() === claim.value.trim() ? null : 'CSS value does not match the observed string';
  }
  if (claim.unit === 'color') {
    if (claim.precision !== '-') return 'colors require Precision -';
    if (typeof actual !== 'string') return 'the observed value is not a CSS color';
    const source = parseColor(actual);
    const proposed = parseColor(claim.value);
    if (!source || !proposed) return 'color could not be parsed';
    const expected = toRgb(source);
    const given = toRgb(proposed);
    for (const channel of ['r', 'g', 'b', 'alpha'] as const) {
      const left = expected[channel] ?? (channel === 'alpha' ? 1 : 0);
      const right = given[channel] ?? (channel === 'alpha' ? 1 : 0);
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > 0.000001) return 'color or alpha differs from the observed RGBA value';
    }
    return null;
  }
  if (!(DESIGN_NUMERIC_UNITS as readonly string[]).includes(claim.unit)) return 'Unit must be px, rem, unitless, css, or color';
  if (!/^[0-6]$/.test(claim.precision)) return 'numeric values require Precision from 0 through 6';
  if (!NUMBER.test(claim.value) || !Number.isFinite(Number(claim.value))) return 'numeric Value must contain only a finite number; place its unit in Unit';
  let number: number;
  let sourceUnit: string;
  if (typeof actual === 'number') {
    number = actual;
    if (/^(?:body\.)?rect\.(x|y|width|height)$/.test(claim.field) || /^image\.natural(Width|Height)$/.test(claim.field)
        || (claim.observation === 'page' && /^(width|height|viewport\.width|viewport\.height)$/.test(claim.field))) sourceUnit = 'px';
    else if (claim.observation === 'page' && claim.field === 'deviceScaleFactor') sourceUnit = 'unitless';
    else return 'numeric observation field has no established unit';
  } else if (typeof actual === 'string') {
    const parsed = LENGTH.exec(actual.trim());
    if (!parsed) return 'observed value is not a supported numeric CSS value';
    number = Number(parsed[1]); sourceUnit = parsed[2] ?? 'unitless';
  } else return 'observed value is not numeric';
  if (!Number.isFinite(number)) return 'observed number is not finite';
  if (sourceUnit !== claim.unit) {
    if (![sourceUnit, claim.unit].every((unit) => unit === 'px' || unit === 'rem')) return `cannot convert ${sourceUnit} to ${claim.unit}`;
    const root = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))px$/.exec(document.rootFontSize.trim());
    const rootPx = Number(root?.[1]);
    if (!Number.isFinite(rootPx) || rootPx <= 0) return 'px/rem conversion requires a positive measured rootFontSize in px from this capture';
    number = sourceUnit === 'px' ? number / rootPx : number * rootPx;
  }
  const factor = 10 ** Number(claim.precision);
  const expected = Math.round((number + Number.EPSILON) * factor) / factor;
  return Math.abs(expected - Number(claim.value)) <= Number.EPSILON * Math.max(1, Math.abs(expected)) * 4
    ? null : `value differs from the observation rounded to ${claim.precision} decimal places (expected ${expected} ${claim.unit})`;
}

function category(field: string): 'layout' | 'typography' | 'color' | null {
  if (/^((?:body\.)?rect\.|width$|height$)/.test(field) || /(?:^|\.)(?:width|height|minWidth|maxWidth|minHeight|maxHeight|margin\w*|padding\w*|rowGap|columnGap|display|position|grid\w*|flex\w*|align\w*|justifyContent)$/.test(field)) return 'layout';
  if (field === 'rootFontSize' || /(?:^|\.)(?:font\w*|lineHeight|letterSpacing|wordSpacing)$/.test(field)) return 'typography';
  if (/(?:^|\.)(?:color|\w+Color)$/.test(field)) return 'color';
  return null;
}

/** Structural and measurement checks are deterministic; prose interpretation remains a review task. */
export function validateDesignDocuments(input: DesignValidationInput): DesignValidationReport {
  const checks: DesignValidationCheck[] = [];
  const measurements: ValidatedMeasurement[] = [];
  const check = (id: string, status: DesignValidationStatus, detail: string): void => { checks.push({ id, status, detail }); };
  const sourceAvailable = input.evidence !== null && input.sourceProblem === undefined;
  check('source-evidence', sourceAvailable ? 'pass' : 'unverified', input.sourceProblem ?? (sourceAvailable ? 'source file hashes and baseline are verified' : 'source evidence is unavailable'));
  const completeCaptures = sourceAvailable ? input.evidence!.captures.filter((capture) => capture.complete && capture.observations.complete) : [];
  const incompleteCaptures = sourceAvailable ? input.evidence!.captures.filter((capture) => !capture.complete || !capture.observations.complete) : [];
  for (const capture of incompleteCaptures) check(`source-capture:${capture.id}`, 'unverified', `source capture ${capture.id} is incomplete`);
  const sourceCoverage = new Set<string>();
  const unavailableCoverage = new Set<string>();
  const categories = new Set<string>();
  if (input.design === null) check('design-document', 'fail', 'DESIGN.md is missing or unreadable');
  else {
    const sections = headings(input.design);
    for (const prefix of DESIGN_SECTION_PREFIXES) {
      const matches = sections.filter((heading) => heading.level === 2 && (heading.title === prefix || heading.title.startsWith(`${prefix} `) || heading.title.startsWith(`${prefix}:`)));
      check(`design-section:${prefix}`, matches.length === 1 ? 'pass' : 'fail', matches.length === 1 ? `${prefix} is present` : `expected exactly one ## ${prefix} section`);
    }
    for (const title of DESIGN_RECIPE_HEADINGS) {
      const matches = sections.filter((heading) => heading.level === 3 && heading.title === title);
      const section = matches[0];
      const data = section ? tables(section.body, section.line) : [];
      const populated = data.some((table) => table.rows.some((row) => row.cells.length === table.columns.length && row.cells.every((cell) => cell !== '' && cell !== '-')));
      const status = matches.length !== 1 ? 'fail' : populated ? 'pass' : unavailable(section.body) ? 'unverified' : 'fail';
      check(`recipe:${title}`, status, status === 'pass' ? `${title} contains a populated table` : status === 'unverified' ? `${title} is explicitly unavailable` : `### ${title} requires a populated table`);
    }
    const css = sections.filter((heading) => heading.level === 3 && heading.title === DESIGN_CSS_HEADING);
    const cssBlock = css.length === 1 ? /^(`{3,}|~{3,})css\s*\r?\n([\s\S]*?)^\1\s*$/im.exec(css[0].body) : null;
    const cssExample = cssBlock !== null && hasCssDeclaration(cssBlock[2]);
    check('recipe:CSS', cssExample ? 'pass' : css.length === 1 && unavailable(css[0].body) ? 'unverified' : 'fail', cssExample ? 'CSS recipe contains an implementation example' : '### CSS recipe requires a nonempty fenced CSS example or an explicit unavailable explanation');
    const observationSections = sections.filter((heading) => heading.level === 2 && heading.title === DESIGN_OBSERVATIONS_HEADING);
    const observationTables = observationSections.length === 1 ? tables(observationSections[0].body, observationSections[0].line) : [];
    const matchingTables = observationTables.filter((candidate) => candidate.columns.length === DESIGN_OBSERVATION_COLUMNS.length
      && candidate.columns.every((column, index) => column === DESIGN_OBSERVATION_COLUMNS[index]));
    const table = matchingTables[0];
    const validTable = matchingTables.length === 1 && table.rows.length > 0;
    check('observations-table', validTable ? 'pass' : 'fail', validTable ? 'measured observations table is present' : `## ${DESIGN_OBSERVATIONS_HEADING} requires exactly one populated table with columns ${DESIGN_OBSERVATION_COLUMNS.join(' | ')}`);
    for (const row of table?.rows ?? []) {
      const id = `observation:line-${row.line}`;
      if (row.cells.length !== 8 || row.cells.some((cell) => cell === '')) { check(id, 'fail', `line ${row.line}: expected eight nonempty observation cells`); continue; }
      const [rawLabel, captureId, viewport, observation, field, value, unit, precision] = row.cells;
      const label = rawLabel.toLowerCase();
      const measured: ValidatedMeasurement = { line: row.line, label, capture: captureId, viewport, observation, field, value, unit, precision, status: 'unverified' };
      measurements.push(measured);
      const finish = (status: DesignValidationStatus, detail: string): void => {
        measured.status = status; check(id, status, `line ${row.line}: ${detail}`);
      };
      if (label === 'unavailable') {
        unavailableCoverage.add(captureId);
        finish('unverified', `measurement unavailable: ${value}`); continue;
      }
      if (label !== 'observed-reference' && label !== 'observed-clone') { finish('fail', 'Label must be observed-reference, observed-clone, or unavailable; put interpretation in prose'); continue; }
      if (!sourceAvailable) { finish('unverified', 'source evidence cannot be verified'); continue; }
      const capture = input.evidence!.captures.find((candidate) => candidate.id === captureId);
      if (!capture) { finish('fail', `capture ${captureId} does not exist`); continue; }
      const dimensions = /^(\d+)[x×](\d+)$/i.exec(viewport);
      if (!dimensions || Number(dimensions[1]) !== capture.viewport.width || Number(dimensions[2]) !== capture.viewport.height) { finish('fail', `Viewport does not match capture ${captureId} (${capture.viewport.width}x${capture.viewport.height})`); continue; }
      if (!capture.complete || !capture.observations.complete) { finish('unverified', `capture ${captureId} is incomplete`); continue; }
      const document = label === 'observed-reference' ? capture.observations : input.cloneObservations?.get(captureId);
      if (label === 'observed-clone' && input.cloneProblem) { finish('unverified', input.cloneProblem); continue; }
      if (!document || !document.complete) { finish('unverified', `current clone observations are unavailable or incomplete for ${captureId}`); continue; }
      if (document.viewport.width !== capture.viewport.width || document.viewport.height !== capture.viewport.height) { finish('unverified', 'saved observation viewport disagrees with source capture'); continue; }
      if (observation !== 'page' && !/^dl-[1-9]\d*$/.test(observation)) { finish('fail', 'Observation must be page or a stamped ID such as dl-17'); continue; }
      const matches = document.elements.filter((element) => element.dlId === observation);
      if (observation !== 'page' && matches.length !== 1) { finish('fail', `observation ${observation} is missing or ambiguous in capture ${captureId}`); continue; }
      const found = observedField(observation === 'page' ? document : matches[0], field);
      if (!found.found) { finish('fail', `field ${field} does not exist as an own observation property`); continue; }
      const difference = compareMeasuredValue(found.value, measured, document);
      if (difference) { finish('fail', difference); continue; }
      finish('pass', `${label} ${captureId}/${observation}/${field} matches saved evidence`);
      if (label === 'observed-reference') sourceCoverage.add(captureId);
      const measuredCategory = category(field);
      if (measuredCategory) categories.add(measuredCategory);
    }
  }
  for (const capture of completeCaptures) {
    const represented = sourceCoverage.has(capture.id);
    const explicitUnavailable = unavailableCoverage.has(capture.id);
    check(`viewport-coverage:${capture.id}`, represented ? 'pass' : explicitUnavailable ? 'unverified' : 'fail', represented
      ? `reference measurements cover ${capture.viewport.width}x${capture.viewport.height}`
      : `${capture.id} (${capture.viewport.width}x${capture.viewport.height}) has no verified observed-reference row`);
  }
  for (const required of ['layout', 'typography', 'color']) {
    check(`measurement-coverage:${required}`, categories.has(required) ? 'pass' : !sourceAvailable || incompleteCaptures.length > 0 || unavailableCoverage.size > 0 ? 'unverified' : 'fail', categories.has(required)
      ? `${required} has a verified measured claim` : `${required} requires at least one verified observed measurement`);
  }
  if (input.variations === null) check('variations-document', 'fail', 'VARIATIONS.md is missing or unreadable');
  else {
    const sections = headings(input.variations);
    for (const title of VARIATION_REQUIRED_HEADINGS) {
      const matches = sections.filter((heading) => heading.level === 2 && heading.title === title);
      check(`variations-section:${title}`, matches.length === 1 && matches[0].body.trim().length > 0 ? 'pass' : 'fail', `VARIATIONS.md requires one populated ## ${title} section`);
    }
    const variations = sections.filter((heading) => heading.level === 2 && /^Variation [A-Z]:\s*\S/.test(heading.title));
    const unique = new Set(variations.map((heading) => heading.title.split(':')[0]));
    const valid = variations.length >= 3 && variations.length <= 5 && unique.size === variations.length && variations.every((heading) => heading.body.trim().length > 0);
    check('variation-directions', valid ? 'pass' : 'fail', valid ? `${variations.length} named directions are present` : 'VARIATIONS.md requires 3–5 populated, uniquely lettered ## Variation A: Name blocks');
  }
  const status: DesignValidationStatus = checks.some((item) => item.status === 'fail') ? 'fail' : checks.some((item) => item.status === 'unverified') ? 'unverified' : 'pass';
  return { schemaVersion: 1, status, checks, issues: checks.filter((item) => item.status !== 'pass').map((item) => item.detail), measurements };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
async function optionalFile(root: string, name: string): Promise<string | null> {
  try { return await fs.readFile(await resolveEvidencePath(root, name), 'utf8'); }
  catch (error) {
    if (record(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function baseline(value: unknown, name: string): string | null {
  if (!record(value) || value.evidenceHash === undefined || value.evidenceHash === null) return null;
  if (typeof value.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.evidenceHash)) throw new Error(`invalid source baseline in ${name}`);
  return value.evidenceHash;
}

function cloneCapture(value: unknown, captures: SourceCapture[]): { id: string; observations: ObservationDocument } | null {
  if (!record(value) || typeof value.captureId !== 'string') throw new Error('invalid saved fidelity capture');
  if (value.observations === undefined) return null;
  const observations = value.observations;
  if (!record(observations) || !record(observations.viewport) || typeof observations.complete !== 'boolean'
      || typeof observations.rootFontSize !== 'string' || !Array.isArray(observations.elements)
      || !observations.elements.every((element) => record(element) && typeof element.dlId === 'string')) {
    throw new Error('invalid saved clone observations');
  }
  const source = captures.find((capture) => capture.id === value.captureId);
  if (!source || observations.viewport.width !== source.viewport.width || observations.viewport.height !== source.viewport.height) throw new Error('saved clone viewport does not match its source capture');
  return { id: value.captureId, observations: observations as unknown as ObservationDocument };
}

/** Read-only validation: this command never repairs, captures, refreshes, or writes artifacts. */
export async function runValidateDesign(projectDir: string): Promise<DesignValidationResult> {
  const root = path.resolve(projectDir);
  let design: string | null = null;
  let variations: string | null = null;
  const fileProblems: string[] = [];
  for (const name of ['DESIGN.md', 'VARIATIONS.md']) {
    try {
      const text = await optionalFile(root, name);
      if (name === 'DESIGN.md') design = text;
      else variations = text;
    } catch (error) { fileProblems.push(`${name}: ${errorMessage(error)}`); }
  }
  let evidence: EvidenceDocument | null = null;
  let sourceProblem: string | undefined;
  let fidelity: unknown = null;
  let fidelityProblem: string | undefined;
  try {
    const text = await optionalFile(root, 'fidelity.json');
    fidelity = text ? JSON.parse(text) : null;
  } catch (error) { fidelityProblem = `saved fidelity report is unreadable: ${errorMessage(error)}`; }
  try {
    evidence = await readEvidence(root);
    const manifestText = await optionalFile(root, 'manifest.json');
    const manifest: unknown = manifestText ? JSON.parse(manifestText) : null;
    const manifestHash = baseline(manifest, 'manifest.json');
    const priorHash = baseline(fidelity, 'fidelity.json');
    const actualHash = evidenceHash(evidence);
    if (!manifestHash && !priorHash) throw new Error('source evidence has no established manifest or fidelity baseline');
    if ((manifestHash && manifestHash !== actualHash) || (priorHash && priorHash !== actualHash)) throw new Error('source evidence differs from its established baseline');
  } catch (error) { sourceProblem = errorMessage(error); }
  const cloneObservations = new Map<string, ObservationDocument>();
  let cloneProblem: string | undefined;
  try {
    if (fidelityProblem) throw new Error(fidelityProblem);
    if (sourceProblem || !evidence) throw new Error('source evidence cannot be verified for clone measurements');
    if (!record(fidelity) || fidelity.schemaVersion !== 1 || !Array.isArray(fidelity.captures)) throw new Error('run fidelity to record current clone observations before claiming observed-clone measurements');
    if (fidelity.evidenceHash !== evidenceHash(evidence)) throw new Error('saved clone observations use a different source baseline');
    if (fidelity.cloneHash !== sha256(JSON.stringify(await hashTree(path.join(root, 'clone'))))) throw new Error('clone changed since its last fidelity measurement; run fidelity again');
    for (const candidate of fidelity.captures) {
      const parsed = cloneCapture(candidate, evidence.captures);
      if (!parsed) continue;
      if (cloneObservations.has(parsed.id)) throw new Error(`duplicate clone capture ${parsed.id}`);
      cloneObservations.set(parsed.id, parsed.observations);
    }
  } catch (error) { cloneProblem = errorMessage(error); }
  const report = validateDesignDocuments({ design, variations, evidence, sourceProblem, cloneObservations, cloneProblem });
  if (fileProblems.length > 0) report.issues.push(...fileProblems);
  return { report, json: `${JSON.stringify(report)}\n` };
}
