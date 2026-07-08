/**
 * The `verify <projectDir>` command — the clone-format integrity check.
 *
 * Nine invariants from specs/03-clone-format.md §Agent-owned files: `clone/index.html` exists and
 * is parseable, its line 1 is the provenance comment, every `data-dl-id` is unique,
 * `dl-overrides.css` exists and is linked LAST in `<head>`, `manifest.json` parses and every
 * `resources[].localPath` resolves on disk, and the document is inert (no `<script>`, no `on*`).
 *
 * The routine is split into a PURE core ({@link verifyClone}, which takes the two documents as
 * strings plus injected existence predicates) and a thin filesystem shell ({@link runVerify}). Two
 * callers need it and only one of them has the files on disk: `clone` runs it at the end of a
 * capture, where `manifest.json` has not been written yet (it is rendered LAST, because REPORT.md
 * embeds this very summary under its `## Verify` heading). Passing the manifest TEXT rather than a
 * path is what lets both callers share one implementation — and it means the command parses exactly
 * the bytes the clone pipeline is about to write.
 *
 * What verify must NOT reject: the customize-clone skill's edits (ADR-002) — appended
 * `[data-dl-id]` rules in `dl-overrides.css` (so emptiness is never checked, only existence),
 * edited text nodes, and new files under `assets/custom/` (so no "every file is in the manifest"
 * check). `DESIGN.md`/`VARIATIONS.md` are agent-owned and their absence is not a finding.
 *
 * Exit semantics differ by caller, deliberately: a failed invariant is FATAL for the command
 * (exit 1 — spec 06's verification loop demands the agent fix or revert on a non-zero exit), but a
 * WARNING at the end of `clone` (spec 02 §M3: "also run at the end of clone as warnings, not
 * fatal"), where a good clone must never be thrown away over a cosmetic finding.
 *
 * I/O discipline (guardrails / spec 00): the human check-by-check summary → stderr; the JSON report
 * → stdout only under `--json`.
 *
 * Spec: specs/00-product.md §Interfaces; specs/03-clone-format.md §Agent-owned files;
 *   specs/02-clone-engine.md §M3 polish (command surface: `verify <projectDir>` `--json`).
 */

import fs from 'node:fs';
import path from 'node:path';

import * as cheerio from 'cheerio';
import type { Command } from 'commander';

import { OVERRIDES_LOCAL_PATH } from '../analyze/css-sources.js';
import { OVERRIDES_HREF } from '../localize/localize.js';
import { PROVENANCE_LINE } from '../output/provenance.js';

/** The cheerio document API, named without importing a second cheerio export (tsup aliases the package). */
type CheerioDocument = ReturnType<typeof cheerio.load>;

/**
 * Every invariant this command can report, in the order it emits them. A check is ABSENT from the
 * report when its precondition failed (e.g. nothing document-shaped is reported when
 * `clone/index.html` is missing) — never present-but-passing, which would claim an unrun check held.
 */
export const VERIFY_CHECK_IDS = [
  // Document checks (need a parsed `clone/index.html`) …
  'index-exists',
  'index-parseable',
  'provenance-comment',
  'dl-id-unique',
  'overrides-exists',
  'overrides-linked-last',
  'inert',
  // … then the manifest checks, which stand on their own.
  'manifest-parses',
  'manifest-localpaths',
] as const;

export type VerifyCheckId = (typeof VERIFY_CHECK_IDS)[number];

/** One invariant's verdict. `detail` is human-facing on both branches, so a PASS explains itself. */
export interface VerifyCheck {
  id: VerifyCheckId;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  /** True only when every emitted check passed. */
  ok: boolean;
  checks: VerifyCheck[];
}

export interface VerifyInput {
  /** `clone/index.html` bytes, or null when the file is absent. */
  html: string | null;
  /** `manifest.json` bytes, or null when the file is absent. */
  manifestText: string | null;
  /** Whether `clone/assets/dl-overrides.css` exists as a file. */
  overridesExists: boolean;
  /** Does this project-dir-relative path resolve to a file? (Injected: keeps the core pure.) */
  resourceExists: (localPath: string) => boolean;
}

