/**
 * Build the project-dir `REPORT.md` — the human-readable capture report (PURE module, no I/O).
 *
 * The gate (AC-08) and every reader depend on SIX exact `##` headings in this order and on the
 * verbatim License & usage notice paragraph (spec §REPORT.md template). The parenthesised hints in
 * the spec describe CONTENT, not literal text, so this module renders real values under each
 * heading while keeping the headings and the notice byte-exact. It lives beside the manifest
 * builder because both turn the same capture facts into on-disk provenance artifacts.
 *
 * Spec: specs/03-clone-format.md §REPORT.md template.
 */

import type { ManifestRemote } from './manifest.js';

/** The verbatim license notice — reproduced exactly (including line breaks) from the spec. */
const LICENSE_NOTICE = `This clone is for private design study and derivation. All content, images, logos, fonts and text
remain the property of their owners. Do not deploy or redistribute this clone. Before shipping any
work derived from it: replace the logo and all brand assets, rewrite all copy, replace or license
all photography, and check font licenses (font files and their source hosts are listed above).`;

/** One row of the Capture results table: a resource class, its count and total byte size. */
export interface CaptureRow {
  count: number;
  bytes: number;
}

/** Everything the report renders. Counts/bytes come straight from the manifest and pipeline. */
export interface ReportInput {
  title: string;
  source: {
    url: string;
    /** Post-redirect URL, if it differs from `url`; omitted when identical. */
    finalUrl?: string;
    capturedAt: string;
    viewport: { width: number; height: number };
    robotsDisallowed: boolean;
  };
  /** The four resource classes plus whether consent/cookie blocking ran (spec table hint). */
  capture: {
    images: CaptureRow;
    fonts: CaptureRow;
    css: CaptureRow;
    other: CaptureRow;
    /** Human summary of consent/banner blocking (e.g. "none", "#cookie-banner removed"). */
    consentBlocking: string;
  };
  /** References left remote (manifest `remote[]`); rendered one bullet each with its reason. */
  remote: ManifestRemote[];
  fidelity: {
    canvasConverted: number;
    shadowRootsSerialized: number;
    crossOriginIframes: number;
  };
  /** Pass/warn summary from the verify routine; free text so warnings can be enumerated. */
  verify: string;
}

/** Render a resource class as one Markdown table row. */
function captureRow(label: string, row: CaptureRow): string {
  return `| ${label} | ${row.count} | ${row.bytes} |`;
}

/**
 * Render the complete REPORT.md. The six `##` headings and the License & usage notice are emitted
 * verbatim; every other line reflects the passed-in capture facts.
 */
export function buildReport(input: ReportInput): string {
  const { source, capture, fidelity } = input;
  const finalUrlLine =
    source.finalUrl !== undefined && source.finalUrl !== source.url
      ? `- Final URL: ${source.finalUrl}\n`
      : '';

  const remoteBlock =
    input.remote.length === 0
      ? 'None — every referenced resource was localised.'
      : input.remote
          .map((r) => `- ${r.url} — ${r.reason} (referenced by ${r.referencedBy})`)
          .join('\n');

  return `# Clone Report: ${input.title}

## Source
- URL: ${source.url}
${finalUrlLine}- Captured at: ${source.capturedAt}
- Viewport: ${source.viewport.width}×${source.viewport.height}
- robots.txt: ${source.robotsDisallowed ? 'disallowed the captured path' : 'did not disallow the captured path'}

## Capture results
| Resource | Count | Bytes |
| --- | --- | --- |
${captureRow('Images', capture.images)}
${captureRow('Fonts', capture.fonts)}
${captureRow('CSS', capture.css)}
${captureRow('Other', capture.other)}

Consent/banner blocking: ${capture.consentBlocking}

## Left remote
${remoteBlock}

## Fidelity notes
- Canvas elements converted to images: ${fidelity.canvasConverted}
- Open shadow roots serialized: ${fidelity.shadowRootsSerialized}
- Cross-origin iframes left live: ${fidelity.crossOriginIframes}
- Closed shadow DOM is undetectable and may be missing.
- JS interactivity was intentionally removed — the clone is a photograph, not a program.

## Verify
${input.verify}

## License & usage notice
${LICENSE_NOTICE}
`;
}
