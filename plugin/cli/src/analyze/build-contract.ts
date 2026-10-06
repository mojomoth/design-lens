import * as csstree from 'css-tree';

import { exactTables, headings, sectionChildren } from './markdown.js';

export const BUILD_CONTRACT_SECTION = 'Selected direction';
export const BUILD_CONTRACT_HEADING = 'Build contract';
export const BUILD_CONTRACT_COLUMNS = ['Contract', 'Value', 'Source'] as const;
export const SIGNATURE_CHECK_OPS = ['>=', '<=', '!=', '!~', '=', '~'] as const;
export type SignatureCheckOp = typeof SIGNATURE_CHECK_OPS[number];

export interface SignatureCheck {
  rank: number;
  selector: string;
  /** A computed CSS property name, or `count` for the number of visible matches. */
  property: string;
  op: SignatureCheckOp;
  value: string;
  line: number;
}
export interface BuildContract {
  mode: 'derive' | 'clone-base';
  fonts: string[];
  displayFonts: string[];
  darkShareMax: number;
  fullBleedDarkMax: number;
  stylesheets: 'rewritten' | 'retained';
  checks: SignatureCheck[];
  /** Contract key → its Source cell; repeated `check:<rank>` keys keep the first Source. */
  sources: Record<string, string>;
}
export interface BuildContractParse { contract: BuildContract | null; problems: string[]; checks: SignatureCheck[] }

const SINGLE_KEYS = ['mode', 'fonts', 'display-fonts', 'dark-share-max', 'full-bleed-dark-max', 'stylesheets'] as const;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const LEADING_NUMBER = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?\s*$/i;

