import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildContractKey, compareMeasuredValue, compareRounded, designBasisSha256, FORM_FEATURE_VOCABULARY, formFeaturesNamed, observedField, splitMarkdownRow, validateDesignDocuments,
  type DesignValidationCheck, type DesignValidationInput, type DesignValidationReport, type QaRunState,
} from '../../src/analyze/design-validation.js';
import { parseBuildContract } from '../../src/analyze/build-contract.js';
import { sha256 } from '../../src/capture/evidence.js';
import {
  capture, CONTRACT_ROWS, DEFAULT_ROWS, design, evidence, fidelityTable, observationDocument, RETENTION_ROWS, SIGNATURE_ROWS, TONE_ROWS, toneReport,
  TYPEFACE_ROWS, variations,
} from '../fixtures/design-validation-fixture.js';

function validate(document = design(), source = evidence()) {
  return validateDesignDocuments({ design: document, variations: variations(document), evidence: source, tone: toneReport(source) });
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
    const result = validate(design(['| unavailable | desktop | 1440x900 | - | - | Capture was interrupted | - | - |', DEFAULT_ROWS[3]]), source);
    expect(result.status).toBe('unverified');
    expect(result.issues.some((issue) => issue.includes('Capture was interrupted'))).toBe(true);
  });

  // why: stale clone measurements must not invalidate independent source evidence or masquerade as current.
  it('uses source evidence independently and requires fresh clone measurements for clone claims', () => {
    const rows = [...DEFAULT_ROWS, '| observed-clone | desktop | 1440x900 | dl-1 | styles.fontWeight | 700 | unitless | 0 |'];
    const base = { design: design(rows), variations: variations(design(rows)), evidence: evidence(), tone: toneReport() };
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

  // why: tone budgets reuse the observation rounding rule; a second, looser rounding would accept wrong ratios.
  it('shares the rounding core with tone comparisons', () => {
    expect(compareRounded(0.02649, '0.026', '3')).toBeNull();
    expect(compareRounded(0.0265, '0.026', '3')).toContain('expected 0.027');
    expect(compareRounded(0.5, '0.5', '9')).toContain('0 through 6');
  });

  // why: literal pipes in CSS or code spans must not shift columns and validate the wrong field/value.
  it('parses escaped pipes and pipes in code spans without shifting columns', () => {
    expect(splitMarkdownRow('| A | `font|name` | raw\\|value |')).toEqual(['A', 'font|name', 'raw|value']);
  });
});

const RUN = 'qa-1700000000000-0123abcd';
const NEWER_RUN = 'qa-1800000000000-89abcdef';
function fidelityRows(run = RUN, verdicts?: string[], decisions?: string[]): string { return fidelityTable(run, verdicts, decisions); }
const PASSED_RUN: QaRunState = { status: 'pass', reviewConfirmed: true, signatureChecks: [{ rank: 2, pass: true }, { rank: 3, pass: true }], skipped: [] };

function run(overrides: Partial<DesignValidationInput> = {}): DesignValidationReport {
  const document = overrides.design ?? design();
  return validateDesignDocuments({ design: document, variations: variations(document), evidence: evidence(), tone: toneReport(), ...overrides });
}
function checkOf(report: DesignValidationReport, id: string): DesignValidationCheck | undefined {
  return report.checks.find((item) => item.id === id);
}
function checksMatching(report: DesignValidationReport, prefix: string): DesignValidationCheck[] {
  return report.checks.filter((item) => item.id.startsWith(prefix));
}

