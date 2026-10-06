import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { converter, parse as parseColor } from 'culori';
import * as csstree from 'css-tree';

import type { ObservationDocument } from './observations.js';
import { evidenceHash, hashTree, readEvidence, resolveEvidencePath, sha256, type EvidenceDocument, type SourceCapture } from '../capture/evidence.js';
import { normalizeFontFamily, parseBuildContract } from './build-contract.js';
import { exactTables, headings, sectionChildren, tables, type MarkdownHeading, type MarkdownTable } from './markdown.js';
import { DARK_USAGES, parseToneDocument, TONE_METRICS, TONE_SHARE_METRICS, type ToneDocument } from './tone.js';

export { splitMarkdownRow } from './markdown.js';

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
export const FORM_CLASSES = [
  'pixel', 'stencil', 'square-terminal', 'techno', 'geometric-sans', 'grotesk', 'neo-grotesk', 'humanist', 'rounded',
  'condensed', 'wide', 'slab', 'mono', 'display-serif', 'text-serif', 'poster-heavy', 'script', 'handwritten', 'blackletter', 'other',
] as const;
export const TYPEFACE_FORMS_HEADING = 'Typeface forms';
export const TYPEFACE_FORMS_COLUMNS = ['Role', 'Source family and status', 'Form class', 'Form features', 'OFL substitutes'] as const;
/** A Typeface forms Role that names the display face; build-contract display-fonts are checked against these rows. */
export const DISPLAY_ROLE = /display|heading|headline|title|hero|디스플레이|헤드라인|헤딩|제목|타이틀|히어로/i;
/** Minimum number of distinct {@link FORM_FEATURE_VOCABULARY} features a Form features cell must name. */
export const MIN_FORM_FEATURES = 2;
/**
 * Letterform features a Form features cell may name, with accepted English and Korean terms. Latin
 * terms match as whole words (case-insensitive, optional plural s/es); Korean terms match anywhere.
 */
export const FORM_FEATURE_VOCABULARY: ReadonlyArray<{ feature: string; terms: readonly string[] }> = [
  { feature: 'terminals', terms: ['terminal', '단자', '터미널', '맺음'] },
  { feature: 'counters', terms: ['counter', '카운터', '속공간'] },
  { feature: 'aperture', terms: ['aperture', '어퍼처', '개구부'] },
  { feature: 'width', terms: ['width', 'wide', 'narrow', 'condensed', 'extended', 'compressed', 'expanded', '폭', '너비', '넓은', '좁은', '압축', '장체', '평체'] },
  { feature: 'case', terms: ['case', 'uppercase', 'lowercase', 'caps', 'all-caps', 'small-caps', '대문자', '소문자'] },
  { feature: 'stroke', terms: ['stroke', 'monoline', 'contrast', '획', '대비'] },
  { feature: 'weight', terms: ['weight', 'bold', 'heavy', 'thin', 'hairline', '굵기', '굵은', '가는', '두께'] },
  { feature: 'x-height', terms: ['x-height', 'xheight', '엑스하이트', 'x높이'] },
  { feature: 'corners', terms: ['corner', 'square', 'rounded', 'angular', 'chamfered', '모서리', '각진', '둥근'] },
  { feature: 'pixel', terms: ['pixel', 'pixelated', 'bitmap', '픽셀', '비트맵', '도트'] },
  { feature: 'stencil', terms: ['stencil', '스텐실'] },
  { feature: 'serif', terms: ['slab', 'serif', '세리프', '슬랩'] },
  { feature: 'geometric', terms: ['geometric', '기하'] },
  { feature: 'mono', terms: ['mono', 'monospaced', 'monospace', '고정폭'] },
  { feature: 'tracking', terms: ['tracking', 'letter-spacing', 'letterspacing', '자간'] },
  { feature: 'slant', terms: ['slant', 'slanted', 'italic', 'oblique', '기울기', '기울어진', '이탤릭'] },
];
export const TONE_BUDGET_HEADING = 'Tone budget';
export const TONE_BUDGET_COLUMNS = ['Capture', 'Viewport', 'Metric', 'Value', 'Unit', 'Precision'] as const;
export const SIGNATURE_PRIORITY_HEADING = 'Signature priority';
export const SIGNATURE_PRIORITY_COLUMNS = ['Rank', 'Device', 'Kind', 'Evidence', 'Transfer', 'Build check'] as const;
export const SIGNATURE_KINDS = ['tone', 'typeface', 'grid', 'layout', 'component', 'ornament', 'imagery', 'motion', 'chrome', 'content-pattern'] as const;
export const SIGNATURE_TRANSFERS = ['keep', 'adapt', 'substitute'] as const;
export const RETENTION_HEADING = 'Signature retention';
export const RETENTION_DECISIONS = ['keep', 'adapt', 'substitute', 'drop'] as const;
export const REFERENCE_FIDELITY_HEADING = 'Reference fidelity';
export const REFERENCE_FIDELITY_COLUMNS = ['Rank', 'Device', 'Decision', 'Verdict', 'Evidence'] as const;
export const FIDELITY_VERDICTS = ['present', 'partial', 'missing', 'dropped'] as const;
export const QA_RUN_ID = /^qa-\d+-[0-9a-f]{8}$/;

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
export interface DesignDocumentsReport {
  design: { sha256: string | null; basisSha256: string | null; status: DesignValidationStatus };
  variations: { sha256: string | null; status: DesignValidationStatus };
}
export interface DesignValidationReport {
  schemaVersion: 2;
  status: DesignValidationStatus;
  checks: DesignValidationCheck[];
  issues: string[];
  measurements: ValidatedMeasurement[];
  documents: DesignDocumentsReport;
  variationScores: Array<{ variation: string; score: number | null }>;
  referenceFidelity: { required: boolean; score: number | null; qaRun: string | null };
}
export interface QaRunState {
  status: 'pass' | 'fail' | 'unverified';
  reviewConfirmed: boolean;
  signatureChecks?: Array<{ rank: number; pass: boolean }>;
  skipped?: string[];
  problem?: string;
  /** qa.json `project`; null when qa ran without --project (no Build contract, lineage or reuse checks). */
  project?: string | null;
  /** {@link buildContractKey} of the Build contract the run checked; null when it ran without one. */
  contractKey?: string | null;
  /** qa.json `mode` (a `--mode` override may differ from the contract's). */
  mode?: string | null;
}

/** Canonical identity of a Build contract: what qa checks, without Sources or line numbers. */
export function buildContractKey(contract: {
  mode: string; fonts: readonly string[]; displayFonts: readonly string[]; darkShareMax: number; fullBleedDarkMax: number;
  stylesheets?: string | null; checks: ReadonlyArray<{ rank: number; selector: string; property: string; op: string; value: string }>;
}): string {
  const checks = contract.checks.map((item) => [item.rank, item.selector.trim(), item.property.trim(), item.op, item.value.trim()] as const)
    .sort((left, right) => left[0] - right[0] || JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify([contract.mode, contract.fonts.map(normalizeFontFamily), contract.displayFonts.map(normalizeFontFamily),
    contract.darkShareMax, contract.fullBleedDarkMax, contract.mode === 'clone-base' ? contract.stylesheets ?? null : null, checks]);
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
  /** Structurally valid tone.json whose screenshot hashes were checked at the I/O boundary; undefined = missing. */
  tone?: ToneDocument | null;
  toneProblem?: string;
  /** Saved QA runs keyed by run id; only cited runs need an entry. */
  qaRuns?: ReadonlyMap<string, QaRunState>;
  /** Every `qa/qa-*` directory that holds a qa.json; only ids matching QA_RUN_ID compete for "newest". */
  qaRunIds?: readonly string[];
}
export interface DesignValidationResult { report: DesignValidationReport; json: string }

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
  return compareRounded(number, claim.value, claim.precision, claim.unit);
}

