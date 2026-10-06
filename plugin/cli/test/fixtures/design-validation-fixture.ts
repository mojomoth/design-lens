import { evidenceHash, type EvidenceDocument, type SourceCapture } from '../../src/capture/evidence.js';
import { designBasisSha256 } from '../../src/analyze/design-validation.js';
import type { ObservationDocument } from '../../src/analyze/observations.js';
import { TONE_THRESHOLDS, type ToneDocument, type ToneProfile } from '../../src/analyze/tone.js';

export function observationDocument(width = 1440): ObservationDocument {
  return {
    viewport: { width, height: 900 }, deviceScaleFactor: 1, width, height: 900, rootFontSize: '16px',
    fonts: { status: 'ready', failedFamilies: [] }, complete: true, warnings: [],
    elements: [{
      dlId: 'dl-1', tag: 'h1', text: 'Evidence title', semantic: 'heading', domPath: 'body>h1:nth-of-type(1)',
      rootPath: [], parentDlId: null, childDlIds: [], visible: true, currentSrc: null,
      rect: { x: 24, y: 24, width: 320, height: 40 },
      styles: { fontSize: '32px', fontFamily: 'Arial', color: 'rgba(10, 20, 30, 0.5)', fontWeight: '700' },
      pseudo: { before: { content: 'none', styles: {} }, after: { content: 'none', styles: {} } },
    }],
  };
}

export function capture(id = 'desktop', width = 1440): SourceCapture {
  return {
    id, viewport: { width, height: 900 }, deviceScaleFactor: 1, capturedAt: '2026-01-01T00:00:00.000Z',
    browserVersion: 'fixture', userAgent: 'fixture', sourceUrl: 'http://127.0.0.1/reference', finalUrl: 'http://127.0.0.1/reference',
    policy: { reducedMotion: 'reduce', colorScheme: 'light', removeSelectors: [] }, observations: observationDocument(width),
    viewportScreenshot: `evidence/${id}/viewport.png`, fullScreenshot: `evidence/${id}/full.png`, snapshot: `evidence/${id}/index.html`,
    files: [], complete: true, warnings: [],
  };
}

export function evidence(): EvidenceDocument { return { schemaVersion: 1, captures: [capture()] }; }

export const DEFAULT_ROWS = [
  '| observed-reference | desktop | 1440x900 | dl-1 | rect.width | 320 | px | 0 |',
  '| observed-reference | desktop | 1440x900 | dl-1 | styles.fontSize | 2 | rem | 2 |',
  '| observed-reference | desktop | 1440x900 | dl-1 | styles.color | rgb(10 20 30 / 50%) | color | - |',
  '| observed-reference | desktop | 1440x900 | dl-1 | styles.fontFamily | Arial | css | - |',
];

export const TYPEFACE_ROWS = [
  '| Display heading | Arial (system, loaded) | neo-grotesk | Closed apertures, uniform stroke, flat terminals, upright caps | Inter (neo-grotesk); Roboto (neo-grotesk/grotesk) |',
];
export const TONE_ROWS = [
  '| desktop | 1440x900 | darkShare | 0.026 | ratio | 3 |',
  '| desktop | 1440x900 | fullBleedDarkShare | 0 | ratio | 2 |',
];
export const SIGNATURE_ROWS = [
  '| 1 | Light page; dark only in small tiles | tone | tone/desktop/darkShare; tone/desktop/fullBleedDarkShare | keep | dark-share-max, full-bleed-dark-max |',
  '| 2 | Bold neo-grotesk display heading | typeface | desktop/dl-1/styles.fontFamily | substitute | check:2 |',
  '| 3 | Corner tick marks framing the title block | ornament | tone/desktop/darkShare | adapt | check:3 |',
  '| 4 | Single narrow title column | layout | tone/desktop/darkShare | keep | Visual review |',
  '| 5 | Flat unbordered cards | component | tone/desktop/fullBleedDarkShare | adapt | Visual review |',
];

export const DEFAULT_PROFILE: ToneProfile = {
  width: 1440, height: 900, lightShare: 0.9, midShare: 0.074, darkShare: 0.026, fullBleedDarkShare: 0, tileDarkShare: 0.026,
  darkBandCount: 0, darkBands: [], darkUsage: 'tiles',
};

/** A tone.json bound to `source`; captures not listed in `captureIds` are absent from it. */
export function toneReport(source: EvidenceDocument = evidence(), captureIds: string[] = ['desktop']): ToneDocument {
  return {
    schemaVersion: 1, evidenceHash: evidenceHash(source), thresholds: { ...TONE_THRESHOLDS },
    captures: source.captures.filter((item) => captureIds.includes(item.id)).map((item) => ({
      captureId: item.id, viewport: { ...item.viewport }, deviceScaleFactor: item.deviceScaleFactor, complete: item.complete && item.observations.complete,
      image: { path: item.fullScreenshot, sha256: '0'.repeat(64), width: item.viewport.width, height: item.viewport.height },
      profile: { ...DEFAULT_PROFILE, width: item.viewport.width, height: item.viewport.height },
    })),
  };
}