describe('signature, typeface and tone tables', () => {
  // why: skills compare documents.*.sha256 before rewriting and record basisSha256 as the Design basis.
  it('reports document hashes, the design basis and per-document statuses', () => {
    const report = run();
    expect(report.schemaVersion).toBe(2);
    expect(report.documents.design).toEqual({ sha256: sha256(design()), basisSha256: designBasisSha256(design()), status: 'pass' });
    expect(report.documents.variations).toEqual({ sha256: sha256(variations()), status: 'pass' });
    expect(report.variationScores).toEqual([{ variation: 'A', score: 0.933 }, { variation: 'B', score: 0.85 }, { variation: 'C', score: 0.45 }]);
    const broken = run({ variations: variations().replace('## Signature retention', '## Retention') });
    expect(broken.documents.design.status).toBe('pass');
    expect(broken.documents.variations.status).toBe('fail');
    expect(designBasisSha256(design([...DEFAULT_ROWS, '| observed-reference | desktop | 1440x900 | page | width | 1440 | px | 0 |']))).toBe(designBasisSha256(design()));
    expect(designBasisSha256(design(DEFAULT_ROWS, { signature: SIGNATURE_ROWS.map((row) => row.replace('Flat unbordered cards', 'Glass cards')) }))).not.toBe(designBasisSha256(design()));
  });

  // why: the new design tables are mandatory; there is no "unavailable" escape for them.
  it.each([
    ['typeface-forms', design().replace('### Typeface forms', '### Typefaces')],
    ['tone-budget', design().replace('### Tone budget', '### Tones')],
    ['signature-priority', design().replace('### Signature priority', '### Signatures')],
    ['tone-budget', design().replace('### Tone budget', '### Tone budget\nunavailable').replace(TONE_ROWS.join('\n'), '')],
  ])('fails when %s is missing', (id, document) => {
    const report = run({ design: document, variations: variations(document) });
    expect(checkOf(report, id)?.status).toBe('fail');
    expect(report.documents.design.status).toBe('fail');
    expect(report.documents.design.basisSha256).toBeNull();
  });

  // why: a family name alone cannot carry the display form; classes and substitutes must be the same form.
  it('rejects unknown form classes and substitutes of another form class', () => {
    const unknown = run({ design: design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('| neo-grotesk |', '| futuristic |')] }) });
    expect(checksMatching(unknown, 'typeface:line-')[0]).toMatchObject({ status: 'fail' });
    expect(checksMatching(unknown, 'typeface:line-')[0].detail).toContain('unknown: futuristic');
    const mismatch = run({ design: design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('Roboto (neo-grotesk/grotesk)', 'Roboto Slab (slab)')] }) });
    expect(checksMatching(mismatch, 'typeface:line-')[0].detail).toContain('shares no form class');
    const unformatted = run({ design: design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('Inter (neo-grotesk)', 'Inter')] }) });
    expect(checksMatching(unformatted, 'typeface:line-')[0].detail).toContain('Family (class');
  });

  // why: the experiment's T4 failure had no display row at all; display-fonts then had nothing to cover.
  it('requires a Typeface forms row whose Role names the display face', () => {
    const bodyOnly = '| Body text | Georgia (system) | text-serif | Bracketed serifs, moderate contrast | Merriweather (text-serif) |';
    const missing = run({ design: design(DEFAULT_ROWS, { typeface: [bodyOnly] }) });
    expect(checkOf(missing, 'typeface-forms')).toMatchObject({ status: 'fail' });
    expect(checkOf(missing, 'typeface-forms')?.detail).toContain('display, heading, headline, title or hero');
    expect(missing.documents.design.status).toBe('fail');
    // Korean-language documents name roles in Korean (the skills write prose in the user's language).
    for (const role of ['Hero headline', 'Section title', 'DISPLAY', '디스플레이 제목', '히어로 헤드라인', '섹션 타이틀']) {
      const named = run({ design: design(DEFAULT_ROWS, { typeface: [bodyOnly.replace('| Body text |', `| ${role} |`)] }) });
      expect(checkOf(named, 'typeface-forms')?.status).toBe('pass');
    }
  });

  // why: the pixel/techno display face was recorded only as a family name; a family is not a form description.
  it.each([
    ['the source family', 'Arial'],
    ['the quoted source family with other case and spacing', '" a R i a L "'],
    ['an OFL substitute family', 'roboto'],
  ])('rejects Form features that only repeat %s', (_label, features) => {
    const report = run({ design: design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('Closed apertures, uniform stroke, flat terminals, upright caps', features)] }) });
    expect(checksMatching(report, 'typeface:line-')[0]).toMatchObject({ status: 'fail' });
    expect(checksMatching(report, 'typeface:line-')[0].detail).toContain('only names the family');
  });

  // why: one vague adjective does not let a later agent pick a same-form substitute; two named features are the floor.
  it('requires at least two distinct vocabulary features, in English or Korean', () => {
    const replace = (features: string) => run({ design: design(DEFAULT_ROWS, { typeface: [TYPEFACE_ROWS[0].replace('Closed apertures, uniform stroke, flat terminals, upright caps', features)] }) });
    const vague = replace('futuristic and techy');
    expect(checksMatching(vague, 'typeface:line-')[0].detail).toContain('found none');
    const one = replace('flat terminals, flat terminals');
    expect(checksMatching(one, 'typeface:line-')[0].detail).toContain('found terminals');
    expect(checksMatching(replace('각진 모서리, 픽셀 격자 단자, 대문자 위주'), 'typeface:line-')[0].status).toBe('pass');
    expect(checksMatching(replace('Square corners and wide caps'), 'typeface:line-')[0].status).toBe('pass');
  });

  // why: agents read the vocabulary from LENSES.md and the DESIGN template; a term the docs omit (or a stale
  // term they still list) makes a correct-looking Form features cell fail or pass unexpectedly.
  it('lists every form-feature term in LENSES.md and the DESIGN template', () => {
    for (const relative of ['../../../skills/reverse-design/LENSES.md', '../../../skills/reverse-design/templates/DESIGN.template.md']) {
      const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
      for (const { feature, terms } of FORM_FEATURE_VOCABULARY) {
        for (const term of terms) expect(text.includes(term), `${relative} lacks ${feature} term ${term}`).toBe(true);
      }
      expect(text).toMatch(/display, heading,\s+headline, title or hero/);
      for (const term of ['디스플레이', '헤드라인', '제목', '타이틀', '히어로']) expect(text.includes(term), `${relative} lacks display role term ${term}`).toBe(true);
    }
  });

  // why: docs and the validator share one vocabulary; the export is the single source the docs list.
  it('exports a form-feature vocabulary that accepts English and Korean terms', () => {
    expect(FORM_FEATURE_VOCABULARY.map((entry) => entry.feature)).toEqual(expect.arrayContaining(['terminals', 'counters', 'aperture', 'width', 'case', 'stroke', 'weight', 'x-height', 'corners', 'pixel', 'stencil', 'serif', 'geometric', 'mono', 'tracking', 'slant']));
    expect(formFeaturesNamed('Pixel grid, square terminals, uppercase-only, monospaced')).toEqual(['terminals', 'case', 'corners', 'pixel', 'mono']);
    expect(formFeaturesNamed('픽셀 격자, 각진 모서리, 좁은 자간')).toEqual(['width', 'corners', 'pixel', 'tracking']);
    expect(formFeaturesNamed('monoline strokes')).toEqual(['stroke']);
    expect(formFeaturesNamed('casement widths')).toEqual(['width']);
  });

  // why: tone budget rows are pixel measurements; a rounded claim that disagrees with tone.json is fabricated.
  it('compares tone rows with tone.json and checks units', () => {
    const wrong = run({ design: design(DEFAULT_ROWS, { tone: [TONE_ROWS[0].replace('| 0.026 |', '| 0.03 |'), TONE_ROWS[1]] }) });
    expect(checksMatching(wrong, 'tone:line-')[0]).toMatchObject({ status: 'fail' });
    expect(checksMatching(wrong, 'tone:line-')[0].detail).toContain('expected 0.026 ratio');
    const unit = run({ design: design(DEFAULT_ROWS, { tone: [TONE_ROWS[0].replace('| ratio |', '| px |'), TONE_ROWS[1]] }) });
    expect(checksMatching(unit, 'tone:line-')[0].detail).toContain('Unit ratio');
    const usage = run({ design: design(DEFAULT_ROWS, { tone: [...TONE_ROWS, '| desktop | 1440x900 | darkUsage | tiles | css | - |', '| desktop | 1440x900 | darkBandCount | 0 | unitless | 0 |'] }) });
    expect(usage.status).toBe('pass');
    const bands = run({ design: design(DEFAULT_ROWS, { tone: [...TONE_ROWS, '| desktop | 1440x900 | darkUsage | bands | css | - |'] }) });
    expect(checksMatching(bands, 'tone:line-')[2]).toMatchObject({ status: 'fail' });
    const viewport = run({ design: design(DEFAULT_ROWS, { tone: [TONE_ROWS[0].replace('1440x900', '390x844'), TONE_ROWS[1]] }) });
    expect(checksMatching(viewport, 'tone:line-')[0].detail).toContain('Viewport does not match');
  });

  // why: a tone.json measured from other evidence (or flagged at the I/O boundary) must be re-run, not trusted.
  it('keeps stale or unreadable tone.json unverified with a rerun instruction', () => {
    const changed = evidence(); changed.captures[0].observations.rootFontSize = '20px';
    for (const report of [run({ tone: toneReport(changed) }), run({ toneProblem: 'tone.json is invalid or stale: image hash differs' }), run({ tone: null })]) {
      expect(report.status).toBe('unverified');
      expect(checkOf(report, 'tone-report')?.status).toBe('unverified');
      expect(checkOf(report, 'tone-report')?.detail).toContain('run design-lens tone');
      expect(checksMatching(report, 'tone:line-').every((item) => item.status === 'unverified')).toBe(true);
    }
  });

  // why: each profiled capture needs its dark and full-bleed budget; unprofiled captures stay unverified, not failing.
  it('requires darkShare and fullBleedDarkShare rows per profiled capture only', () => {
    const missing = run({ design: design(DEFAULT_ROWS, { tone: [TONE_ROWS[0]], signature: SIGNATURE_ROWS.map((row) => row.replaceAll('tone/desktop/fullBleedDarkShare', 'tone/desktop/darkShare')) }) });
    expect(checkOf(missing, 'tone-coverage:desktop')).toMatchObject({ status: 'fail' });
    expect(checkOf(missing, 'tone-coverage:desktop')?.detail).toContain('fullBleedDarkShare');
    const source = evidence(); source.captures.push(capture('mobile', 390));
    const rows = [...DEFAULT_ROWS, '| observed-reference | mobile | 390x900 | dl-1 | rect.width | 320 | px | 0 |'];
    const document = design(rows, { tone: [...TONE_ROWS, '| mobile | 390x900 | darkShare | 0.026 | ratio | 3 |'] });
    const report = validateDesignDocuments({ design: document, variations: variations(document), evidence: source, tone: toneReport(source, ['desktop']) });
    expect(checkOf(report, 'tone-coverage:mobile')).toBeUndefined();
    expect(checksMatching(report, 'tone:line-')[2]).toMatchObject({ status: 'unverified' });
    expect(report.status).toBe('unverified');
  });

  // why: ranked signatures must rest on validated measurements; trivia or invented citations cannot rank.
  it('validates signature rows, ranks and kinds', () => {
    const unmatched = run({ design: design(DEFAULT_ROWS, { signature: SIGNATURE_ROWS.map((row) => row.replace('| layout | tone/desktop/darkShare |', '| layout | desktop/dl-9/rect.width |')) }) });
    expect(checksMatching(unmatched, 'signature:line-')[3].detail).toContain('matches no Measured observations row');
    const short = run({ design: design(DEFAULT_ROWS, { signature: SIGNATURE_ROWS.slice(0, 4) }) });
    expect(checkOf(short, 'signature-priority')?.detail).toContain('5–10');
    const order = run({ design: design(DEFAULT_ROWS, { signature: [SIGNATURE_ROWS[1], SIGNATURE_ROWS[0], ...SIGNATURE_ROWS.slice(2)] }) });
    expect(checkOf(order, 'signature-priority')?.detail).toContain('1..N');
    const kinds = run({ design: design(DEFAULT_ROWS, { signature: SIGNATURE_ROWS.map((row) => row.replace('| typeface |', '| layout |')) }) });
    expect(checkOf(kinds, 'signature-kinds')).toMatchObject({ status: 'fail' });
    expect(checkOf(kinds, 'signature-kinds')?.detail).toContain('typeface row');
    const failedRow = run({ design: design([DEFAULT_ROWS[0], DEFAULT_ROWS[1], DEFAULT_ROWS[2], DEFAULT_ROWS[3].replace('| Arial |', '| Helvetica |')]) });
    expect(checksMatching(failedRow, 'signature:line-')[1]).toMatchObject({ status: 'fail' });
  });

  // why: VARIATIONS checks that depend on ranks must not pass or fail on an unparsed DESIGN priority table.
  it('marks rank-dependent VARIATIONS checks unverified when the priority table is unavailable', () => {
    const document = design(DEFAULT_ROWS, { signature: SIGNATURE_ROWS.slice(0, 4) });
    const report = run({ design: document });
    for (const id of ['signature-retention', 'retention-range']) {
      expect(checkOf(report, id)).toMatchObject({ status: 'unverified', detail: 'signature priority table is unavailable' });
    }
    expect(checkOf(report, 'build-contract')?.detail).toContain('signature priority table is unavailable');
  });
});