/** Claimed Value must equal `actual` rounded half-up to `precision` (0–6) decimals; null on a match. */
export function compareRounded(actual: number, value: string, precision: string, unit?: string): string | null {
  if (!/^[0-6]$/.test(precision)) return 'numeric values require Precision from 0 through 6';
  if (!NUMBER.test(value) || !Number.isFinite(Number(value))) return 'numeric Value must contain only a finite number; place its unit in Unit';
  if (!Number.isFinite(actual)) return 'observed number is not finite';
  const factor = 10 ** Number(precision);
  const expected = Math.round((actual + Number.EPSILON) * factor) / factor;
  return Math.abs(expected - Number(value)) <= Number.EPSILON * Math.max(1, Math.abs(expected)) * 4
    ? null : `value differs from the observation rounded to ${precision} decimal places (expected ${expected}${unit ? ` ${unit}` : ''})`;
}

function category(field: string): 'layout' | 'typography' | 'color' | null {
  if (/^((?:body\.)?rect\.|width$|height$)/.test(field) || /(?:^|\.)(?:width|height|minWidth|maxWidth|minHeight|maxHeight|margin\w*|padding\w*|rowGap|columnGap|display|position|grid\w*|flex\w*|align\w*|justifyContent)$/.test(field)) return 'layout';
  if (field === 'rootFontSize' || /(?:^|\.)(?:font\w*|lineHeight|letterSpacing|wordSpacing)$/.test(field)) return 'typography';
  if (/(?:^|\.)(?:color|\w+Color)$/.test(field)) return 'color';
  return null;
}

type CheckSink = (id: string, status: DesignValidationStatus, detail: string) => void;

const STATUS_ORDER: Record<DesignValidationStatus, number> = { pass: 0, unverified: 1, fail: 2 };
function worst(statuses: readonly DesignValidationStatus[]): DesignValidationStatus {
  return statuses.reduce<DesignValidationStatus>((left, right) => (STATUS_ORDER[right] > STATUS_ORDER[left] ? right : left), 'pass');
}
function best(statuses: readonly DesignValidationStatus[]): DesignValidationStatus {
  return statuses.reduce<DesignValidationStatus>((left, right) => (STATUS_ORDER[right] < STATUS_ORDER[left] ? right : left), 'fail');
}
function round3(value: number): number { return Math.round(value * 1000) / 1000; }
function collapse(text: string): string { return text.replace(/\s+/g, ' ').trim(); }
function matchesSection(title: string, prefix: string): boolean {
  return title === prefix || title.startsWith(`${prefix} `) || title.startsWith(`${prefix}:`);
}

interface LocatedTable { table: MarkdownTable | null; problem: string }
function locateDesignTable(sections: readonly MarkdownHeading[], prefix: string, heading: string, columns: readonly string[]): LocatedTable {
  const parents = sections.filter((candidate) => candidate.level === 2 && matchesSection(candidate.title, prefix));
  const children = parents.length === 1 ? sectionChildren(sections, parents[0], 3).filter((candidate) => candidate.title === heading) : [];
  const found = children.length === 1 ? exactTables(children[0].body, children[0].line, columns) : [];
  const problem = `## ${prefix} requires exactly one ### ${heading} with one populated table ${columns.join(' | ')}`;
  return { table: found.length === 1 && found[0].rows.length > 0 ? found[0] : null, problem };
}

function basisOf(sections: readonly MarkdownHeading[]): string | null {
  const located = [
    locateDesignTable(sections, '5. Typography', TYPEFACE_FORMS_HEADING, TYPEFACE_FORMS_COLUMNS),
    locateDesignTable(sections, '6. Color System', TONE_BUDGET_HEADING, TONE_BUDGET_COLUMNS),
    locateDesignTable(sections, '10. Signature Moves', SIGNATURE_PRIORITY_HEADING, SIGNATURE_PRIORITY_COLUMNS),
  ];
  if (located.some((item) => item.table === null)) return null;
  return sha256(located.map((item) => item.table!.rows.map((row) => row.cells.map((cell) => cell.trim()).join('\u001f')).join('\n')).join('\n\u001e\n'));
}

/** Hash of the canonical Typeface forms, Tone budget and Signature priority rows; it proves consistency, not ordering. */
export function designBasisSha256(design: string): string | null { return basisOf(headings(design)); }

function formClasses(value: string): string[] {
  return value.split(/[/+,]/).map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0);
}
function knownFormClass(token: string): boolean { return (FORM_CLASSES as readonly string[]).includes(token); }

