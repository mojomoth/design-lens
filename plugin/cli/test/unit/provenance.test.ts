/**
 * Unit tests for the `clone/index.html` provenance stamp and the clone completion notice.
 *
 * WHY these exist (T27, spec 10-ethics §Layer 1): the ethics guardrails are mechanical, so the three
 * places the product states its version — the provenance comment, `manifest.tool.version`, and the
 * CLI `--version` output — MUST agree, and the stamp `clone` writes MUST be one `verify` accepts.
 * Both couplings are invisible at runtime: a reworded template or a hardcoded version still produces
 * a plausible-looking clone, and only a user checking provenance months later would discover the lie.
 *
 * If these tests are removed: `clone` may emit stamps its own `verify` rejects (the two literals
 * lived apart before this task), the version in every clone on disk may drift from the tool that
 * wrote it, and the spec-verbatim stderr notice may silently degrade into a paraphrase.
 */

import { describe, expect, it } from 'vitest';

import { buildManifest } from '../../src/output/manifest.js';
import { COMPLETION_NOTICE, PROVENANCE_LINE, provenanceComment } from '../../src/output/provenance.js';
import { VERSION } from '../../src/version.js';

const CAPTURED_AT = '2026-07-08T12:34:56.789Z';

describe('provenanceComment', () => {
  // why: spec 03 §Provenance comment pins the template byte-for-byte (only version + timestamp vary).
  // Any rewording breaks every downstream consumer that greps clones for their origin.
  it('renders the spec template with the version and capture timestamp substituted', () => {
    expect(provenanceComment(CAPTURED_AT)).toBe(
      `<!-- Cloned by design-lens v${VERSION} at ${CAPTURED_AT} for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->`,
    );
  });

  // why (ADR-011): sealed assertion A4 forbids the capture host anywhere inside `clone/`. The stamp
  // is line 1 of a file inside `clone/`, so it must never grow a source-URL field back.
  it('embeds no source URL', () => {
    const comment = provenanceComment(CAPTURED_AT);
    expect(comment).not.toMatch(/https?:\/\//);
    expect(comment).not.toContain('127.0.0.1');
  });

  // why (spec 10 L17): "The version in the comment MUST equal manifest.json tool.version and the CLI
  // --version output." All three read `VERSION`; this test is what proves the wiring, not the intent.
  it('carries the same version as manifest.tool.version', () => {
    const manifest = buildManifest({
      playwrightVersion: '1.61.1',
      source: {
        url: 'https://example.com/',
        finalUrl: 'https://example.com/',
        title: 'Example',
        capturedAt: CAPTURED_AT,
        viewport: { width: 1440, height: 900 },
        userAgent: 'test-agent',
        robotsDisallowed: false,
      },
      resources: [],
      stats: { elementsStamped: 0, styleRules: 0, fonts: 0, images: 0, cssFiles: 0, warnings: 0 },
    });
    expect(provenanceComment(CAPTURED_AT)).toContain(`v${manifest.tool.version} `);
  });

  // why: `verify` rejects a clone whose line 1 fails PROVENANCE_LINE. Producer and validator now sit
  // in one module precisely so this round-trip holds; assert it rather than trusting proximity.
  it('produces a line its own validator accepts', () => {
    expect(PROVENANCE_LINE.test(provenanceComment(CAPTURED_AT))).toBe(true);
  });
});

describe('PROVENANCE_LINE', () => {
  // why: `verify` runs against clones written by EARLIER releases, so the version group must stay
  // loose. Pinning it to the current VERSION would fail every clone the day the version bumps.
  it('accepts stamps written by other versions, including prereleases', () => {
    expect(PROVENANCE_LINE.test(provenanceComment(CAPTURED_AT).replace(`v${VERSION}`, 'v9.2.31'))).toBe(true);
    expect(
      PROVENANCE_LINE.test(provenanceComment(CAPTURED_AT).replace(`v${VERSION}`, 'v1.0.0-rc.2')),
    ).toBe(true);
  });

  // why: the whole point of a fixed template is that drift is detectable. A stamp missing its
  // license pointer, or one carrying a source URL, must be rejected — not waved through.
  it('rejects reworded, truncated, and URL-bearing stamps', () => {
    expect(PROVENANCE_LINE.test('<!-- Cloned by design-lens v0.1.0 -->')).toBe(false);
    expect(
      PROVENANCE_LINE.test(
        `<!-- Cloned by design-lens v0.1.0 from http://127.0.0.1:4630/index.html at ${CAPTURED_AT} for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->`,
      ),
    ).toBe(false);
    expect(PROVENANCE_LINE.test(`  ${provenanceComment(CAPTURED_AT)}`)).toBe(false);
  });
});

describe('COMPLETION_NOTICE', () => {
  // why (spec 10 §Interfaces): the completion one-liner is quoted verbatim in the spec. It is the
  // only moment the human is told the clone is study material; a paraphrase is a spec violation.
  it('is the verbatim spec text', () => {
    expect(COMPLETION_NOTICE).toBe(
      'Note: this clone is for private design study only — see REPORT.md "License & usage notice" before shipping anything derived.',
    );
  });
});