describe('variation retention, selection and build contract', () => {
  // why: the direction must be re-evaluated whenever the ranked signatures, typefaces or tone budget change.
  it('fails a missing or stale design basis', () => {
    const changed = design(DEFAULT_ROWS, { signature: SIGNATURE_ROWS.map((row) => row.replace('Flat unbordered cards', 'Glass cards')) });
    const stale = run({ design: changed, variations: variations() });
    expect(checkOf(stale, 'selected-direction')?.detail).toContain('changed after the direction was selected');
    expect(stale.documents.design.status).toBe('pass');
    const missing = run({ variations: variations(design(), { selected: ['- **Direction:** Variation A'] }) });
    expect(checkOf(missing, 'selected-direction')?.detail).toContain('record the design basis');
    const unknown = run({ variations: variations(design(), { selected: ['- **Direction:** Variation Q', `- **Design basis:** sha256:${designBasisSha256(design())}`] }) });
    expect(checkOf(unknown, 'selected-direction')?.detail).toContain('existing Variation');
  });

  // why: the 0.3.0-style bullet "**Direction:** **A — …**" names A; emphasis must not hide the letter.
  it('reads the selected letter through bold or italic emphasis', () => {
    const basis = `- **Design basis:** sha256:${designBasisSha256(design())}`;
    for (const bullet of ['- **Direction:** **A — Calm campus**', '- **Direction:** *Variation A*', '- **Direction:** __A__']) {
      expect(checkOf(run({ variations: variations(design(), { selected: [bullet, basis] }) }), 'selected-direction')?.status, bullet).toBe('pass');
    }
    expect(checkOf(run({ variations: variations(design(), { selected: ['- **Direction:** the calm one', basis] }) }), 'selected-direction')?.detail).toContain('- **Direction:** Variation A');
  });

  // why: picking a low-retention direction needs an explicit, quoted reason from the user or brief.
  it('requires a quoted selection basis for a lower-scoring direction', () => {
    const basis = `- **Design basis:** sha256:${designBasisSha256(design())}`;
    const bare = run({ variations: variations(design(), { selected: ['- **Direction:** Variation C', basis] }) });
    expect(checkOf(bare, 'selected-direction')?.detail).toContain('Selection basis');
    const quoted = run({ variations: variations(design(), { selected: ['- **Direction:** Variation C', basis, '- **Selection basis:** User: "Compact information density matters more than ornament"'] }) });
    expect(checkOf(quoted, 'selected-direction')?.status).toBe('pass');
    const invented = run({ variations: variations(design(), { selected: ['- **Direction:** Variation C', basis, '- **Selection basis:** User: "Make it dark"'] }) });
    expect(checkOf(invented, 'selected-direction')?.status).toBe('fail');
  });

  // why: every variation dropped the same signatures in the experiment; at least one direction must retain them.
  it('fails when no variation retains at least 0.75 of the weighted signatures', () => {
    const quote = 'Brief: "Compact information density matters more than ornament"';
    const low = [1, 2, 3, 4, 5].map((rank) => `| ${rank} | ${rank === 2 ? 'substitute' : rank > 3 ? 'drop' : 'adapt'}: a | adapt: b | ${rank > 3 ? 'drop' : 'adapt'}: c | ${rank > 3 ? quote : '-'} |`);
    const report = run({ variations: variations(design(), { retention: low }) });
    expect(report.variationScores.map((item) => item.score)).toEqual([0.6, 0.75, 0.6]);
    expect(checkOf(report, 'retention-range')?.status).toBe('pass');
    const lower = [1, 2, 3, 4, 5].map((rank) => `| ${rank} | ${rank > 3 ? 'drop' : 'adapt'}: a | ${rank > 3 ? 'drop' : 'adapt'}: b | ${rank > 3 ? 'drop' : 'adapt'}: c | ${rank > 3 ? quote : '-'} |`);
    const failed = run({ variations: variations(design(), { retention: lower }) });
    expect(checkOf(failed, 'retention-range')).toMatchObject({ status: 'fail' });
    expect(checkOf(failed, 'retention-range')?.detail).toContain('no high-retention direction');
    const incomplete = run({ variations: variations(design(), { retention: RETENTION_ROWS.slice(0, 4) }) });
    expect(checkOf(incomplete, 'signature-retention')?.detail).toContain('missing 5');
  });

  // why: drops of top-ranked signatures need a requirement that actually exists in the brief.
  it('verifies quoted drop bases against the Target brief', () => {
    const invented = run({ variations: variations(design(), { retention: RETENTION_ROWS.map((row) => row.replace('Compact information density matters more than ornament', 'Ornament is banned')) }) });
    expect(checksMatching(invented, 'retention:line-')[2].detail).toContain('quoted requirement is not in the Target brief');
    const unquoted = run({ variations: variations(design(), { retention: RETENTION_ROWS.map((row) => row.replace('Brief: "Compact information density matters more than ornament"', '-')) }) });
    expect(checksMatching(unquoted, 'retention:line-')[2].detail).toContain('rank 3 is dropped by Variation C without a quoted');
    const malformed = run({ variations: variations(design(), { retention: RETENTION_ROWS.map((row) => row.replace('keep: flat cards | keep', 'retain flat cards | keep')) }) });
    expect(checksMatching(malformed, 'retention:line-')[4].detail).toContain('Variation A cell');
  });

  // why: the experiment's variations all dropped the same lower-ranked signatures, so choosing a direction could not
  // change fidelity; a unanimous drop needs a quoted basis even below rank 3.
  it('fails a signature that every variation drops without a quoted basis', () => {
    const unanimous = RETENTION_ROWS.map((row) => row.replace('| keep: flat cards | keep: flat cards | drop: list rows | - |', '| drop: none | drop: none | drop: list rows | - |'));
    const report = run({ variations: variations(design(), { retention: unanimous }) });
    expect(checksMatching(report, 'retention:line-')[4]).toMatchObject({ status: 'fail' });
    expect(checksMatching(report, 'retention:line-')[4].detail).toContain('rank 5 is dropped by every variation');
    const quoted = run({ variations: variations(design(), { retention: unanimous.map((row) => row.replace('drop: list rows | - |', 'drop: list rows | Brief: "Compact information density matters more than ornament" |')) }) });
    expect(checksMatching(quoted, 'retention:line-')[4].status).toBe('pass');
  });

  // why: fonts, display fonts and tone maxima cannot drift from DESIGN.md and the reference measurements.
  it('cross-checks the build contract against typeface forms, tone.json and selected signatures', () => {
    const fonts = run({ variations: variations(design(), { contract: CONTRACT_ROWS.map((row) => row.replace('| Inter; Roboto |', '| Inter; Roboto; Space Grotesk |')) }) });
    expect(checkOf(fonts, 'build-contract')?.detail).toContain('not listed: Space Grotesk');
    const typeface = [...TYPEFACE_ROWS, '| Body text | Georgia (system) | text-serif | Bracketed serifs, moderate contrast | Merriweather (text-serif) |'];
    const document = design(DEFAULT_ROWS, { typeface });
    const display = run({ design: document, variations: variations(document, { contract: CONTRACT_ROWS.map((row) => row.replace('| Inter; Roboto |', '| Inter; Merriweather |').replace('| display-fonts | Inter |', '| display-fonts | Merriweather |')) }) });
    expect(checkOf(display, 'build-contract')?.detail).toContain('display-fonts must include a substitute for the Display heading typeface');
    const darkRows = CONTRACT_ROWS.map((row) => row.replace('| dark-share-max | 0.1 |', '| dark-share-max | 0.5 |'));
    expect(checkOf(run({ variations: variations(design(), { contract: darkRows }) }), 'build-contract')?.detail).toContain('exceeds the reference darkShare');
    const quoted = darkRows.map((row) => row.replace('tone.json desktop darkShare 0.026', 'Brief: "Compact information density matters more than ornament"'));
    expect(checkOf(run({ variations: variations(design(), { contract: quoted }) }), 'build-contract')?.status).toBe('pass');
    const bleed = CONTRACT_ROWS.map((row) => row.replace('| full-bleed-dark-max | 0.02 |', '| full-bleed-dark-max | 0.4 |'));
    expect(checkOf(run({ variations: variations(design(), { contract: bleed }) }), 'build-contract')?.detail).toContain('full-bleed-dark-max 0.4 exceeds');
    expect(checkOf(run({ tone: undefined }), 'build-contract')?.status).toBe('unverified');
    const noCheck = run({ variations: variations(design(), { contract: CONTRACT_ROWS.filter((row) => !row.startsWith('| check:3')) }) });
    expect(checkOf(noCheck, 'build-contract')?.detail).toContain('needs at least one check:3 row');
    const unknownRank = run({ variations: variations(design(), { contract: [...CONTRACT_ROWS, '| check:9 | h2 :: count >= 1 | invented |'] }) });
    expect(checkOf(unknownRank, 'build-contract')?.detail).toContain('not in Signature priority (9)');
    const malformed = run({ variations: variations(design(), { contract: [...CONTRACT_ROWS, '| palette | dark | - |'] }) });
    expect(checkOf(malformed, 'build-contract')).toMatchObject({ status: 'fail' });
  });
});