const FEATURE_MATCHERS = FORM_FEATURE_VOCABULARY.map(({ feature, terms }) => ({
  feature,
  patterns: terms.map((term) => (/^[\x20-\x7e]+$/.test(term)
    ? new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?:e?s)?(?![a-z0-9])`, 'i')
    : { test: (text: string): boolean => text.includes(term) })),
}));

/** Distinct {@link FORM_FEATURE_VOCABULARY} features named in a Form features cell, in vocabulary order. */
export function formFeaturesNamed(text: string): string[] {
  return FEATURE_MATCHERS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text))).map(({ feature }) => feature);
}

/** Case-, quote- and whitespace-insensitive key used to tell a family name from a form description. */
function familyKey(value: string): string {
  return value.replace(/["'`‘’“”]/g, '').replace(/\s+/g, '').toLowerCase();
}

/** Families named before the status part of a "Source family and status" cell (e.g. `"Labs", monospace; loaded`). */
function sourceFamilies(cell: string): string[] {
  const head = cell.split(/[(;]|\s[—–-]\s/)[0];
  return [cell, head, ...head.split(',')].map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Why a Form features cell does not describe letterforms, or null when it does. */
export function formFeaturesProblem(features: string, sourceCell: string, substituteFamilies: readonly string[]): string | null {
  const key = familyKey(features);
  const family = [...sourceFamilies(sourceCell), ...substituteFamilies].find((name) => familyKey(name) === key);
  if (family !== undefined) return `Form features "${features}" only names the family ${family}; describe the letterforms instead`;
  const named = formFeaturesNamed(features);
  if (named.length < MIN_FORM_FEATURES) {
    return `Form features must name at least ${MIN_FORM_FEATURES} distinct form features (terminals, counters, aperture, width, case, stroke, weight, x-height, corners, pixel, stencil, serif, geometric, mono, tracking, slant; English or Korean terms); found ${named.length === 0 ? 'none' : named.join(', ')}`;
  }
  return null;
}

interface TypefaceEntry { role: string; substitutes: string[] }
interface SignatureEntry { rank: number; device: string; kind: string; transfer: string }
interface ToneRow { capture: string; metric: string; status: DesignValidationStatus }
interface DesignFacts { typeface: TypefaceEntry[] | null; signature: Map<number, SignatureEntry> | null }

function checkTypefaceForms(sections: readonly MarkdownHeading[], check: CheckSink): TypefaceEntry[] | null {
  const located = locateDesignTable(sections, '5. Typography', TYPEFACE_FORMS_HEADING, TYPEFACE_FORMS_COLUMNS);
  if (!located.table) { check('typeface-forms', 'fail', located.problem); return null; }
  if (located.table.rows.some((row) => DISPLAY_ROLE.test(row.cells[0] ?? ''))) check('typeface-forms', 'pass', 'typeface forms table is present');
  else check('typeface-forms', 'fail', 'Typeface forms needs at least one row whose Role names the display face (display, heading, headline, title or hero, or Korean 디스플레이, 헤드라인, 제목, 타이틀 or 히어로); classify the headline typeface from its original viewport crop and list same-class OFL substitutes');
  const entries: TypefaceEntry[] = [];
  for (const row of located.table.rows) {
    const id = `typeface:line-${row.line}`;
    if (row.cells.length !== TYPEFACE_FORMS_COLUMNS.length || row.cells.some((cell) => cell === '' || cell === '-')) {
      check(id, 'fail', `line ${row.line}: typeface rows need ${TYPEFACE_FORMS_COLUMNS.length} nonempty cells (not -)`); continue;
    }
    const [role, sourceCell, formClass, features, substituteCell] = row.cells;
    const classes = formClasses(formClass);
    const unknown = classes.filter((token) => !knownFormClass(token));
    if (classes.length === 0 || unknown.length > 0) {
      check(id, 'fail', `line ${row.line}: Form class tokens must come from ${FORM_CLASSES.join(', ')}${unknown.length > 0 ? ` (unknown: ${unknown.join(', ')})` : ''}`); continue;
    }
    const problems: string[] = [];
    const substitutes: string[] = [];
    const listed = substituteCell.split(';').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    if (listed.length === 0) problems.push('OFL substitutes must list at least one Family (class)');
    for (const entry of listed) {
      const parsed = /^(.+?)\s*\(([^()]+)\)$/.exec(entry);
      if (!parsed) { problems.push(`OFL substitute "${entry}" must be written Family (class[/class])`); continue; }
      const entryClasses = formClasses(parsed[2]);
      if (entryClasses.length === 0 || entryClasses.some((token) => !knownFormClass(token))) problems.push(`OFL substitute ${parsed[1]} uses an unknown form class (${parsed[2]})`);
      else if (!entryClasses.some((token) => classes.includes(token))) problems.push(`OFL substitute ${parsed[1]} (${parsed[2]}) shares no form class with ${formClass}`);
      else substitutes.push(parsed[1].trim());
    }
    const featureProblem = formFeaturesProblem(features, sourceCell, listed.map((entry) => entry.replace(/\s*\([^()]*\)$/, '')));
    if (featureProblem) problems.push(featureProblem);
    if (problems.length > 0) { check(id, 'fail', `line ${row.line}: ${problems.join('; ')}`); continue; }
    entries.push({ role, substitutes });
    check(id, 'pass', `line ${row.line}: ${role} is classified ${classes.join('/')} with same-class OFL substitutes`);
  }
  return entries;
}

const TONE_RERUN = 'run design-lens tone on the project';

function toneFormatProblem(metric: string, value: string, unit: string, precision: string): string | null {
  if ((TONE_SHARE_METRICS as readonly string[]).includes(metric)) {
    if (unit !== 'ratio') return `${metric} requires Unit ratio`;
    if (!/^[0-6]$/.test(precision)) return `${metric} requires Precision from 0 through 6`;
    if (!NUMBER.test(value) || !(Number(value) >= 0 && Number(value) <= 1)) return `${metric} Value must be a number in [0, 1]`;
    return null;
  }
  if (metric === 'darkBandCount') {
    if (unit !== 'unitless' || precision !== '0') return 'darkBandCount requires Unit unitless and Precision 0';
    return /^\d+$/.test(value) ? null : 'darkBandCount Value must be a whole number';
  }
  if (unit !== 'css' || precision !== '-') return 'darkUsage requires Unit css and Precision -';
  return (DARK_USAGES as readonly string[]).includes(value) ? null : `darkUsage Value must be one of ${DARK_USAGES.join(', ')}`;
}

function checkToneBudget(sections: readonly MarkdownHeading[], input: DesignValidationInput, sourceAvailable: boolean,
  tone: ToneDocument | null, toneDetail: string, check: CheckSink): ToneRow[] {
  const located = locateDesignTable(sections, '6. Color System', TONE_BUDGET_HEADING, TONE_BUDGET_COLUMNS);
  check('tone-budget', located.table ? 'pass' : 'fail', located.table ? 'tone budget table is present' : located.problem);
  const rows: ToneRow[] = [];
  if (!located.table) return rows;
  for (const row of located.table.rows) {
    const id = `tone:line-${row.line}`;
    if (row.cells.length !== TONE_BUDGET_COLUMNS.length || row.cells.some((cell) => cell === '')) {
      check(id, 'fail', `line ${row.line}: expected ${TONE_BUDGET_COLUMNS.length} nonempty tone budget cells`); continue;
    }
    const [captureId, viewport, metric, value, unit, precision] = row.cells;
    const finish = (status: DesignValidationStatus, detail: string): void => {
      rows.push({ capture: captureId, metric, status }); check(id, status, `line ${row.line}: ${detail}`);
    };
    if (!(TONE_METRICS as readonly string[]).includes(metric)) { finish('fail', `Metric must be one of ${TONE_METRICS.join(', ')}`); continue; }
    const format = toneFormatProblem(metric, value, unit, precision);
    if (format) { finish('fail', format); continue; }
    if (!sourceAvailable) { finish('unverified', 'source evidence cannot be verified'); continue; }
    const capture = input.evidence!.captures.find((candidate) => candidate.id === captureId);
    if (!capture) { finish('fail', `capture ${captureId} does not exist`); continue; }
    const dimensions = /^(\d+)[x×](\d+)$/i.exec(viewport);
    if (!dimensions || Number(dimensions[1]) !== capture.viewport.width || Number(dimensions[2]) !== capture.viewport.height) { finish('fail', `Viewport does not match capture ${captureId} (${capture.viewport.width}x${capture.viewport.height})`); continue; }
    if (!capture.complete || !capture.observations.complete) { finish('unverified', `capture ${captureId} is incomplete`); continue; }
    if (!tone) { finish('unverified', toneDetail); continue; }
    const entry = tone.captures.find((candidate) => candidate.captureId === captureId);
    if (!entry || !entry.profile) { finish('unverified', `tone.json has no profile for ${captureId}${entry?.reason ? ` (${entry.reason})` : ''}; ${TONE_RERUN}`); continue; }
    const actual = entry.profile[metric as keyof typeof entry.profile];
    if (metric === 'darkUsage') { finish(actual === value ? 'pass' : 'fail', actual === value ? `${captureId} darkUsage matches tone.json` : `darkUsage differs from tone.json (expected ${String(actual)})`); continue; }
    const difference = typeof actual === 'number' ? compareRounded(actual, value, precision, unit) : 'tone.json value is not numeric';
    finish(difference ? 'fail' : 'pass', difference ?? `${captureId} ${metric} matches tone.json`);
  }
  if (tone && sourceAvailable) {
    for (const entry of tone.captures) {
      if (!entry.profile || !input.evidence!.captures.some((capture) => capture.id === entry.captureId)) continue;
      const missing = ['darkShare', 'fullBleedDarkShare'].filter((metric) => !rows.some((row) => row.capture === entry.captureId && row.metric === metric));
      check(`tone-coverage:${entry.captureId}`, missing.length > 0 ? 'fail' : 'pass', missing.length > 0
        ? `Tone budget needs ${missing.join(' and ')} rows for ${entry.captureId}` : `tone budget covers ${entry.captureId}`);
    }
  }
  return rows;
}

const MEASURED_CITATION = /\b([A-Za-z0-9_-]+)\/(page|dl-[1-9]\d*)\/([A-Za-z0-9_.-]+)/g;
const TONE_CITATION = /\btone\/([A-Za-z0-9_-]+)\/([A-Za-z]+)\b/g;

function checkSignaturePriority(sections: readonly MarkdownHeading[], measurements: readonly ValidatedMeasurement[],
  toneRows: readonly ToneRow[], check: CheckSink): Map<number, SignatureEntry> | null {
  const located = locateDesignTable(sections, '10. Signature Moves', SIGNATURE_PRIORITY_HEADING, SIGNATURE_PRIORITY_COLUMNS);
  const table = located.table;
  const count = table?.rows.length ?? 0;
  const ordered = table !== null && table.rows.every((row, index) => row.cells[0] === String(index + 1));
  const valid = table !== null && count >= 5 && count <= 10 && ordered;
  check('signature-priority', valid ? 'pass' : 'fail', !table ? located.problem
    : count < 5 || count > 10 ? `Signature priority requires 5–10 ranked devices (found ${count})`
      : !ordered ? 'Signature priority Rank must run 1..N in row order' : `${count} ranked signature devices are present`);
  if (!table) return null;
  const entries = new Map<number, SignatureEntry>();
  let toneCited = false;
  let fontCited = false;
  const kinds = new Set<string>();
  for (const row of table.rows) {
    const id = `signature:line-${row.line}`;
    const [rank = '', device = '', kind = '', evidenceCell = '', transfer = ''] = row.cells;
    const entry: SignatureEntry = { rank: Number(rank), device, kind: kind.toLowerCase(), transfer: transfer.toLowerCase() };
    if (/^[1-9]\d*$/.test(rank) && !entries.has(entry.rank)) entries.set(entry.rank, entry);
    if (row.cells.length !== SIGNATURE_PRIORITY_COLUMNS.length || row.cells.some((cell) => cell === '' || cell === '-')) {
      check(id, 'fail', `line ${row.line}: signature rows need ${SIGNATURE_PRIORITY_COLUMNS.length} nonempty cells (not -)`); continue;
    }
    const problems: string[] = [];
    if (!(SIGNATURE_KINDS as readonly string[]).includes(entry.kind)) problems.push(`Kind must be one of ${SIGNATURE_KINDS.join(', ')}`);
    if (!(SIGNATURE_TRANSFERS as readonly string[]).includes(entry.transfer)) problems.push(`Transfer must be one of ${SIGNATURE_TRANSFERS.join(', ')}`);
    const statuses: DesignValidationStatus[] = [];
    let rowTone = false;
    let rowFont = false;
    for (const match of evidenceCell.matchAll(MEASURED_CITATION)) {
      const field = match[3].replace(/\.+$/, '');
      const cited = measurements.filter((measurement) => measurement.capture === match[1] && measurement.observation === match[2] && measurement.field === field);
      if (cited.length === 0) problems.push(`${match[1]}/${match[2]}/${field} matches no Measured observations row`);
      else { statuses.push(best(cited.map((measurement) => measurement.status))); if (field === 'styles.fontFamily') rowFont = true; }
    }
    for (const match of evidenceCell.matchAll(TONE_CITATION)) {
      const cited = toneRows.filter((toneRow) => toneRow.capture === match[1] && toneRow.metric === match[2]);
      if (cited.length === 0) problems.push(`tone/${match[1]}/${match[2]} matches no Tone budget row`);
      else { statuses.push(best(cited.map((toneRow) => toneRow.status))); rowTone = true; }
    }
    if (statuses.length === 0 && problems.every((problem) => !problem.includes('matches no'))) problems.push('Evidence must cite a measured row (capture/dl-N/field or capture/page/field) or a tone row (tone/capture/metric)');
    if (problems.length > 0) { check(id, 'fail', `line ${row.line}: ${problems.join('; ')}`); continue; }
    kinds.add(entry.kind);
    if (entry.kind === 'tone' && rowTone) toneCited = true;
    if (entry.kind === 'typeface' && rowFont) fontCited = true;
    const status = worst(statuses);
    check(id, status, `line ${row.line}: rank ${rank} cites ${status === 'pass' ? 'verified' : status === 'fail' ? 'failing' : 'unverified'} evidence`);
  }
  const kindProblems: string[] = [];
  if (kinds.size < 3) kindProblems.push(`at least 3 distinct Kinds are required (found ${kinds.size})`);
  if (!toneCited) kindProblems.push('a tone row must cite a Tone budget row');
  if (!fontCited) kindProblems.push('a typeface row must cite a measured styles.fontFamily row');
  check('signature-kinds', kindProblems.length > 0 ? 'fail' : 'pass', kindProblems.length > 0 ? `Signature priority: ${kindProblems.join('; ')}` : 'signature kinds include measured tone and typeface devices');
  return valid ? entries : null;
}

const SIGNATURE_UNAVAILABLE = 'signature priority table is unavailable';
const QUOTE_PREFIX = /^(Brief|Content|User):/;

interface VariationOutcome {
  scores: Array<{ variation: string; score: number | null }>;
  referenceFidelity: { required: boolean; score: number | null; qaRun: string | null };
}

function qaEpoch(runId: string): number { return Number(/^qa-(\d+)-/.exec(runId)?.[1] ?? Number.NaN); }

function validateVariationExtensions(sections: readonly MarkdownHeading[], variationsText: string, letters: readonly string[],
  facts: DesignFacts, basisSha256: string | null, tone: ToneDocument | null, toneDetail: string, input: DesignValidationInput, check: CheckSink): VariationOutcome {
  const briefSections = sections.filter((heading) => heading.level === 2 && heading.title === 'Target brief');
  const brief = briefSections.length === 1 ? collapse(briefSections[0].body) : '';
  const quoteProblem = (cell: string): string | null => {
    if (!QUOTE_PREFIX.test(cell.trim())) return null;
    const quotes = [...cell.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((match) => collapse(match[1] ?? match[2]));
    return quotes.length > 0 && quotes.every((quote) => quote.length > 0 && brief.includes(quote)) ? null : 'quoted requirement is not in the Target brief';
  };
  const verifiedQuote = (cell: string | undefined): boolean => cell !== undefined && QUOTE_PREFIX.test(cell.trim()) && quoteProblem(cell) === null;
  const signature = facts.signature;
  const ranks = signature ? [...signature.keys()].sort((left, right) => left - right) : [];
  const weight = (rank: number): number => ranks.length - rank + 1;

  const decisions = new Map<string, Map<number, string>>(letters.map((letter) => [letter, new Map<number, string>()]));
  const retentionColumns = ['Rank', ...letters.map((letter) => `Variation ${letter}`), 'Drop basis'];
  const retentionSections = sections.filter((heading) => heading.level === 2 && heading.title === RETENTION_HEADING);
  const retentionTables = retentionSections.length === 1 ? exactTables(retentionSections[0].body, retentionSections[0].line, retentionColumns) : [];
  let retentionValid = false;
  if (retentionTables.length !== 1 || retentionTables[0].rows.length === 0) {
    check('signature-retention', 'fail', `VARIATIONS.md requires one ## ${RETENTION_HEADING} section with one table ${retentionColumns.join(' | ')}`);
  } else {
    const seen = new Set<number>();
    let rowsValid = true;
    for (const row of retentionTables[0].rows) {
      const id = `retention:line-${row.line}`;
      if (row.cells.length !== retentionColumns.length || row.cells.slice(0, -1).some((cell) => cell === '')) {
        rowsValid = false; check(id, 'fail', `line ${row.line}: retention rows need a Rank, one decision per variation and a Drop basis cell`); continue;
      }
      const rank = /^[1-9]\d*$/.test(row.cells[0]) ? Number(row.cells[0]) : Number.NaN;
      const dropBasis = row.cells[row.cells.length - 1];
      const problems: string[] = [];
      let unverified: string | null = null;
      if (!Number.isFinite(rank)) problems.push('Rank must be a positive whole number');
      else if (seen.has(rank)) problems.push(`rank ${rank} appears more than once`);
      else if (signature && !signature.has(rank)) problems.push(`rank ${rank} is not a Signature priority rank`);
      else if (!signature) unverified = SIGNATURE_UNAVAILABLE;
      if (Number.isFinite(rank)) seen.add(rank);
      const droppedBy: string[] = [];
      letters.forEach((letter, index) => {
        const parsed = /^(keep|adapt|substitute|drop)\s*:\s*(\S[\s\S]*)$/i.exec(row.cells[index + 1]);
        if (!parsed) { problems.push(`Variation ${letter} cell must be "<keep|adapt|substitute|drop>: <treatment>"`); return; }
        const decision = parsed[1].toLowerCase();
        if (Number.isFinite(rank)) decisions.get(letter)!.set(rank, decision);
        if (decision === 'drop') droppedBy.push(letter);
      });
      const quote = quoteProblem(dropBasis);
      if (quote) problems.push(quote);
      if (Number.isFinite(rank) && rank <= 3 && droppedBy.length > 0 && !verifiedQuote(dropBasis)) {
        problems.push(`rank ${rank} is dropped by Variation ${droppedBy.join(', ')} without a quoted Brief:, Content: or User: Drop basis`);
      } else if (letters.length > 1 && droppedBy.length === letters.length && !verifiedQuote(dropBasis)) {
        // A signature every direction drops can never be restored by choosing a direction.
        problems.push(`rank ${rank} is dropped by every variation; keep, adapt or substitute it in at least one variation, or give a quoted Brief:, Content: or User: Drop basis`);
      }
      if (problems.length > 0) rowsValid = false;
      check(id, problems.length > 0 ? 'fail' : unverified ? 'unverified' : 'pass', `line ${row.line}: ${problems.length > 0 ? problems.join('; ') : unverified ?? `rank ${rank} has a decision for every variation`}`);
    }
    if (!signature) check('signature-retention', 'unverified', SIGNATURE_UNAVAILABLE);
    else {
      const missing = ranks.filter((rank) => !seen.has(rank));
      retentionValid = missing.length === 0 && rowsValid && seen.size === ranks.length;
      check('signature-retention', missing.length > 0 ? 'fail' : 'pass', missing.length > 0
        ? `Signature retention must list every Signature priority rank once (missing ${missing.join(', ')})` : 'every ranked signature has a retention decision per variation');
    }
  }
  const values: Record<string, number> = { keep: 1, adapt: 0.75, substitute: 0.75, drop: 0 };
  const scores = letters.map((letter) => {
    const chosen = decisions.get(letter)!;
    if (!signature || !retentionValid || !ranks.every((rank) => chosen.has(rank))) return { variation: letter, score: null };
    const total = ranks.reduce((sum, rank) => sum + weight(rank), 0);
    return { variation: letter, score: round3(ranks.reduce((sum, rank) => sum + weight(rank) * values[chosen.get(rank)!], 0) / total) };
  });
  const scored = scores.filter((item): item is { variation: string; score: number } => item.score !== null);
  const maxScore = scored.length > 0 ? Math.max(...scored.map((item) => item.score)) : null;
  check('retention-range', maxScore === null ? (signature ? 'fail' : 'unverified') : maxScore < 0.75 ? 'fail' : 'pass', maxScore === null
    ? (signature ? 'variation retention scores are unavailable until the Signature retention table is valid' : SIGNATURE_UNAVAILABLE)
    : maxScore < 0.75 ? `no high-retention direction: the best variation scores ${maxScore} (needs ≥ 0.75)` : `the best variation retains ${maxScore} of the weighted signatures`);

  const selectedSections = sections.filter((heading) => heading.level === 2 && heading.title === 'Selected direction');
  const selectedBody = selectedSections.length === 1 ? selectedSections[0].body : '';
  // Emphasis around the choice (`**Direction:** **C — Campus**`) is formatting, not a different letter.
  const direction = /\*\*Direction:\*\*\s*(?:[*_]{1,2})?(?:Variation\s+)?([A-Z])(?![A-Za-z0-9])/.exec(selectedBody);
  const selected = direction && letters.includes(direction[1]) ? direction[1] : null;
  const selectedDecisions = selected ? decisions.get(selected)! : null;
  const directionProblems: string[] = [];
  const directionUnverified: string[] = [];
  if (!selected) directionProblems.push('**Direction:** must name an existing Variation <L> (write e.g. "- **Direction:** Variation A")');
  const basis = /\*\*Design basis:\*\*\s*`?sha256:([a-f0-9]{64})`?/.exec(selectedBody);
  if (!basis) directionProblems.push('record the design basis the direction was selected against (validate-design --json documents.design.basisSha256)');
  else if (basisSha256 === null) directionUnverified.push('the design basis is unavailable until DESIGN.md has valid Typeface forms, Tone budget and Signature priority tables');
  else if (basis[1] !== basisSha256) directionProblems.push('the signature, typeface or tone tables changed after the direction was selected; re-evaluate the direction and update the design basis');
  const selectedScore = scores.find((item) => item.variation === selected)?.score ?? null;
  if (selectedScore !== null && maxScore !== null && selectedScore < maxScore - 0.1 - 1e-9) {
    const selection = /\*\*Selection basis:\*\*[ \t]*(.*)$/m.exec(selectedBody);
    const text = selection ? selection[1].trim() : '';
    if (!/^(User|Brief):/.test(text) || !verifiedQuote(text)) {
      directionProblems.push(`Variation ${selected} scores ${selectedScore}, more than 0.10 below the best (${maxScore}); add a **Selection basis:** bullet with a quoted User: or Brief: clause from the Target brief`);
    }
  }
  check('selected-direction', directionProblems.length > 0 ? 'fail' : directionUnverified.length > 0 ? 'unverified' : 'pass',
    [...directionProblems, ...directionUnverified].join('; ') || `Variation ${selected} is selected against the current design basis`);

  const parsed = parseBuildContract(variationsText);
  const contractProblems = [...parsed.problems];
  const contractUnverified: string[] = [];
  const contract = parsed.contract;
  if (contract) {
    for (const [key, source] of Object.entries(contract.sources)) {
      const problem = quoteProblem(source);
      if (problem) contractProblems.push(`${key} Source: ${problem}`);
    }
    if (!facts.typeface) contractUnverified.push('typeface forms table is unavailable');
    else {
      const substitutes = new Set(facts.typeface.flatMap((entry) => entry.substitutes.map(normalizeFontFamily)));
      const unlisted = contract.fonts.filter((family) => !substitutes.has(normalizeFontFamily(family)));
      if (unlisted.length > 0) contractProblems.push(`fonts must be OFL substitutes listed in Typeface forms (not listed: ${unlisted.join('; ')})`);
      const display = new Set(contract.displayFonts.map(normalizeFontFamily));
      for (const entry of facts.typeface.filter((item) => DISPLAY_ROLE.test(item.role))) {
        if (!entry.substitutes.some((family) => display.has(normalizeFontFamily(family)))) {
          contractProblems.push(`display-fonts must include a substitute for the ${entry.role} typeface (${entry.substitutes.join('; ')})`);
        }
      }
    }
    const profiles = tone ? tone.captures.flatMap((entry) => (entry.profile ? [entry.profile] : [])) : [];
    if (!tone || profiles.length === 0) contractUnverified.push(`tone maxima cannot be checked: ${tone ? `tone.json has no profiles; ${TONE_RERUN}` : toneDetail}`);
    else {
      const darkMax = Math.max(...profiles.map((profile) => profile.darkShare));
      const bleedMax = Math.max(...profiles.map((profile) => profile.fullBleedDarkShare));
      if (contract.darkShareMax > darkMax + 0.1 + 1e-9 && !verifiedQuote(contract.sources['dark-share-max'])) {
        contractProblems.push(`dark-share-max ${contract.darkShareMax} exceeds the reference darkShare ${darkMax} + 0.10; lower it or cite a quoted Brief:, Content: or User: requirement as its Source`);
      }
      if (contract.fullBleedDarkMax > bleedMax + 0.03 + 1e-9 && !verifiedQuote(contract.sources['full-bleed-dark-max'])) {
        contractProblems.push(`full-bleed-dark-max ${contract.fullBleedDarkMax} exceeds the reference fullBleedDarkShare ${bleedMax} + 0.03; lower it or cite a quoted Brief:, Content: or User: requirement as its Source`);
      }
    }
    if (!signature) contractUnverified.push(SIGNATURE_UNAVAILABLE);
    else {
      const unknownRanks = [...new Set(contract.checks.filter((item) => !signature.has(item.rank)).map((item) => item.rank))];
      if (unknownRanks.length > 0) contractProblems.push(`check rows name ranks that are not in Signature priority (${unknownRanks.join(', ')})`);
      if (!selectedDecisions || ranks.some((rank) => !selectedDecisions.has(rank))) contractUnverified.push('the selected variation\'s retention decisions are unavailable');
      else {
        for (const rank of ranks.filter((item) => item <= 3)) {
          const entry = signature.get(rank)!;
          if (selectedDecisions.get(rank) === 'drop' || entry.kind === 'tone' || entry.kind === 'motion') continue;
          if (!contract.checks.some((item) => item.rank === rank)) contractProblems.push(`rank ${rank} (${entry.device}) is retained by Variation ${selected} and needs at least one check:${rank} row`);
        }
      }
    }
  }
  check('build-contract', contractProblems.length > 0 ? 'fail' : contractUnverified.length > 0 ? 'unverified' : 'pass',
    [...contractProblems, ...contractUnverified].join('; ') || `build contract (${contract?.mode}) agrees with Typeface forms, tone.json and the selected signatures`);

  const runIds = (input.qaRunIds ?? []).filter((runId) => QA_RUN_ID.test(runId));
  const criteria = sections.filter((heading) => heading.level === 2 && heading.title === 'Verification criteria');
  const criteriaRan = criteria.length === 1 && tables(criteria[0].body, criteria[0].line)
    .some((table) => table.rows.some((row) => row.cells.length > 0 && !/^planned/i.test(row.cells[row.cells.length - 1].trim())));
  const required = (input.qaRunIds ?? []).length > 0 || criteriaRan;
  const fidelitySections = sections.filter((heading) => heading.level === 2 && heading.title === REFERENCE_FIDELITY_HEADING);
  const outcome: VariationOutcome = { scores, referenceFidelity: { required, score: null, qaRun: null } };
  if (fidelitySections.length === 0 && !required) {
    check('reference-fidelity', 'pass', 'reference fidelity is not required until a QA run exists or a verification criterion has run');
    return outcome;
  }
  const fidelityTables = fidelitySections.length === 1 ? exactTables(fidelitySections[0].body, fidelitySections[0].line, REFERENCE_FIDELITY_COLUMNS) : [];
  if (fidelityTables.length !== 1 || fidelityTables[0].rows.length === 0) {
    check('reference-fidelity', 'fail', `VARIATIONS.md requires one ## ${REFERENCE_FIDELITY_HEADING} section with one table ${REFERENCE_FIDELITY_COLUMNS.join(' | ')}${required ? ' because a QA run exists or a verification criterion has run' : ''}`);
    if (required) check('reference-fidelity-qa', 'fail', 'reference fidelity cites no QA run');
    return outcome;
  }
  const verdicts = new Map<number, string>();
  const cited = new Set<string>();
  const seen = new Set<number>();
  let rowsComplete = true;
  const allowed: readonly string[] = required ? FIDELITY_VERDICTS : [...FIDELITY_VERDICTS, 'planned'];
  for (const row of fidelityTables[0].rows) {
    const id = `fidelity:line-${row.line}`;
    if (row.cells.length !== REFERENCE_FIDELITY_COLUMNS.length || row.cells.some((cell) => cell === '')) {
      rowsComplete = false; check(id, 'fail', `line ${row.line}: reference fidelity rows need ${REFERENCE_FIDELITY_COLUMNS.length} nonempty cells`); continue;
    }
    const [rankCell, , decisionCell, verdictCell, evidenceCell] = row.cells;
    const rank = /^[1-9]\d*$/.test(rankCell) ? Number(rankCell) : Number.NaN;
    const decision = decisionCell.toLowerCase();
    const verdict = verdictCell.toLowerCase();
    const problems: string[] = [];
    const unverified: string[] = [];
    if (!Number.isFinite(rank)) problems.push('Rank must be a positive whole number');
    else if (seen.has(rank)) problems.push(`rank ${rank} appears more than once`);
    else if (signature && !signature.has(rank)) problems.push(`rank ${rank} is not a Signature priority rank`);
    else if (!signature) unverified.push(SIGNATURE_UNAVAILABLE);
    if (Number.isFinite(rank)) seen.add(rank);
    const expected = Number.isFinite(rank) ? selectedDecisions?.get(rank) : undefined;
    if (expected === undefined) { if (signature) unverified.push('the selected variation\'s decision for this rank is unavailable'); }
    else if (decision !== expected) problems.push(`Decision must equal Variation ${selected}'s decision (${expected})`);
    if (!allowed.includes(verdict)) problems.push(`Verdict must be one of ${allowed.join(', ')}`);
    else if (verdict === 'dropped' && decision !== 'drop') problems.push('Verdict dropped is only valid for a drop decision');
    else if (verdict === 'missing' && decision !== 'drop') problems.push(`a ${decision} signature is missing from the build; restore it`);
    const runs = [...new Set([...evidenceCell.matchAll(/\bqa\/(qa-\d+-[0-9a-f]{8})\b/g)].map((match) => match[1]))];
    if (required && runs.length !== 1) problems.push('Evidence must cite exactly one QA run as qa/<runId>');
    runs.forEach((runId) => cited.add(runId));
    if (Number.isFinite(rank)) verdicts.set(rank, verdict);
    if (problems.length > 0) rowsComplete = false;
    check(id, problems.length > 0 ? 'fail' : unverified.length > 0 ? 'unverified' : 'pass',
      `line ${row.line}: ${[...problems, ...unverified].join('; ') || `rank ${rank} is ${verdict}`}`);
  }
  const missingRanks = ranks.filter((rank) => !seen.has(rank));
  const tableProblems: string[] = [];
  if (signature && missingRanks.length > 0) tableProblems.push(`Reference fidelity must list every Signature priority rank once (missing ${missingRanks.join(', ')})`);
  if (required && cited.size > 1) tableProblems.push(`every row must cite the same QA run (found ${[...cited].join(', ')})`);
  check('reference-fidelity', tableProblems.length > 0 ? 'fail' : !signature ? 'unverified' : 'pass', tableProblems.join('; ')
    || (!signature ? SIGNATURE_UNAVAILABLE : required ? 'reference fidelity covers every ranked signature' : 'reference fidelity is planned'));
  const qaRun = cited.size === 1 ? [...cited][0] : null;
  outcome.referenceFidelity.qaRun = qaRun;
  if (signature && selectedDecisions && rowsComplete && missingRanks.length === 0) {
    const credit: Record<string, number> = { present: 1, partial: 0.5, missing: 0 };
    const kept = ranks.filter((rank) => selectedDecisions.get(rank) !== 'drop');
    if (kept.length > 0 && kept.every((rank) => verdicts.get(rank)! in credit)) {
      const total = kept.reduce((sum, rank) => sum + weight(rank), 0);
      outcome.referenceFidelity.score = round3(kept.reduce((sum, rank) => sum + weight(rank) * credit[verdicts.get(rank)!], 0) / total);
    }
  }
  if (!required) return outcome;
  const qaProblems: string[] = [];
  const qaUnverified: string[] = [];
  if (!qaRun) qaProblems.push('reference fidelity must cite exactly one QA run');
  else {
    const newest = runIds.reduce<string | null>((latest, runId) => (latest === null || qaEpoch(runId) > qaEpoch(latest)
      || (qaEpoch(runId) === qaEpoch(latest) && runId > latest) ? runId : latest), null);
    const state = input.qaRuns?.get(qaRun);
    if (!runIds.includes(qaRun)) qaProblems.push(`cited QA run qa/${qaRun} does not exist`);
    else if (newest !== qaRun) qaProblems.push(`a newer QA run exists; cite it (qa/${newest})`);
    if (runIds.includes(qaRun)) {
      if (!state) qaProblems.push(`QA run qa/${qaRun} has no readable qa.json`);
      else if (state.problem) qaProblems.push(`QA run qa/${qaRun} is unreadable: ${state.problem}`);
      else {
        if (state.status === 'fail') qaProblems.push(`QA run qa/${qaRun} failed; fix its fail findings and run qa again`);
        else if (state.status === 'unverified') qaUnverified.push(`QA run qa/${qaRun} is unverified${state.skipped && state.skipped.length > 0 ? ` (skipped: ${state.skipped.join('; ')})` : ''}`);
        if (state.project === null) qaProblems.push(`QA run qa/${qaRun} ran without --project, so the Build contract, signature checks, lineage and reference reuse were never checked; run design-lens qa --project on this project`);
        if (!state.reviewConfirmed) qaProblems.push('QA review images were not confirmed; run design-lens qa-confirm');
        const changed: string[] = [];
        if (contract && state.contractKey && state.contractKey !== buildContractKey(contract)) changed.push('Build contract');
        if (contract && state.mode && state.mode !== contract.mode) changed.push(`mode (qa ran ${state.mode}, the contract says ${contract.mode})`);
        if (changed.length > 0) qaProblems.push(`the ${changed.join(' and ')} changed after qa/${qaRun}; rerun qa and cite the new run`);
        const failedRanks = new Set((state.signatureChecks ?? []).filter((item) => !item.pass).map((item) => item.rank));
        for (const [rank, verdict] of verdicts) {
          if ((verdict === 'present' || verdict === 'partial') && failedRanks.has(rank)) qaProblems.push(`rank ${rank} is marked ${verdict} but its signature check failed in qa/${qaRun}`);
        }
      }
    }
  }
  check('reference-fidelity-qa', qaProblems.length > 0 ? 'fail' : qaUnverified.length > 0 ? 'unverified' : 'pass',
    [...qaProblems, ...qaUnverified].join('; ') || `QA run qa/${qaRun} passed and its review images were confirmed`);
  return outcome;
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
  let designSections: MarkdownHeading[] | null = null;
  if (input.design === null) check('design-document', 'fail', 'DESIGN.md is missing or unreadable');
  else {
    const sections = headings(input.design);
    designSections = sections;
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
  const toneDetail = !sourceAvailable ? `source evidence is unavailable, so tone.json cannot be verified; restore the evidence, then ${TONE_RERUN}`
    : input.toneProblem ? `${input.toneProblem}; ${TONE_RERUN}`
      : !input.tone ? `tone.json is missing; ${TONE_RERUN}`
        : input.tone.evidenceHash !== evidenceHash(input.evidence!) ? `tone.json was measured from different source evidence; ${TONE_RERUN} again` : '';
  const tone = toneDetail === '' ? input.tone ?? null : null;
  check('tone-report', tone ? 'pass' : 'unverified', tone ? 'tone.json matches the current source evidence' : toneDetail);
  const facts: DesignFacts = { typeface: null, signature: null };
  let basisSha256: string | null = null;
  if (designSections) {
    facts.typeface = checkTypefaceForms(designSections, check);
    const toneRows = checkToneBudget(designSections, input, sourceAvailable, tone, toneDetail, check);
    facts.signature = checkSignaturePriority(designSections, measurements, toneRows, check);
    basisSha256 = basisOf(designSections);
  }
  const designCheckCount = checks.length;
  let outcome: VariationOutcome = { scores: [], referenceFidelity: { required: false, score: null, qaRun: null } };
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
    const letters = [...new Set(variations.map((heading) => heading.title.slice('Variation '.length, 'Variation '.length + 1)))];
    outcome = validateVariationExtensions(sections, input.variations, letters, facts, basisSha256, tone, toneDetail, input, check);
  }
  const status: DesignValidationStatus = checks.some((item) => item.status === 'fail') ? 'fail' : checks.some((item) => item.status === 'unverified') ? 'unverified' : 'pass';
  return {
    schemaVersion: 2, status, checks, issues: checks.filter((item) => item.status !== 'pass').map((item) => item.detail), measurements,
    documents: {
      design: { sha256: input.design === null ? null : sha256(input.design), basisSha256, status: worst(checks.slice(0, designCheckCount).map((item) => item.status)) },
      variations: { sha256: input.variations === null ? null : sha256(input.variations), status: worst(checks.slice(designCheckCount).map((item) => item.status)) },
    },
    variationScores: outcome.scores,
    referenceFidelity: outcome.referenceFidelity,
  };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
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

async function listQaRuns(root: string): Promise<string[]> {
  let entries;
  try { entries = await fs.readdir(path.join(root, 'qa'), { withFileTypes: true }); } catch (error) {
    if (record(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  const runs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('qa-')) continue;
    const report = await fs.lstat(path.join(root, 'qa', entry.name, 'qa.json')).catch((error: unknown) => {
      if (record(error) && error.code === 'ENOENT') return null;
      throw error;
    });
    if (report?.isFile()) runs.push(entry.name);
  }
  return runs.sort();
}

/**
 * review.json must carry the value only qa-confirm can derive from every review code; qa.json holds its
 * salted PBKDF2-SHA256 hash (20000 iterations, 32 bytes), so a hand-written review.json is not a confirmation.
 */
function reviewProven(qaReview: unknown, proof: unknown): boolean {
  if (!record(qaReview) || !record(qaReview.proof) || typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const { salt, hash } = qaReview.proof;
  if (typeof salt !== 'string' || !/^[0-9a-f]{32}$/.test(salt) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return crypto.timingSafeEqual(crypto.pbkdf2Sync(proof, Buffer.from(salt, 'hex'), 20_000, 32, 'sha256'), Buffer.from(hash, 'hex'));
}

/** Structural guards only: the validator never imports the qa modules that write these files. */
async function readQaRun(root: string, runId: string): Promise<QaRunState> {
  let bytes: Buffer;
  let value: unknown;
  try {
    bytes = await fs.readFile(await resolveEvidencePath(root, `qa/${runId}/qa.json`));
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) { return { status: 'unverified', reviewConfirmed: false, problem: `qa.json is unreadable: ${errorMessage(error)}` }; }
  if (!record(value) || value.schemaVersion !== 1) return { status: 'unverified', reviewConfirmed: false, problem: 'unsupported qa.json schemaVersion' };
  if (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'unverified') return { status: 'unverified', reviewConfirmed: false, problem: 'qa.json status is invalid' };
  if (value.skipped !== undefined && (!Array.isArray(value.skipped) || !value.skipped.every((item) => record(item) && typeof item.check === 'string'))) {
    return { status: 'unverified', reviewConfirmed: false, problem: 'qa.json skipped entries are invalid' };
  }
  if (value.signatureChecks !== undefined && (!Array.isArray(value.signatureChecks)
      || !value.signatureChecks.every((item) => record(item) && Number.isSafeInteger(item.rank) && typeof item.pass === 'boolean'))) {
    return { status: 'unverified', reviewConfirmed: false, problem: 'qa.json signatureChecks are invalid' };
  }
  const skipped = ((value.skipped ?? []) as Array<Record<string, unknown>>).filter((item) => item.affectsStatus !== false)
    .map((item) => `${String(item.check)}${typeof item.viewport === 'string' ? `@${item.viewport}` : ''}${typeof item.reason === 'string' ? `: ${item.reason}` : ''}`);
  const signatureChecks = ((value.signatureChecks ?? []) as Array<{ rank: number; pass: boolean }>).map((item) => ({ rank: item.rank, pass: item.pass }));
  let review: unknown = null;
  try {
    const text = await optionalFile(root, `qa/${runId}/review.json`);
    review = text === null ? null : JSON.parse(text);
  } catch (error) {
    // An unreadable review is an unconfirmed review; the pure check reports it as such.
    review = { unreadable: errorMessage(error) };
  }
  const reviewConfirmed = record(review) && review.confirmed === true && review.qaSha256 === sha256(bytes) && reviewProven(value.review, review.proof);
  const project = typeof value.project === 'string' && value.project !== '' ? value.project : null;
  const contract = value.contract;
  const contractKey = record(contract) && typeof contract.mode === 'string' && strings(contract.fonts) && strings(contract.displayFonts)
    && typeof contract.darkShareMax === 'number' && typeof contract.fullBleedDarkMax === 'number' && Array.isArray(contract.checks)
    && contract.checks.every((item) => record(item) && Number.isSafeInteger(item.rank) && typeof item.selector === 'string'
      && typeof item.property === 'string' && typeof item.op === 'string' && typeof item.value === 'string')
    ? buildContractKey({
      mode: contract.mode, fonts: contract.fonts, displayFonts: contract.displayFonts, darkShareMax: contract.darkShareMax,
      fullBleedDarkMax: contract.fullBleedDarkMax, stylesheets: typeof contract.stylesheets === 'string' ? contract.stylesheets : null,
      checks: contract.checks as Array<{ rank: number; selector: string; property: string; op: string; value: string }>,
    })
    : null;
  const mode = typeof value.mode === 'string' ? value.mode : null;
  return { status: value.status, reviewConfirmed, signatureChecks, skipped, project, contractKey, mode };
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
  let compositionHash: string | null = null;
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
    compositionHash = record(manifest) && manifest.composition !== undefined ? sha256(JSON.stringify(manifest.composition)) : null;
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
    if ((fidelity.compositionHash ?? null) !== compositionHash) throw new Error('responsive composition changed since its last fidelity measurement; run fidelity again');
    for (const candidate of fidelity.captures) {
      const parsed = cloneCapture(candidate, evidence.captures);
      if (!parsed) continue;
      if (cloneObservations.has(parsed.id)) throw new Error(`duplicate clone capture ${parsed.id}`);
      cloneObservations.set(parsed.id, parsed.observations);
    }
  } catch (error) { cloneProblem = errorMessage(error); }
  let tone: ToneDocument | null = null;
  let toneProblem: string | undefined;
  try {
    const text = await optionalFile(root, 'tone.json');
    if (text !== null) {
      const parsed = parseToneDocument(JSON.parse(text));
      for (const entry of parsed.captures) {
        const capture = evidence?.captures.find((candidate) => candidate.id === entry.captureId);
        if (!capture) continue;
        const image = capture.files.find((file) => file.path === capture.fullScreenshot);
        if (entry.image.path !== capture.fullScreenshot || !image || image.sha256 !== entry.image.sha256) {
          throw new Error(`the ${entry.captureId} image hash differs from the source full screenshot`);
        }
      }
      tone = parsed;
    }
  } catch (error) { toneProblem = `tone.json is invalid or stale: ${errorMessage(error)}`; }
  let qaRunIds: string[] = [];
  const qaRuns = new Map<string, QaRunState>();
  try {
    qaRunIds = await listQaRuns(root);
    const cited = new Set([...(variations ?? '').matchAll(/\bqa\/(qa-\d+-[0-9a-f]{8})\b/g)].map((match) => match[1]));
    for (const runId of cited) if (qaRunIds.includes(runId)) qaRuns.set(runId, await readQaRun(root, runId));
  } catch (error) { fileProblems.push(`qa: ${errorMessage(error)}`); }
  const report = validateDesignDocuments({ design, variations, evidence, sourceProblem, cloneObservations, cloneProblem, tone, toneProblem, qaRuns, qaRunIds });
  if (fileProblems.length > 0) report.issues.push(...fileProblems);
  return { report, json: `${JSON.stringify(report)}\n` };
}
