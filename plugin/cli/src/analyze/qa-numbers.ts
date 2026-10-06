/**
 * `unsourced-number`: page numbers that no content file supports.
 *
 * Pure. The page side hands over one rendered-text stream (spaces at inline and `<br>`
 * boundaries, newlines at block boundaries, open shadow roots crossed), so a unit split from its
 * number by markup (`09<span>MONTHS</span>`, `11<br>MONTHS`) still follows it across whitespace.
 * Content files go through the same extractor, so `2,096 명` sources `2,096명`.
 */

export const UNIT_CLASSES = ['month', 'year', 'ordinal', 'person', 'percent', 'company', 'count', 'currency', 'duration'] as const;
export type UnitClass = typeof UNIT_CLASSES[number];
export type NumberClass = UnitClass | 'unitless';

export const NUMBER_UNITS: Readonly<Record<UnitClass, readonly string[]>> = {
  month: ['개월', '달', 'months', 'month', 'mos', 'mo'],
  year: ['년', 'years', 'year', 'yrs', 'yr'],
  ordinal: ['주년', 'anniversary', '번째', '기', '회', '차', 'th', 'st', 'nd', 'rd'],
  person: ['명', '인', 'people', 'persons', 'members'],
  percent: ['%', '퍼센트', 'percent', 'pct'],
  company: ['개사', '社', 'companies', 'startups'],
  count: ['개', '건', '곳', '팀', 'teams', 'items', 'projects'],
  currency: ['만원', '억원', '원', '억', '만', 'krw', 'won', 'usd', '$'],
  duration: ['시간', '일', '주', 'days', 'weeks', 'hours', 'hrs', 'h'],
};

/** Longest first, so 개월 wins over 개, 주년 over 주, 만원 over 만. */
const UNIT_TABLE: ReadonlyArray<{ unit: string; cls: UnitClass; latin: boolean }> = UNIT_CLASSES
  .flatMap((cls) => NUMBER_UNITS[cls].map((unit) => ({ unit, cls, latin: /^[a-z]+$/i.test(unit) })))
  .sort((left, right) => right.unit.length - left.unit.length);

export interface NumberToken {
  /** NaN for a date/time token. */
  value: number;
  /** The digits as written (separators kept), or the whole date/time text. */
  number: string;
  unit: string | null;
  cls: NumberClass;
  raw: string;
  start: number;
  end: number;
  date?: true;
}

