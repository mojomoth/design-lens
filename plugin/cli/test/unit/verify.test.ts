/**
 * Unit tests for the PURE verify core (`verifyClone`) and its REPORT.md summary.
 *
 * WHY these exist: `verify` is the ONLY safety net the customization layer has (ADR-002 — no op
 * scripts, no edit manifest, the agent edits clone files directly). Two failure directions are
 * equally fatal to the product and both are covered here:
 *   - a FALSE PASS lets a broken clone (duplicated `data-dl-id`, a `<script>` back in the HTML, an
 *     override sheet no longer last in the cascade) be reported as good, and the addressing system
 *     every skill edits through is silently gone;
 *   - a FALSE FAIL on a legal agent edit (spec 06: appended `[data-dl-id]` rules, an edited text
 *     node, a new file under `assets/custom/`) makes the customize-clone loop unusable, because the
 *     skill MUST see exit 0 before it reports an edit as done.
 *
 * The core is pure, so all of this is provable without a browser, a server, or a temp dir (spec 08:
 * unit tests bind no ports and launch no browser). The e2e proves the same invariants against a REAL
 * clone the pipeline wrote.
 */

import { describe, expect, it } from 'vitest';

import {
  summarizeVerify,
  verifyClone,
  type VerifyCheckId,
  type VerifyInput,
  type VerifyReport,
} from '../../src/commands/verify.js';

const PROVENANCE =
  '<!-- Cloned by design-lens v0.1.0 at 2026-07-08T00:00:00.000Z for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->';

/** A minimal but STRUCTURALLY REAL clone document: provenance line 1, stamps, overrides linked last. */
function goodHtml(body = '<h1 data-dl-id="dl-1">Hello</h1><p data-dl-id="dl-2">Copy</p>'): string {
  return `${PROVENANCE}
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="assets/example-com/style.css">
<style>.inline{color:red}</style>
<link rel="stylesheet" href="assets/dl-overrides.css">
</head>
<body>${body}</body>
</html>`;
}

function goodManifest(localPaths: string[] = ['clone/assets/example-com/style.css']): string {
  return JSON.stringify({
    version: 1,
    tool: { name: 'design-lens', version: '0.1.0', playwright: '1.61.1' },
    resources: localPaths.map((localPath) => ({
      localPath,
      originalUrl: 'https://example.com/style.css',
      contentType: 'text/css',
      bytes: 10,
      sha256: 'abc',
      via: 'network',
    })),
    remote: [],
  });
}

/** Every file the good fixture claims exists, exists. Override per-test to simulate a broken clone. */
function input(overrides: Partial<VerifyInput> = {}): VerifyInput {
  return {
    html: goodHtml(),
    manifestText: goodManifest(),
    overridesExists: true,
    resourceExists: () => true,
    ...overrides,
  };
}

function check(report: VerifyReport, id: VerifyCheckId): { ok: boolean; detail: string } | undefined {
  return report.checks.find((c) => c.id === id);
}

/** The ids that failed, for terse assertions about WHICH invariant broke. */
function failedIds(report: VerifyReport): VerifyCheckId[] {
  return report.checks.filter((c) => !c.ok).map((c) => c.id);
}

