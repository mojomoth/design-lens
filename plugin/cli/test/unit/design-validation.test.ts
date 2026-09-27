import { describe, expect, it } from 'vitest';

import { compareMeasuredValue, observedField, splitMarkdownRow, validateDesignDocuments } from '../../src/analyze/design-validation.js';
import { capture, DEFAULT_ROWS, design, evidence, observationDocument, variations } from '../fixtures/design-validation-fixture.js';

function validate(document = design(), source = evidence()) {
  return validateDesignDocuments({ design: document, variations: variations(), evidence: source });
}

describe('design implementation blueprint', () => {
  // why: a single explicitly captured viewport is valid; defaults must not invent missing captures.
  it('accepts the complete recipe with measured layout, typography, color and one actual viewport', () => {
    expect(validate().status).toBe('pass');
  });

  // why: a polished desktop document must not quietly omit the captured mobile layout.
  it('requires reference measurements at every complete captured viewport', () => {
    const source = evidence(); source.captures.push(capture('mobile', 390));
    const missing = validate(design(), source);
    expect(missing.status).toBe('fail');
    expect(missing.issues.some((issue) => issue.includes('mobile (390x900)'))).toBe(true);
    expect(validate(design([...DEFAULT_ROWS, '| observed-reference | mobile | 390x900 | dl-1 | rect.width | 320 | px | 0 |']), source).status).toBe('pass');
  });

  // why: the exact section and recipe contract makes incomplete documents detectable mechanically.
  it('rejects missing sections, empty recipe tables, and empty CSS examples', () => {
    expect(validate(design().replace('## 6. Color System', '## Palette')).status).toBe('fail');
    expect(validate(design().replace('| Heading | 320px | desktop/dl-1/rect.width |', '')).status).toBe('fail');
    expect(validate(design().replace('h1 { font-size: 2rem; width: 320px; }', '')).status).toBe('fail');
    expect(validate(design().replace('h1 { font-size: 2rem; width: 320px; }', '/* An example belongs here. */')).status).toBe('fail');
    expect(validate(design().replace('h1 { font-size: 2rem; width: 320px; }', 'not CSS')).status).toBe('fail');
  });

  // why: a second table cannot hide fabricated measurements behind the first valid table.
  it('rejects duplicate measured observation tables', () => {
    const duplicate = '| Label | Capture | Viewport | Observation | Field | Value | Unit | Precision |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| observed-reference | desktop | 1440x900 | dl-1 | rect.width | 999 | px | 0 |\n\n';
    expect(validate(design().replace('## 1. First Impression', `${duplicate}## 1. First Impression`)).checks.find((check) => check.id === 'observations-table')?.status).toBe('fail');
  });

  // why: example markup inside an outer code fence is not the required rendered measurement table.
  it('does not treat nested code fence examples as a measured observation table', () => {
    const document = design().replace('| Label |', '````markdown\n```\n| Label |').replace('## 1. First Impression', '````\n## 1. First Impression');
    expect(validate(document).checks.find((check) => check.id === 'observations-table')?.status).toBe('fail');
  });

  // why: tokens or layout-only measurements cannot establish the reference's typography and color.
  it('requires independently verified layout, typography and color categories', () => {
    expect(validate(design([DEFAULT_ROWS[0]])).checks.filter((check) => check.id.startsWith('measurement-coverage:') && check.status === 'fail')).toHaveLength(2);
  });

  // why: source-local IDs and viewport dimensions are necessary to disambiguate responsive captures.
  it.each([
    ['unknown ID', DEFAULT_ROWS[0].replace('dl-1', 'dl-999')],
    ['unknown capture', DEFAULT_ROWS[0].replace('desktop', 'invented')],
    ['wrong viewport', DEFAULT_ROWS[0].replace('1440x900', '390x844')],
    ['invented field', DEFAULT_ROWS[0].replace('rect.width', 'rect.imagined')],
  ])('rejects %s', (_, row) => {
    expect(validate(design([row, ...DEFAULT_ROWS.slice(1)])).measurements[0].status).toBe('fail');
  });

  // why: incomplete evidence must stay unavailable instead of being upgraded by correctly formatted prose.
  it('keeps explicitly unavailable evidence unverified while preserving useful diagnostics', () => {
    const source = evidence(); source.captures[0].complete = false;
    const result = validate(design(['| unavailable | desktop | 1440x900 | - | - | Capture was interrupted | - | - |']), source);
    expect(result.status).toBe('unverified');
    expect(result.issues.some((issue) => issue.includes('Capture was interrupted'))).toBe(true);
  });

  // why: stale clone measurements must not invalidate independent source evidence or masquerade as current.
  it('uses source evidence independently and requires fresh clone measurements for clone claims', () => {
    const rows = [...DEFAULT_ROWS, '| observed-clone | desktop | 1440x900 | dl-1 | styles.fontWeight | 700 | unitless | 0 |'];
    const base = { design: design(rows), variations: variations(), evidence: evidence() };
    expect(validateDesignDocuments({ ...base, cloneProblem: 'clone changed' }).status).toBe('unverified');
    expect(validateDesignDocuments({ ...base, cloneObservations: new Map([['desktop', observationDocument()]]) }).status).toBe('pass');
    expect(validateDesignDocuments({ ...base, design: design(), cloneProblem: 'clone changed' }).status).toBe('pass');
  });

  // why: fewer directions or omitted decision sections are not a finished variation study.
  it('requires four variation sections and three to five unique named directions', () => {
    const result = validateDesignDocuments({ design: design(), evidence: evidence(), variations: variations().replace('## Variation C:', '## Variant C:') });
    expect(result.status).toBe('fail');
    expect(result.issues.some((issue) => issue.includes('3–5'))).toBe(true);
  });
});