/** Case-insensitive family identity: surrounding quotes stripped, inner whitespace collapsed. */
export function normalizeFontFamily(name: string): string {
  return name.trim().replace(/^(["'])(.*)\1$/, '$2').trim().replace(/\s+/g, ' ').toLowerCase();
}

function fontList(value: string): string[] {
  return value.split(';').map((family) => family.trim().replace(/^(["'])(.*)\1$/, '$2').trim()).filter((family) => family.length > 0);
}

function validSelector(selector: string): boolean {
  let valid = true;
  try {
    csstree.parse(selector, { context: 'selectorList', onParseError: () => { valid = false; } });
  } catch { return false; }
  return valid;
}

/** Parses `<selector> :: <property> <op> <value>`; returns a problem string when malformed. */
export function parseSignatureCheck(rank: number, text: string, line: number): SignatureCheck | string {
  const split = text.indexOf(' :: ');
  if (split < 0) return 'check value must be "<selector> :: <property> <op> <value>"';
  const selector = text.slice(0, split).trim();
  const rest = text.slice(split + 4).trim();
  if (!selector || !validSelector(selector)) return `check selector is not a valid CSS selector list: ${selector}`;
  const property = /^(--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)\s*/.exec(rest);
  if (!property) return 'check requires a computed CSS property name or count';
  const remainder = rest.slice(property[0].length);
  const op = SIGNATURE_CHECK_OPS.find((candidate) => remainder.startsWith(candidate));
  if (!op) return `check operator must be one of ${SIGNATURE_CHECK_OPS.join(' ')}`;
  const value = remainder.slice(op.length).trim();
  if (!value) return 'check requires a comparison value';
  const name = property[1];
  if ((op === '>=' || op === '<=') && !LEADING_NUMBER.test(value)) return `${op} requires a number (px allowed)`;
  if (name === 'count' && (!/^\d+$/.test(value) || op === '~' || op === '!~')) return 'count checks compare a whole number with = != >= <=';
  return { rank, selector, property: name, op, value, line };
}

/**
 * Evaluates one check against an observed computed value (or visible-match count). Numeric
 * operators compare leading numbers; `~` is a case-insensitive substring test.
 */
export function evaluateSignatureCheck(check: Pick<SignatureCheck, 'property' | 'op' | 'value'>, observed: string | number): boolean {
  const text = String(observed).trim();
  if (check.op === '>=' || check.op === '<=' || (check.property === 'count' && (check.op === '=' || check.op === '!='))) {
    const left = typeof observed === 'number' ? observed : Number(LEADING_NUMBER.exec(text)?.[1] ?? /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(text)?.[1]);
    const right = Number(LEADING_NUMBER.exec(check.value)?.[1]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (check.op === '>=') return left >= right;
    if (check.op === '<=') return left <= right;
    return check.op === '=' ? left === right : left !== right;
  }
  const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (check.op === '~') return normalize(text).includes(normalize(check.value));
  if (check.op === '!~') return !normalize(text).includes(normalize(check.value));
  const equal = normalize(text) === normalize(check.value);
  return check.op === '=' ? equal : !equal;
}

/** Reads the single `### Build contract` table inside `## Selected direction`. */
export function parseBuildContract(variationsMarkdown: string): BuildContractParse {
  const problems: string[] = [];
  const checks: SignatureCheck[] = [];
  const all = headings(variationsMarkdown);
  const parents = all.filter((heading) => heading.level === 2 && heading.title === BUILD_CONTRACT_SECTION);
  const sections = parents.length === 1 ? sectionChildren(all, parents[0], 3).filter((heading) => heading.title === BUILD_CONTRACT_HEADING) : [];
  const found = sections.length === 1 ? exactTables(sections[0].body, sections[0].line, BUILD_CONTRACT_COLUMNS) : [];
  if (found.length !== 1) {
    return { contract: null, checks, problems: [`## ${BUILD_CONTRACT_SECTION} requires exactly one ### ${BUILD_CONTRACT_HEADING} with one table ${BUILD_CONTRACT_COLUMNS.join(' | ')}`] };
  }
  const values = new Map<string, { value: string; line: number }>();
  const sources: Record<string, string> = {};
  for (const row of found[0].rows) {
    const problem = (text: string): void => { problems.push(`line ${row.line}: ${text}`); };
    if (row.cells.length !== 3) { problem('build contract rows need Contract, Value and Source cells'); continue; }
    const [key, value, source] = row.cells;
    const checkKey = /^check:([1-9]\d*)$/.exec(key);
    if (checkKey) {
      const parsed = parseSignatureCheck(Number(checkKey[1]), value, row.line);
      if (typeof parsed === 'string') problem(parsed);
      else checks.push(parsed);
      if (!(key in sources)) sources[key] = source;
      continue;
    }
    if (!(SINGLE_KEYS as readonly string[]).includes(key)) { problem(`unknown build contract key ${key || '(empty)'}`); continue; }
    if (values.has(key)) { problem(`build contract key ${key} appears more than once`); continue; }
    values.set(key, { value, line: row.line });
    sources[key] = source;
  }
  const take = (key: string): { value: string; line: number } | undefined => values.get(key);
  const required = (key: string): { value: string; line: number } | undefined => {
    const entry = take(key);
    if (!entry) problems.push(`build contract requires ${key}`);
    return entry;
  };
  const mode = required('mode');
  if (mode && mode.value !== 'derive' && mode.value !== 'clone-base') problems.push(`line ${mode.line}: mode must be derive or clone-base`);
  const fonts = required('fonts');
  const fontNames = fonts ? fontList(fonts.value) : [];
  if (fonts && fontNames.length === 0) problems.push(`line ${fonts.line}: fonts must list ;-separated families`);
  const display = required('display-fonts');
  const displayNames = display ? fontList(display.value) : [];
  if (display) {
    const known = new Set(fontNames.map(normalizeFontFamily));
    if (displayNames.length === 0) problems.push(`line ${display.line}: display-fonts must list ;-separated families`);
    const extra = displayNames.filter((family) => !known.has(normalizeFontFamily(family)));
    if (extra.length > 0) problems.push(`line ${display.line}: display-fonts must be a subset of fonts (${extra.join('; ')})`);
  }
  const share = (key: string): number => {
    const entry = required(key);
    if (!entry) return Number.NaN;
    const number = NUMBER.test(entry.value) ? Number(entry.value) : Number.NaN;
    if (!(number >= 0 && number <= 1)) problems.push(`line ${entry.line}: ${key} must be a number in [0, 1]`);
    return number;
  };
  const darkShareMax = share('dark-share-max');
  const fullBleedDarkMax = share('full-bleed-dark-max');
  const stylesheets = take('stylesheets');
  if (stylesheets && stylesheets.value !== 'rewritten' && stylesheets.value !== 'retained') problems.push(`line ${stylesheets.line}: stylesheets must be rewritten or retained`);
  if (mode?.value === 'clone-base' && !stylesheets) problems.push('build contract requires stylesheets (rewritten or retained) in clone-base mode');
  if (problems.length > 0) return { contract: null, problems, checks };
  return {
    contract: {
      mode: mode!.value as BuildContract['mode'],
      fonts: fontNames,
      displayFonts: displayNames,
      darkShareMax,
      fullBleedDarkMax,
      stylesheets: (stylesheets?.value ?? 'rewritten') as BuildContract['stylesheets'],
      checks,
      sources,
    },
    problems,
    checks,
  };
}