describe('verifyClone — a well-formed clone', () => {
  // why: the baseline. If a clone the pipeline itself produces cannot pass its own verifier, every
  // other test here is meaningless and the customize-clone loop can never reach exit 0.
  it('passes every invariant', () => {
    const report = verifyClone(input());
    expect(failedIds(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(9);
  });

  // why: the report is a machine contract (`--json`) and REPORT.md's `## Verify` body. A check that
  // silently disappears would shrink the "N invariants hold" claim without any test noticing.
  it('emits all nine checks in the documented order', () => {
    expect(verifyClone(input()).checks.map((c) => c.id)).toEqual([
      'index-exists',
      'index-parseable',
      'provenance-comment',
      'dl-id-unique',
      'overrides-exists',
      'overrides-linked-last',
      'inert',
      'manifest-parses',
      'manifest-localpaths',
    ]);
  });
});

describe('verifyClone — data-dl-id uniqueness', () => {
  // why: THE acceptance criterion of T21, and the invariant the whole addressing system rests on.
  // Duplicated ids mean `[data-dl-id="dl-2"]` addresses two elements and every agent edit is a
  // coin flip about which one it hits.
  it('fails when a data-dl-id is duplicated', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1">A</h1><p data-dl-id="dl-1">B</p>');
    const report = verifyClone(input({ html }));
    expect(report.ok).toBe(false);
    expect(failedIds(report)).toEqual(['dl-id-unique']);
    expect(check(report, 'dl-id-unique')?.detail).toContain('dl-1');
  });

  // why: guards a cheerio trap that would make this check silently blind. Stamps inside open shadow
  // roots are serialized into `<template shadowroot>`; a root-anchored `$('[data-dl-id]')` descends
  // into template content but `$('body').find(...)` does NOT. If someone "tidies" the selector by
  // scoping it to <body>, duplicate ids inside every shadow root stop being detected and this test
  // is the only thing that notices.
  it('sees stamps inside a serialized shadow root (<template shadowroot>)', () => {
    const html = goodHtml(
      '<h1 data-dl-id="dl-1">A</h1><my-el data-dl-id="dl-2">' +
        '<template shadowroot="open"><span data-dl-id="dl-1">shadowed</span></template></my-el>',
    );
    const report = verifyClone(input({ html }));
    expect(report.ok).toBe(false);
    expect(failedIds(report)).toEqual(['dl-id-unique']);
    expect(check(report, 'dl-id-unique')?.detail).toContain('dl-1');
  });

  // why: a clone with no duplicates must not be failed just because ids are non-contiguous — the
  // agent may delete elements (spec 06 forbids renumbering, not deletion), leaving gaps like dl-1,dl-7.
  it('accepts non-contiguous but unique ids', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1">A</h1><p data-dl-id="dl-7">B</p>');
    expect(verifyClone(input({ html })).ok).toBe(true);
  });
});

describe('verifyClone — provenance comment', () => {
  // why: line 1 is the clone's only self-identification and the ethics stamp spec 03 fixes verbatim.
  // A clone whose provenance was stripped is indistinguishable from scraped markup.
  it('fails when line 1 is not the provenance comment', () => {
    const html = goodHtml().replace(`${PROVENANCE}\n`, '');
    expect(failedIds(verifyClone(input({ html })))).toEqual(['provenance-comment']);
  });

  // why: the template is verbatim, not "something comment-shaped". A reworded stamp that still
  // mentions design-lens would otherwise pass and drift the on-disk contract.
  it('fails when the provenance wording drifts', () => {
    const html = goodHtml().replace('for private design study', 'for any use whatsoever');
    expect(failedIds(verifyClone(input({ html })))).toEqual(['provenance-comment']);
  });

  // why: the doctype must not precede the comment (spec 03: "Line 1 … before the doctype"). Checking
  // the parsed DOM instead of the raw first line would accept a comment anywhere in the document.
  it('fails when the provenance comment is not the first line', () => {
    const html = `<!DOCTYPE html>\n${PROVENANCE}\n<html><head></head><body><p data-dl-id="dl-1">x</p></body></html>`;
    expect(verifyClone(input({ html })).ok).toBe(false);
    expect(failedIds(verifyClone(input({ html })))).toContain('provenance-comment');
  });
});