const MASKS = [
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\d{2,4}-\d{3,4}-\d{4}/g,
  /\d{3}-\d{2}-\d{5}/g,
];
const DATES = [
  /(?<![\d.])(?:19|20)\d{2}\s*[.\-/]\s*\d{1,2}(?:\s*[.\-/]\s*\d{1,2})?\.?(?!\d)/g,
  /(?:(?<!\d)(?:19|20)\d{2}\s*년\s*)?(?<!\d)\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?/g,
  /(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?![\d:])/g,
];
const NUMBER = /(제\s?)?(\d{1,3}(?:[,  ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

function unitAt(text: string, from: number): { unit: string; cls: UnitClass; end: number } | null {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  const rest = text.slice(index, index + 16);
  const lower = rest.toLowerCase();
  const spaced = index > from;
  for (const entry of UNIT_TABLE) {
    if (!lower.startsWith(entry.unit)) continue;
    if (entry.latin && /\p{L}/u.test(rest.charAt(entry.unit.length))) continue;
    // Across whitespace a Korean unit must end its word: "01 기업" is a label and a heading.
    if (spaced && !entry.latin && /\p{Script=Hangul}/u.test(rest.charAt(entry.unit.length))) continue;
    return { unit: rest.slice(0, entry.unit.length), cls: entry.cls, end: index + entry.unit.length };
  }
  return null;
}

/** Every number (with its unit class) and every date/time in `text`, in order. */
export function tokenizeNumbers(text: string): NumberToken[] {
  let masked = text;
  for (const pattern of MASKS) {
    for (const match of text.matchAll(pattern)) masked = blank(masked, match.index, match.index + match[0].length);
  }
  const tokens: NumberToken[] = [];
  for (const pattern of DATES) {
    for (const match of masked.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (masked.slice(start, end).trim() !== match[0].trim()) continue;
      tokens.push({ value: Number.NaN, number: match[0].trim(), unit: null, cls: 'unitless', raw: text.slice(start, end).trim(), start, end, date: true });
      masked = blank(masked, start, end);
    }
  }
  for (const match of masked.matchAll(NUMBER)) {
    const prefix = match[1] ?? '';
    const digits = match[2];
    const numberStart = match.index + prefix.length;
    if (!prefix && match.index > 0 && /[A-Za-z0-9_.]/.test(masked[match.index - 1])) continue;
    const numberEnd = numberStart + digits.length;
    const unit = unitAt(masked, numberEnd);
    const end = unit ? unit.end : numberEnd;
    tokens.push({
      value: Number(digits.replace(/[,  ]/g, '')), number: digits, unit: unit?.unit ?? null, cls: unit?.cls ?? 'unitless',
      raw: text.slice(match.index, end).replace(/\s+/g, ' ').trim(), start: match.index, end,
    });
  }
  return tokens.sort((left, right) => left.start - right.start);
}

/** Every numeric fact the content files state. */
export interface NumberCorpus { values: Map<number, Set<NumberClass>>; digits: Set<string>; text: string }

export function buildNumberCorpus(texts: readonly string[]): NumberCorpus {
  const values = new Map<number, Set<NumberClass>>();
  const digits = new Set<string>();
  for (const text of texts) {
    for (const token of tokenizeNumbers(text)) {
      if (token.date) continue;
      const classes = values.get(token.value) ?? new Set<NumberClass>();
      classes.add(token.cls);
      values.set(token.value, classes);
      digits.add(token.number.replace(/[,  ]/g, ''));
    }
  }
  return { values, digits, text: texts.join('\n').replace(/\s+/g, ' ') };
}

/** `.json` content contributes all string and number values; anything else is read as text. */
export function contentTexts(fileName: string, text: string): string[] {
  if (!fileName.toLowerCase().endsWith('.json')) return [text];
  const result: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') result.push(value);
    else if (typeof value === 'number') result.push(String(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(JSON.parse(text) as unknown);
  return result;
}

export type NumberVerdict =
  | { status: 'sourced' | 'ignored' }
  | { status: 'unsourced'; severity: 'fail' | 'warn' };

const compatible = (left: NumberClass, right: NumberClass): boolean => left === right
  || (left === 'ordinal' && right === 'year') || (left === 'year' && right === 'ordinal');

export function judgeNumber(token: NumberToken, corpus: NumberCorpus): NumberVerdict {
  if (token.date) return corpus.text.includes(token.number.replace(/\s+/g, ' ')) ? { status: 'ignored' } : { status: 'unsourced', severity: 'warn' };
  if (token.unit === null && /^0\d$/.test(token.number)) return { status: 'ignored' };
  if (token.unit === null && /^\d{5}$/.test(token.number) && corpus.digits.has(token.number)) return { status: 'ignored' };
  const classes = corpus.values.get(token.value);
  if (token.cls === 'unitless') return classes ? { status: 'sourced' } : { status: 'unsourced', severity: 'warn' };
  if (/^\d{4}$/.test(token.number) && token.value >= 1900 && token.value <= 2099 && classes) return { status: 'sourced' };
  if (classes && [...classes].some((cls) => compatible(cls, token.cls))) return { status: 'sourced' };
  return { status: 'unsourced', severity: token.cls === 'count' ? 'warn' : 'fail' };
}

export interface UnsourcedNumber { token: NumberToken; severity: 'fail' | 'warn' }

export function unsourcedNumbers(stream: string, corpus: NumberCorpus): UnsourcedNumber[] {
  const result: UnsourcedNumber[] = [];
  for (const token of tokenizeNumbers(stream)) {
    const verdict = judgeNumber(token, corpus);
    if (verdict.status === 'unsourced') result.push({ token, severity: verdict.severity });
  }
  return result;
}
