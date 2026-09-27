import type { EvidenceDocument, SourceCapture } from '../../src/capture/evidence.js';
import type { ObservationDocument } from '../../src/analyze/observations.js';

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
];

export function design(rows: string[] = DEFAULT_ROWS): string {
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
## 6. Color System
### Color roles
| Role | Color | Evidence |
| --- | --- | --- |
| Heading | rgba(10,20,30,0.5) | desktop/dl-1/styles.color |
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

export function variations(): string {
  return `# Three directions
## Target brief
No target product was supplied. These directions are conditional.
## Selected direction
A is the recommendation when preserving reference density serves the task.
## Structural changes
Keep one clear title; adapt content structure to the actual target brief.
## Verification criteria
Check all captured widths and the real target content before implementation is complete.
## Variation A: Conservative
Keep the measured scale. Replace branding. Verify reading order.
## Variation B: Expressive
Propose greater type contrast. Verify long titles before adopting it.
## Variation C: Task-focused
For information-dense tasks, propose compact spacing and test scanning speed.
`;
}