describe('verifyClone — dl-overrides.css cascade position', () => {
  // why: the override sheet is the customize-clone skill's ONLY style surface. If it stops being the
  // last stylesheet-bearing element, appended rules quietly lose the cascade at equal specificity and
  // every customization "does nothing" for reasons no one can see in the markup.
  it('fails when a <style> block follows the overrides link', () => {
    const html = goodHtml().replace(
      '<link rel="stylesheet" href="assets/dl-overrides.css">',
      '<link rel="stylesheet" href="assets/dl-overrides.css">\n<style>.late{color:blue}</style>',
    );
    const report = verifyClone(input({ html }));
    expect(failedIds(report)).toEqual(['overrides-linked-last']);
    expect(check(report, 'overrides-linked-last')?.detail).toContain('style');
  });

  // why: a plain `<link rel=stylesheet>` after the overrides link breaks the cascade identically —
  // and is the shape a regression in `localize.ts`'s append order would actually produce.
  it('fails when another stylesheet link follows the overrides link', () => {
    const html = goodHtml().replace(
      '<link rel="stylesheet" href="assets/dl-overrides.css">',
      '<link rel="stylesheet" href="assets/dl-overrides.css">\n<link rel="stylesheet" href="assets/late.css">',
    );
    expect(failedIds(verifyClone(input({ html })))).toEqual(['overrides-linked-last']);
  });

  // why: `rel` is a token list. A non-stylesheet link (preload, icon) after the overrides link does
  // NOT affect the cascade, so failing on it would be a false alarm on a perfectly good clone.
  it('ignores non-stylesheet links that follow the overrides link', () => {
    const html = goodHtml().replace(
      '<link rel="stylesheet" href="assets/dl-overrides.css">',
      '<link rel="stylesheet" href="assets/dl-overrides.css">\n<link rel="icon" href="assets/favicon.ico">',
    );
    expect(verifyClone(input({ html })).ok).toBe(true);
  });

  // why: substring matching on `rel` would treat `stylesheet-alternate` as a stylesheet and report a
  // spurious cascade violation. Token-splitting is the rule browsers use.
  it('does not treat rel="stylesheet-alternate" as stylesheet-bearing', () => {
    const html = goodHtml().replace(
      '<link rel="stylesheet" href="assets/dl-overrides.css">',
      '<link rel="stylesheet" href="assets/dl-overrides.css">\n<link rel="stylesheet-alternate" href="assets/alt.css">',
    );
    expect(verifyClone(input({ html })).ok).toBe(true);
  });

  // why: the link can be missing entirely (a localize regression that never appends it). That must
  // read as "not linked", not crash on an empty stylesheet list.
  it('fails when the overrides sheet is never linked', () => {
    const html = goodHtml().replace('<link rel="stylesheet" href="assets/dl-overrides.css">\n', '');
    const report = verifyClone(input({ html }));
    expect(failedIds(report)).toEqual(['overrides-linked-last']);
    expect(check(report, 'overrides-linked-last')?.detail).toContain('no <link');
  });

  // why: linked but absent from disk is a broken clone — the browser 404s the sheet and every agent
  // override is dropped. Existence and cascade position are distinct failures with distinct fixes.
  it('fails when the overrides file is missing from disk', () => {
    const report = verifyClone(input({ overridesExists: false }));
    expect(failedIds(report)).toEqual(['overrides-exists']);
  });
});

describe('verifyClone — inertness', () => {
  // why: "a photograph, not a program" (ADR-001) is the product's central safety promise. A clone
  // that regained a <script> can beacon out or run the origin site's analytics on the user's machine.
  it('fails when a <script> element is present', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1">A</h1><script>alert(1)</script>');
    const report = verifyClone(input({ html }));
    expect(failedIds(report)).toEqual(['inert']);
    expect(check(report, 'inert')?.detail).toContain('<script>');
  });

  // why: an `on*` handler is script without a <script> tag. Same promise, different smuggling route.
  it('fails when an on* attribute is present', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1" onclick="steal()">A</h1>');
    const report = verifyClone(input({ html }));
    expect(failedIds(report)).toEqual(['inert']);
    expect(check(report, 'inert')?.detail).toContain('onclick');
  });

  // why: `on*` matching is case-insensitive in HTML (`onClick` runs). A case-sensitive check would
  // pass a clone that a browser happily executes.
  it('fails on a mixed-case ON* attribute', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1" OnMouseOver="x()">A</h1>');
    expect(failedIds(verifyClone(input({ html })))).toEqual(['inert']);
  });

  // why: a <script> hidden inside a serialized shadow root is still a <script> the browser runs when
  // the declarative template is adopted. Scoping the inertness scan to <body> would miss it.
  it('finds a <script> inside a <template shadowroot>', () => {
    const html = goodHtml(
      '<my-el data-dl-id="dl-1"><template shadowroot="open"><script>bad()</script></template></my-el>',
    );
    expect(failedIds(verifyClone(input({ html })))).toEqual(['inert']);
  });

  // why: `on`-PREFIXED is not the same as an event handler; a legit attribute like `once` or a data
  // attribute must never be flagged, or clones of ordinary sites fail verification forever.
  it('does not flag benign attributes that merely start with "on"', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1" data-online="yes"><span data-dl-id="dl-2">A</span></h1>');
    expect(verifyClone(input({ html })).ok).toBe(true);
  });
});