/** Never let a detail line grow unbounded: a clone with 4000 broken assets must stay readable. */
const MAX_LISTED = 5;

/** Render `items` as a comma-joined list, truncated with a count of the remainder. */
function listSome(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(', ');
  return items.length > MAX_LISTED ? `${shown} (+${items.length - MAX_LISTED} more)` : shown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True for an element that participates in the cascade: a `<style>` block, or a `<link>` whose `rel`
 * carries the `stylesheet` token. `rel` is a space-separated token list, so substring matching would
 * wrongly accept `rel="stylesheet-alternate"`.
 */
function isStylesheetBearing(el: { name: string; attribs: Record<string, string> }): boolean {
  if (el.name === 'style') return true;
  if (el.name !== 'link') return false;
  return (el.attribs.rel ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .includes('stylesheet');
}

/**
 * Collect every `data-dl-id` in the document, INCLUDING the stamps inside serialized open shadow
 * roots (spec 03 requires those to be unique too).
 *
 * The root-anchored selector is load-bearing and not interchangeable with a scoped one: cheerio's
 * htmlparser2 tree adapter keeps `<template>` content as ordinary children, and `$('[data-dl-id]')`
 * descends into it — but `$('body').find('[data-dl-id]')` does NOT, and would silently skip every
 * shadow-root stamp. `capture/stamp.ts` stamps into open shadow roots and @percy/dom serializes them
 * as `<template shadowroot>`, so scoping to `<body>` would make duplicate ids there invisible.
 */
function collectDlIds($: CheerioDocument): string[] {
  const ids: string[] = [];
  $('[data-dl-id]').each((_, el) => {
    if (!('attribs' in el)) return;
    const id = el.attribs['data-dl-id'];
    if (id !== undefined) ids.push(id);
  });
  return ids;
}

/**
 * Every executable hook still in the document. Mirrors `localize/html-rewrite.ts`'s sanitize rules
 * exactly (same selectors, same `/^on/i` attribute test) so the pass that strips them and the check
 * that looks for them can never disagree about what "inert" means.
 *
 * `javascript:` URLs are sanitized but deliberately NOT checked here: spec 03's verify list is
 * "no `<script>`/`on*` in the HTML", and an agent editing a text node cannot reintroduce a scheme.
 */
function inertOffenders($: CheerioDocument): string[] {
  const offenders: string[] = [];
  const scripts = $('script').length;
  if (scripts > 0) offenders.push(`${scripts} <script> element(s)`);

  const handlers: string[] = [];
  $('*').each((_, el) => {
    if (!('attribs' in el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (/^on/i.test(name)) handlers.push(`${el.name}[${name}]`);
    }
  });
  if (handlers.length > 0) offenders.push(`${handlers.length} on* attribute(s): ${listSome(handlers)}`);
  return offenders;
}

/**
 * Why a `localPath` is unusable, or null when it is well-formed. A manifest is a plain JSON file a
 * user could hand-edit, so a `../../etc/passwd` entry must be REJECTED rather than resolved and
 * happily reported as "exists" — the check is "resolves inside the project dir", not "exists".
 */
function localPathProblem(value: unknown, index: number): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `resources[${index}].localPath is not a non-empty string`;
  }
  if (path.isAbsolute(value)) return `${value} is absolute`;
  if (value.split(/[\\/]/).includes('..')) return `${value} escapes the project dir`;
  return null;
}

/** Append the document-shaped checks (everything that needs a parsed `clone/index.html`). */
function checkDocument($: CheerioDocument, input: VerifyInput, checks: VerifyCheck[]): void {
  const ids = collectDlIds($);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicated.add(id);
    else seen.add(id);
  }
  checks.push(
    duplicated.size === 0
      ? { id: 'dl-id-unique', ok: true, detail: `${ids.length} data-dl-id value(s), all unique` }
      : {
          id: 'dl-id-unique',
          ok: false,
          detail: `${duplicated.size} duplicated data-dl-id value(s): ${listSome([...duplicated])}`,
        },
  );

  checks.push({
    id: 'overrides-exists',
    ok: input.overridesExists,
    detail: input.overridesExists ? `${OVERRIDES_LOCAL_PATH} is present` : `${OVERRIDES_LOCAL_PATH} is missing`,
  });

  const sheets = $('head')
    .find('link, style')
    .toArray()
    .filter((el) => isStylesheetBearing(el));
  const last = sheets.at(-1);
  const isOverrides = (el: { name: string; attribs: Record<string, string> }): boolean =>
    el.name === 'link' && el.attribs.href === OVERRIDES_HREF;

  if (last !== undefined && isOverrides(last)) {
    checks.push({
      id: 'overrides-linked-last',
      ok: true,
      detail: `${OVERRIDES_HREF} is the last of ${sheets.length} stylesheet-bearing element(s) in <head>`,
    });
  } else if (!sheets.some((el) => isOverrides(el))) {
    checks.push({
      id: 'overrides-linked-last',
      ok: false,
      detail: `no <link rel="stylesheet" href="${OVERRIDES_HREF}"> in <head>`,
    });
  } else {
    const after = sheets.slice(sheets.findIndex(isOverrides) + 1).map((el) => el.name);
    checks.push({
      id: 'overrides-linked-last',
      ok: false,
      detail: `${OVERRIDES_HREF} is followed in <head> by ${after.length} stylesheet-bearing element(s): ${listSome(after)}`,
    });
  }

  const offenders = inertOffenders($);
  checks.push(
    offenders.length === 0
      ? { id: 'inert', ok: true, detail: 'no <script> elements and no on* attributes' }
      : { id: 'inert', ok: false, detail: `document is not inert: ${offenders.join('; ')}` },
  );
}