describe('measured value integrity', () => {
  // why: rem conversion depends on the captured root, not a habitual 16px assumption.
  it('uses the same capture root size for px/rem conversion and rejects absent units', () => {
    const doc = observationDocument(); doc.rootFontSize = '20px';
    const claim = { value: '1.6', unit: 'rem', precision: '2', field: 'styles.fontSize', observation: 'dl-1' };
    expect(compareMeasuredValue('32px', claim, doc)).toBeNull();
    expect(compareMeasuredValue('32px', { ...claim, value: '2' }, doc)).toContain('expected 1.6');
    doc.rootFontSize = 'larger';
    expect(compareMeasuredValue('32px', claim, doc)).toContain('measured rootFontSize');
    expect(compareMeasuredValue(32, { ...claim, value: '32', unit: 'unitless', field: 'rect.width' }, doc)).toContain('cannot convert');
  });

  // why: reported rounded values need a declared tolerance rather than broad approximate equality.
  it('enforces declared rounding precision without accepting additional inaccurate decimals', () => {
    const claim = { value: '32.13', unit: 'px', precision: '2', field: 'rect.width', observation: 'dl-1' };
    expect(compareMeasuredValue(32.126, claim, observationDocument())).toBeNull();
    expect(compareMeasuredValue(32.126, { ...claim, value: '32.126' }, observationDocument())).not.toBeNull();
    expect(compareMeasuredValue(32.126, { ...claim, precision: '7' }, observationDocument())).toContain('0 through 6');
  });

  // why: equivalent CSS color notations are valid, while dropping alpha changes the actual design.
  it('normalizes colors while retaining alpha', () => {
    const claim = { value: 'rgb(10 20 30 / 50%)', unit: 'color', precision: '-', field: 'styles.color', observation: 'dl-1' };
    expect(compareMeasuredValue('rgba(10,20,30,0.5)', claim, observationDocument())).toBeNull();
    expect(compareMeasuredValue('rgba(10,20,30,0.5)', { ...claim, value: '#0a141e' }, observationDocument())).toContain('alpha');
  });

  // why: CSS strings preserve font names and unsupported dimensional values without numeric invention.
  it('compares CSS strings exactly and supports page body fields', () => {
    expect(compareMeasuredValue('Arial, sans-serif', { value: 'Arial, sans-serif', unit: 'css', precision: '-', field: 'styles.fontFamily', observation: 'dl-1' }, observationDocument())).toBeNull();
    expect(compareMeasuredValue(1440, { value: '1440', unit: 'px', precision: '0', field: 'body.rect.width', observation: 'page' }, observationDocument())).toBeNull();
  });

  // why: external markdown paths cannot claim prototype methods or inherited values as measured evidence.
  it('only resolves own data properties and rejects prototype paths', () => {
    expect(observedField({ rect: { width: 42 } }, 'rect.width')).toEqual({ found: true, value: 42 });
    expect(observedField({}, '__proto__.constructor')).toEqual({ found: false });
    expect(observedField(Object.create({ width: 42 }), 'width')).toEqual({ found: false });
  });

  // why: literal pipes in CSS or code spans must not shift columns and validate the wrong field/value.
  it('parses escaped pipes and pipes in code spans without shifting columns', () => {
    expect(splitMarkdownRow('| A | `font|name` | raw\\|value |')).toEqual(['A', 'font|name', 'raw|value']);
  });
});