describe('verifyClone — index.html presence and shape', () => {
  // why: with no index.html there is no clone. Every document-shaped check must be OMITTED rather
  // than reported as passing — a report claiming `inert: ok` for a file that does not exist is a lie
  // a `--json` consumer would act on.
  it('omits the document checks when index.html is missing', () => {
    const report = verifyClone(input({ html: null }));
    expect(report.ok).toBe(false);
    expect(check(report, 'index-exists')?.ok).toBe(false);
    for (const id of ['index-parseable', 'dl-id-unique', 'inert', 'overrides-linked-last'] as const) {
      expect(check(report, id)).toBeUndefined();
    }
    // The manifest is independent of index.html, so it is still checked.
    expect(check(report, 'manifest-parses')?.ok).toBe(true);
  });

  // why: parse5 never rejects a byte string — an empty file "parses" into a synthesized html/head/
  // body. Without the non-empty-<body> clause, a zero-byte index.html would pass `index-parseable`,
  // `dl-id-unique` (zero ids are trivially unique) and `inert` (no scripts) — a 3-check false PASS.
  it('fails an empty index.html rather than vacuously passing', () => {
    const report = verifyClone(input({ html: '' }));
    expect(report.ok).toBe(false);
    expect(check(report, 'index-parseable')?.ok).toBe(false);
    expect(check(report, 'index-parseable')?.detail).toContain('<body> has no child elements');
  });
});

describe('verifyClone — manifest', () => {
  // why: a corrupt manifest is undetectable from the clone alone, and every downstream command
  // (`tokens`, the skills) reads it. The parse error must be reported, not thrown.
  it('fails, without throwing, when the manifest is not JSON', () => {
    const report = verifyClone(input({ manifestText: '{not json' }));
    expect(failedIds(report)).toEqual(['manifest-parses']);
    expect(check(report, 'manifest-parses')?.detail).toContain('does not parse');
    // A manifest that cannot parse has no resources[] to resolve — the dependent check is omitted.
    expect(check(report, 'manifest-localpaths')).toBeUndefined();
  });

  // why: valid JSON that is not a manifest (e.g. `[]`, or an object with no resources) must fail
  // rather than crash on `.resources.entries()`.
  it('fails when the manifest has no resources[] array', () => {
    expect(failedIds(verifyClone(input({ manifestText: '{"version":1}' })))).toEqual(['manifest-parses']);
  });

  // why: this is the check that catches a clone whose assets were never written (or were deleted).
  // The manifest would still parse and the HTML would still reference `assets/…` — only disk knows.
  it('fails when a manifest resource is missing on disk', () => {
    const report = verifyClone(input({ resourceExists: () => false }));
    expect(failedIds(report)).toEqual(['manifest-localpaths']);
    expect(check(report, 'manifest-localpaths')?.detail).toContain('missing on disk');
  });

  // why: manifest.json is a plain file a user can hand-edit. A `..` localPath must be REJECTED, not
  // resolved — otherwise `verify` happily confirms that `../../../../etc/passwd` "exists", and the
  // check becomes an arbitrary-path probe instead of a containment guarantee.
  it('rejects a localPath that escapes the project dir instead of resolving it', () => {
    const manifestText = goodManifest(['../../../../etc/passwd']);
    // `resourceExists` says yes to everything: only the pure containment rule can catch this.
    const report = verifyClone(input({ manifestText, resourceExists: () => true }));
    expect(failedIds(report)).toEqual(['manifest-localpaths']);
    expect(check(report, 'manifest-localpaths')?.detail).toContain('escapes the project dir');
  });

  // why: an absolute localPath escapes the project dir just as effectively as `..`, on both POSIX
  // and Windows, and `path.join(root, '/etc/passwd')` would quietly resolve it back inside root.
  it('rejects an absolute localPath', () => {
    const report = verifyClone(input({ manifestText: goodManifest(['/etc/passwd']) }));
    expect(failedIds(report)).toEqual(['manifest-localpaths']);
    expect(check(report, 'manifest-localpaths')?.detail).toContain('is absolute');
  });

  // why: a resource entry missing `localPath` entirely (or holding a number) must be a finding, not
  // a TypeError inside the verifier.
  it('reports a non-string localPath as unusable', () => {
    const manifestText = JSON.stringify({ resources: [{ localPath: 42 }] });
    const report = verifyClone(input({ manifestText }));
    expect(failedIds(report)).toEqual(['manifest-localpaths']);
    expect(check(report, 'manifest-localpaths')?.detail).toContain('not a non-empty string');
  });

  // why: a clone of a page with zero localizable assets is legal (inline CSS only). An empty
  // resources[] must pass, not trip the "all localPaths resolve" check on a vacuous truth bug.
  it('passes a manifest with no resources', () => {
    expect(verifyClone(input({ manifestText: goodManifest([]) })).ok).toBe(true);
  });
});