/** Append the two manifest checks. `manifest-localpaths` is skipped when the manifest did not parse. */
function checkManifest(input: VerifyInput, checks: VerifyCheck[]): void {
  if (input.manifestText === null) {
    checks.push({ id: 'manifest-parses', ok: false, detail: 'manifest.json is missing' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.manifestText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push({ id: 'manifest-parses', ok: false, detail: `manifest.json does not parse: ${detail}` });
    return;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.resources)) {
    checks.push({ id: 'manifest-parses', ok: false, detail: 'manifest.json has no resources[] array' });
    return;
  }

  const resources = parsed.resources;
  checks.push({
    id: 'manifest-parses',
    ok: true,
    detail: `manifest.json parses with ${resources.length} resource(s)`,
  });

  const problems: string[] = [];
  for (const [index, resource] of resources.entries()) {
    const localPath: unknown = isRecord(resource) ? resource.localPath : undefined;
    const problem = localPathProblem(localPath, index);
    if (problem !== null) {
      problems.push(problem);
      continue;
    }
    // Narrowed by `localPathProblem`: a null verdict guarantees a non-empty, contained string.
    if (!input.resourceExists(localPath as string)) problems.push(`${localPath as string} is missing on disk`);
  }

  checks.push(
    problems.length === 0
      ? {
          id: 'manifest-localpaths',
          ok: true,
          detail: `all ${resources.length} resources[].localPath resolve under the project dir`,
        }
      : {
          id: 'manifest-localpaths',
          ok: false,
          detail: `${problems.length} unusable resources[].localPath: ${listSome(problems)}`,
        },
  );
}

/**
 * Check a clone against the on-disk format contract. PURE: no filesystem, no network, no browser —
 * every fact about the world arrives through {@link VerifyInput}.
 */
export function verifyClone(input: VerifyInput): VerifyReport {
  const checks: VerifyCheck[] = [];

  if (input.html === null) {
    checks.push({ id: 'index-exists', ok: false, detail: 'clone/index.html is missing' });
    checkManifest(input, checks);
    return { ok: false, checks };
  }
  checks.push({ id: 'index-exists', ok: true, detail: 'clone/index.html is present' });

  const firstLine = input.html.split('\n', 1)[0]?.trimEnd() ?? '';

  let $: CheerioDocument | undefined;
  try {
    $ = cheerio.load(input.html);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push({ id: 'index-parseable', ok: false, detail: `clone/index.html does not parse: ${detail}` });
  }

  if ($ !== undefined) {
    // parse5 never rejects a byte string — an empty or truncated file "parses" into a synthesized
    // html/head/body. So parseability means the document has the shape a clone must have: exactly
    // one <html>/<head>/<body>, and a <body> that actually carries elements. Without the last
    // clause a zero-byte index.html would sail through every check below it.
    const structure: string[] = [];
    for (const tag of ['html', 'head', 'body'] as const) {
      const count = $(tag).length;
      if (count !== 1) structure.push(`${count} <${tag}> element(s)`);
    }
    if ($('body').children().length === 0) structure.push('<body> has no child elements');
    checks.push(
      structure.length === 0
        ? { id: 'index-parseable', ok: true, detail: 'clone/index.html parses into a well-formed document' }
        : { id: 'index-parseable', ok: false, detail: `malformed document: ${structure.join('; ')}` },
    );
  }

  checks.push(
    PROVENANCE_LINE.test(firstLine)
      ? { id: 'provenance-comment', ok: true, detail: 'line 1 is the provenance comment' }
      : {
          id: 'provenance-comment',
          ok: false,
          detail: 'line 1 of clone/index.html is not the design-lens provenance comment',
        },
  );

  if ($ !== undefined) checkDocument($, input, checks);
  checkManifest(input, checks);

  return { ok: checks.every((check) => check.ok), checks };
}

/**
 * The free-text summary REPORT.md renders under `## Verify` (spec 03 §REPORT.md template). "WARN"
 * rather than "FAIL" because at clone time these findings are warnings, not fatal (spec 02 §M3).
 */
export function summarizeVerify(report: VerifyReport): string {
  const failed = report.checks.filter((check) => !check.ok);
  if (failed.length === 0) {
    return `PASS — all ${report.checks.length} clone-format invariants hold.`;
  }
  return [
    `WARN — ${failed.length} of ${report.checks.length} clone-format invariants failed:`,
    ...failed.map((check) => `- ${check.id}: ${check.detail}`),
  ].join('\n');
}

/** True only for a real file; a directory at a resource path is as broken as a missing one. */
function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export interface VerifyResult {
  /** Absolute project dir that was checked. */
  projectDir: string;
  report: VerifyReport;
  /** The exact bytes `--json` writes to stdout, trailing newline included. */
  json: string;
}

/**
 * Read a clone project from disk and check it. Throws (⇒ exit 1 with an `error:` line) only when
 * `projectDir` is not a directory at all; a project that exists but violates an invariant is a
 * REPORT with `ok: false`, so `--json` still describes exactly what is wrong.
 */
export function runVerify(projectDir: string): VerifyResult {
  const root = path.resolve(projectDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }

  const indexPath = path.join(root, 'clone', 'index.html');
  const manifestPath = path.join(root, 'manifest.json');

  const report = verifyClone({
    html: isFile(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null,
    manifestText: isFile(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null,
    overridesExists: isFile(path.join(root, OVERRIDES_LOCAL_PATH)),
    resourceExists: (localPath) => isFile(path.join(root, localPath)),
  });

  process.stderr.write(`design-lens: verifying ${root}\n`);
  for (const check of report.checks) {
    process.stderr.write(`design-lens:   ${check.ok ? 'PASS' : 'FAIL'} ${check.id} — ${check.detail}\n`);
  }
  const failed = report.checks.filter((check) => !check.ok).length;
  process.stderr.write(
    report.ok
      ? `design-lens: verify passed (${report.checks.length} check(s))\n`
      : `design-lens: verify FAILED (${failed} of ${report.checks.length} check(s))\n`,
  );

  return { projectDir: root, report, json: `${JSON.stringify(report)}\n` };
}

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .argument('<projectDir>', 'a clone project directory, e.g. .design-lens/example-com')
    .description("Check a clone against the clone-format invariants; exit 1 if any is violated.")
    .option('--json', 'print the verify report as JSON to stdout')
    .action((projectDir: string, options: { json?: boolean }): void => {
      try {
        const result = runVerify(projectDir);
        if (options.json === true) process.stdout.write(result.json);
        // A violated invariant is a failed run, not a thrown error: no `error:` line, just exit 1.
        if (!result.report.ok) process.exitCode = 1;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${detail}\n`);
        process.exitCode = 1;
      }
    });
}