describe('reference fidelity', () => {
  const criteria = '| Criterion | Evidence or result |\n| --- | --- |\n| Layout at 390 | Measured in the QA run |';

  // why: once a build was verified (a QA run or a non-planned criterion), the fidelity table becomes mandatory.
  it('requires the reference fidelity section once QA ran or a criterion is no longer planned', () => {
    const byRun = run({ qaRunIds: [RUN] });
    expect(byRun.referenceFidelity.required).toBe(true);
    expect(checkOf(byRun, 'reference-fidelity')).toMatchObject({ status: 'fail' });
    const byCriteria = run({ variations: variations(design(), { criteria }) });
    expect(checkOf(byCriteria, 'reference-fidelity')).toMatchObject({ status: 'fail' });
    const planned = run({ variations: variations(design(), { criteria: '| Criterion | Evidence or result |\n| --- | --- |\n| Layout | Planned; not run during analysis |' }) });
    expect(planned.referenceFidelity.required).toBe(false);
    expect(planned.status).toBe('pass');
    const plannedRows = run({ variations: variations(design(), { extra: fidelityRows(RUN, ['planned', 'planned', 'planned', 'planned', 'planned']).replaceAll(`qa/${RUN} compare sheet`, 'after the build') }) });
    expect(plannedRows.status).toBe('pass');
    expect(plannedRows.referenceFidelity).toEqual({ required: false, score: null, qaRun: null });
  });

  // why: a passing, confirmed newest QA run is the only evidence that lets fidelity verdicts pass.
  it('accepts verdicts that cite the newest passing confirmed QA run and scores them', () => {
    const report = run({ variations: variations(design(), { extra: fidelityRows() }), qaRunIds: [RUN], qaRuns: new Map([[RUN, PASSED_RUN]]) });
    expect(report.status).toBe('pass');
    expect(report.referenceFidelity).toEqual({ required: true, score: 0.967, qaRun: RUN });
  });

  // why: each failure mode of the QA evidence must block or downgrade the fidelity claim.
  it.each([
    ['failed run', { ...PASSED_RUN, status: 'fail' as const }, [RUN], 'fail', 'failed; fix its fail findings'],
    ['unverified run', { ...PASSED_RUN, status: 'unverified' as const, skipped: ['unsourced-number@390x844: no --content'] }, [RUN], 'unverified', 'skipped: unsourced-number@390x844'],
    ['unconfirmed review', { ...PASSED_RUN, reviewConfirmed: false }, [RUN], 'fail', 'run design-lens qa-confirm'],
    ['older run', PASSED_RUN, [RUN, NEWER_RUN], 'fail', 'a newer QA run exists'],
    ['failed signature check', { ...PASSED_RUN, signatureChecks: [{ rank: 2, pass: false }] }, [RUN], 'fail', 'rank 2 is marked present but its signature check failed'],
    ['unreadable run', { status: 'unverified' as const, reviewConfirmed: false, problem: 'qa.json is unreadable' }, [RUN], 'fail', 'is unreadable'],
    ['run without --project', { ...PASSED_RUN, project: null }, [RUN], 'fail', 'ran without --project'],
  ])('rejects a %s', (_, state, runIds, status, detail) => {
    const report = run({ variations: variations(design(), { extra: fidelityRows() }), qaRunIds: runIds, qaRuns: new Map([[RUN, state]]) });
    expect(checkOf(report, 'reference-fidelity-qa')?.status).toBe(status);
    expect(checkOf(report, 'reference-fidelity-qa')?.detail).toContain(detail);
  });

  // why: after a QA run the contract mode and check selectors were changed and validate-design still passed while
  // Reference fidelity cited the run that checked the old contract; the run must check the current contract.
  it('rejects a QA run that checked a different Build contract or mode', () => {
    const current = parseBuildContract(variations(design(), { extra: fidelityRows() })).contract!;
    const same = { ...PASSED_RUN, contractKey: buildContractKey(current), mode: current.mode };
    const pass = run({ variations: variations(design(), { extra: fidelityRows() }), qaRunIds: [RUN], qaRuns: new Map([[RUN, same]]) });
    expect(checkOf(pass, 'reference-fidelity-qa')?.status).toBe('pass');
    const reordered = buildContractKey({ ...current, checks: [...current.checks].reverse() });
    expect(reordered).toBe(buildContractKey(current));
    const edited = buildContractKey({ ...current, checks: current.checks.map((item) => ({ ...item, selector: `${item.selector} > *` })) });
    const stale = run({ variations: variations(design(), { extra: fidelityRows() }), qaRunIds: [RUN], qaRuns: new Map([[RUN, { ...same, contractKey: edited }]]) });
    expect(checkOf(stale, 'reference-fidelity-qa')).toMatchObject({ status: 'fail', detail: expect.stringContaining(`the Build contract changed after qa/${RUN}; rerun qa`) });
    const mode = run({ variations: variations(design(), { extra: fidelityRows() }), qaRunIds: [RUN], qaRuns: new Map([[RUN, { ...same, mode: 'clone-base' }]]) });
    expect(checkOf(mode, 'reference-fidelity-qa')?.detail).toContain('mode (qa ran clone-base, the contract says derive) changed');
  });

  // why: a kept signature cannot be reported missing (or dropped), and decisions must match the selection.
  it('validates verdicts, decisions and QA citations per row', () => {
    const qa = { qaRunIds: [RUN], qaRuns: new Map([[RUN, PASSED_RUN]]) };
    const missing = run({ variations: variations(design(), { extra: fidelityRows(RUN, ['present', 'missing', 'present', 'present', 'present']) }), ...qa });
    expect(checksMatching(missing, 'fidelity:line-')[1].detail).toContain('missing from the build');
    expect(missing.referenceFidelity.score).toBeNull();
    const decision = run({ variations: variations(design(), { extra: fidelityRows(RUN, undefined, ['keep', 'keep', 'keep', 'keep', 'keep']) }), ...qa });
    expect(checksMatching(decision, 'fidelity:line-')[1].detail).toContain("Variation A's decision (substitute)");
    const uncited = run({ variations: variations(design(), { extra: fidelityRows().replace(`qa/${RUN} compare sheet`, 'screenshot') }), ...qa });
    expect(checksMatching(uncited, 'fidelity:line-')[0].detail).toContain('exactly one QA run');
    const mixed = run({ variations: variations(design(), { extra: fidelityRows().replace(`qa/${RUN}`, `qa/${NEWER_RUN}`) }), qaRunIds: [RUN, NEWER_RUN], qaRuns: new Map([[RUN, PASSED_RUN], [NEWER_RUN, PASSED_RUN]]) });
    expect(checkOf(mixed, 'reference-fidelity')?.detail).toContain('same QA run');
  });
});