export function design(rows: string[] = DEFAULT_ROWS, tables: { typeface?: string[]; tone?: string[]; signature?: string[] } = {}): string {
  return `# Reference design

## Measured observations

| Label | Capture | Viewport | Observation | Field | Value | Unit | Precision |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## 1. First Impression
Measured hierarchy is the evidence; intent is inferred.
## 2. Design Intent
The target brief is not supplied.
## 3. Layout & Grid
### Layout recipe
| Container | Width | Evidence |
| --- | --- | --- |
| Heading | 320px | desktop/dl-1/rect.width |
### Spacing recipe
| Role | Value | Evidence |
| --- | --- | --- |
| Heading inset | 24px | desktop/dl-1/rect.x |
### Responsive rules
| Viewport | Rule | Evidence |
| --- | --- | --- |
| 1440x900 | Heading remains in its container | desktop/dl-1/rect.width |
## 4. Visual Hierarchy
The heading precedes the body.
## 5. Typography
### Typography recipe
| Role | Size | Evidence |
| --- | --- | --- |
| Heading | 2rem | desktop/dl-1/styles.fontSize |
### Typeface forms
| Role | Source family and status | Form class | Form features | OFL substitutes |
| --- | --- | --- | --- | --- |
${(tables.typeface ?? TYPEFACE_ROWS).join('\n')}
## 6. Color System
### Color roles
| Role | Color | Evidence |
| --- | --- | --- |
| Heading | rgba(10,20,30,0.5) | desktop/dl-1/styles.color |
### Tone budget
| Capture | Viewport | Metric | Value | Unit | Precision |
| --- | --- | --- | --- | --- | --- |
${(tables.tone ?? TONE_ROWS).join('\n')}
## 7. Imagery & Iconography
No reference artwork is required by this study.
## 8. Motion & Interaction
Interaction intent is inferred; original JavaScript is unavailable.
## 9. Component Patterns
### Component recipes
| Component | Anatomy | Evidence |
| --- | --- | --- |
| Title | One h1 | desktop/dl-1 |
## 10. Signature Moves
The title creates a strong initial focal point.
### Signature priority
| Rank | Device | Kind | Evidence | Transfer | Build check |
| --- | --- | --- | --- | --- | --- |
${(tables.signature ?? SIGNATURE_ROWS).join('\n')}
## 11. What NOT to Copy
Use original branding and source text.
## 12. Reusable Principles
Carry the measured type scale into an appropriate target.
### CSS recipe
\`\`\`css
h1 { font-size: 2rem; width: 320px; }
\`\`\`
`;
}

export const RETENTION_ROWS = [
  '| 1 | keep: light canvas | keep: light canvas | adapt: light canvas with one dark tile | - |',
  '| 2 | substitute: Inter heading | substitute: Inter heading | substitute: Roboto heading | - |',
  '| 3 | keep: corner ticks on the title | adapt: corner ticks on cards | drop: compact list has no title block | Brief: "Compact information density matters more than ornament" |',
  '| 4 | keep: narrow column | adapt: wider column | drop: dense grid | - |',
  '| 5 | keep: flat cards | keep: flat cards | drop: list rows | - |',
];
export const CONTRACT_ROWS = [
  '| mode | derive | build-from-design default |',
  '| fonts | Inter; Roboto | Typeface forms substitutes |',
  '| display-fonts | Inter | Typeface forms Display heading |',
  '| dark-share-max | 0.1 | tone.json desktop darkShare 0.026 |',
  '| full-bleed-dark-max | 0.02 | tone.json desktop fullBleedDarkShare 0 |',
  '| check:2 | h1 :: font-family ~ Inter | Signature priority rank 2 |',
  '| check:3 | .title-frame::before :: count >= 1 | Signature priority rank 3 |',
];

/** Variations bound to `designText`'s basis; tables can be swapped per test. */
export function variations(designText: string = design(), parts: {
  selected?: string[]; retention?: string[]; contract?: string[]; brief?: string; criteria?: string; extra?: string;
} = {}): string {
  const basis = designBasisSha256(designText) ?? designBasisSha256(design())!;
  const selected = parts.selected ?? ['- **Direction:** Variation A', `- **Design basis:** sha256:${basis}`];
  return `# Three directions
## Target brief
${parts.brief ?? 'No target product was supplied. These directions are conditional. Compact information density matters more than ornament.'}
## Selected direction
${selected.join('\n')}

A is the recommendation when preserving reference density serves the task.

### Build contract
| Contract | Value | Source |
| --- | --- | --- |
${(parts.contract ?? CONTRACT_ROWS).join('\n')}
## Structural changes
Keep one clear title; adapt content structure to the actual target brief.
## Verification criteria
${parts.criteria ?? 'Check all captured widths and the real target content before implementation is complete.'}
## Signature retention
| Rank | Variation A | Variation B | Variation C | Drop basis |
| --- | --- | --- | --- | --- |
${(parts.retention ?? RETENTION_ROWS).join('\n')}
## Variation A: Conservative
Keep the measured scale. Replace branding. Verify reading order.
## Variation B: Expressive
Propose greater type contrast. Verify long titles before adopting it.
## Variation C: Task-focused
For information-dense tasks, propose compact spacing and test scanning speed.
${parts.extra ?? ''}`;
}

/** A `## Reference fidelity` section citing `run` in every row (Variation A decisions by default). */
export function fidelityTable(run: string, verdicts = ['present', 'present', 'present', 'present', 'partial'], decisions = ['keep', 'substitute', 'keep', 'keep', 'keep']): string {
  return `## Reference fidelity
| Rank | Device | Decision | Verdict | Evidence |
| --- | --- | --- | --- | --- |
${verdicts.map((verdict, index) => `| ${index + 1} | Device ${index + 1} | ${decisions[index]} | ${verdict} | qa/${run} compare sheet |`).join('\n')}
`;
}
