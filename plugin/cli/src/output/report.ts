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

import { isFontResource } from '../localize/media-type.js';
import type { ManifestRemote, ManifestResource } from './manifest.js';

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

/** One localized webfont: where its bytes landed, and the host they came from. */
export interface FontFile {
  /** Project-dir-relative path, under `clone/assets/`. */
  localPath: string;
  /** Origin host of `originalUrl`, including the port when non-default (e.g. `fonts.gstatic.com`). */
  host: string;
}

/** Shown instead of a host when a resource's `originalUrl` is not a parseable absolute URL. */
const UNKNOWN_HOST = 'unknown host';

/**
 * Extract the localized webfonts from the manifest's `resources[]`, in manifest order.
 *
 * Spec 10 §Layer 1 requires font provenance to be VISIBLE for commercial-font licence checks: the
 * `assets/<host>/<path>` layout encodes the host, but a reader must not have to spelunk directories
 * for it. This is the one place that turns `originalUrl` back into a host, so the report and the
 * license notice's "font files and their source hosts are listed above" cannot become a lie.
 *
 * A resource whose `originalUrl` does not parse is listed with {@link UNKNOWN_HOST} rather than
 * dropped — an unattributable font is exactly what a licence check must see, not what it must miss.
 */
export function fontFilesFrom(resources: ManifestResource[]): FontFile[] {
  return resources
    .filter((r) => isFontResource(r.contentType, r.localPath))
    .map((r) => {
      let host: string;
      try {
        host = new URL(r.originalUrl).host || UNKNOWN_HOST;
      } catch {
        host = UNKNOWN_HOST;
      }
      return { localPath: r.localPath, host };
    });
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
    /** Every localized font file with its origin host — the licence-check surface (spec 10). */
    fontFiles: FontFile[];
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

  // Rendered as a list, not a directory hint: a licence check reads REPORT.md, not `find clone/`.
  const fontBlock =
    capture.fontFiles.length === 0
      ? 'Localized font files: none — this capture localized no webfonts.'
      : `Localized font files (check each licence before shipping derived work):\n${capture.fontFiles
          .map((f) => `- ${f.localPath} — from ${f.host}`)
          .join('\n')}`;

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

${fontBlock}

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
