/**
 * The `clone/index.html` provenance stamp — producer AND validator in one place (PURE, no I/O).
 *
 * Spec 10-ethics §Layer 1 makes this stamp mechanical and undisableable, and requires the version
 * it carries to equal `manifest.json` `tool.version` and the CLI `--version` output. All three read
 * the single-source-of-truth {@link VERSION}, so they cannot drift.
 *
 * The template deliberately omits the raw source URL: the sealed A4 assertion forbids the capture
 * host (e.g. `127.0.0.1`) anywhere inside `clone/`, and a loopback source URL would smuggle it into
 * line 1. The URL and capture time live in `manifest.source` and `REPORT.md`, both outside `clone/`
 * (ADR-011, which amended specs/03 and specs/10 to this thin form).
 *
 * {@link PROVENANCE_LINE} lives beside {@link provenanceComment} because `verify` must recognise a
 * stamp this module wrote — including one written by an OLDER version, hence the loose version
 * group. They were two independent literals before; a reworded template would have made `clone`
 * emit stamps its own `verify` rejects.
 *
 * Spec: specs/10-ethics.md §Layer 1; specs/03-clone-format.md §Provenance comment.
 */

import { VERSION } from '../version.js';

/**
 * Build line 1 of `clone/index.html`.
 *
 * @param capturedAt ISO-8601 capture timestamp; MUST be the same string as `manifest.source.capturedAt`.
 */
export function provenanceComment(capturedAt: string): string {
  return `<!-- Cloned by design-lens v${VERSION} at ${capturedAt} for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->`;
}

/**
 * Recognises any stamp {@link provenanceComment} has ever produced. The version and the ISO
 * timestamp are the only free fields; every other byte is fixed, so a reworded or truncated stamp is
 * caught. The version group is a loose semver (not the literal {@link VERSION}) because `verify`
 * runs against clones captured by earlier releases.
 */
export const PROVENANCE_LINE =
  /^<!-- Cloned by design-lens v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? at \S+ for private design study and derivation only\. Source URL and capture metadata: see \.\.\/manifest\.json and \.\.\/REPORT\.md\. -->$/;

/**
 * The completion notice printed to stderr as the LAST line of a successful `clone` (spec 10 §Layer 1
 * "Completion one-liner"). Verbatim — stdout stays machine-only, so this is the one place the human
 * is told the clone is study material, not shippable output.
 */
export const COMPLETION_NOTICE =
  'Note: this clone is for private design study only — see REPORT.md "License & usage notice" before shipping anything derived.';