describe('verifyClone — ADR-002 agent edits must not fail verification', () => {
  // why: spec 06 §Verification loop makes exit 0 the gate the customize-clone skill must clear after
  // EVERY batch of edits. If a legal edit fails verify, the skill's only instruction is to "fix or
  // revert" — it would revert the user's work forever. This test pins the three legal edit shapes.
  it('passes after appended override rules, an edited text node, and a custom asset', () => {
    // The agent edited the <h1>'s text and pointed an <img> at a new file under assets/custom/.
    const html = goodHtml(
      '<h1 data-dl-id="dl-1">Our Brand Now</h1>' +
        '<img data-dl-id="dl-2" src="assets/custom/logo.svg" alt="logo">',
    );
    const report = verifyClone(
      input({
        html,
        // dl-overrides.css is now NON-EMPTY (rules appended). Emptiness is a clone-time property,
        // never a verify-time one — checking it would forbid the only edit surface the skill has.
        overridesExists: true,
        // assets/custom/logo.svg is deliberately NOT in the manifest: only captured resources are.
        resourceExists: (localPath) => localPath === 'clone/assets/example-com/style.css',
      }),
    );
    expect(failedIds(report)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('summarizeVerify — the REPORT.md `## Verify` body', () => {
  // why: REPORT.md's `## Verify` section is one of six headings the gate and every reader anchor on.
  // A pass must read as a pass; the count is what tells a reader the check actually ran.
  it('renders a PASS line naming the number of invariants', () => {
    expect(summarizeVerify(verifyClone(input()))).toBe('PASS — all 9 clone-format invariants hold.');
  });

  // why: at clone time findings are warnings, not fatal (spec 02 §M3) — so the summary says WARN and
  // must ENUMERATE what failed. A bare "WARN" would leave the user nothing to act on.
  it('renders WARN and enumerates each failed check', () => {
    const html = goodHtml('<h1 data-dl-id="dl-1">A</h1><p data-dl-id="dl-1">B</p><script>x()</script>');
    const summary = summarizeVerify(verifyClone(input({ html })));
    expect(summary).toContain('WARN — 2 of 9 clone-format invariants failed:');
    expect(summary).toContain('- dl-id-unique:');
    expect(summary).toContain('- inert:');
  });
});
