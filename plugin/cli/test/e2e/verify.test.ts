/**
 * `verify <projectDir>` e2e: clone the `basic` fixture with the BUILT bundle, then verify the
 * on-disk clone.
 *
 * WHY this exists: the unit suite proves every invariant against HAND-WRITTEN html/manifest strings.
 * Only here do we prove the two things those strings cannot: that a clone the REAL pipeline wrote —
 * percy-serialized, sanitized, localized, beautified, provenance-stamped — satisfies its own
 * verifier, and that a violation actually drives the process exit code to 1 through commander.
 *
 * A clone that cannot pass `verify` is unusable: spec 06's customize loop makes exit 0 the gate the
 * agent must clear after every batch of edits. If `output/beautify.ts` reflowed the provenance
 * comment off line 1, if `localize.ts` stopped appending `dl-overrides.css` last, or if the percy
 * serializer started emitting a `<script>`, every unit test here would stay green and only this
 * fails. Conversely the "agent edits" case pins the other direction — that the three legal edits of
 * ADR-002 keep exiting 0 — because a verifier that rejects legal edits is worse than none.
 *
 * Tests only ever touch 127.0.0.1 fixtures on ephemeral ports (never 4630/4631, never the live web).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

/** The committed artifact under test — NOT the TS source (spec 08: e2e drives the built bundle). */
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const SITES = fileURLToPath(new URL('../fixtures/sites', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** See clone.test.ts: consent blocking is ON by default, so every run gets a seeded throwaway home. */
const SEEDED_DEFAULT_LIST = '! design-lens e2e stand-in list\n###dl-e2e-remote-list-matches-nothing\n';

function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-home-'));
  const cacheDir = path.join(home, 'cache', 'filterlists');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'fanboy-cookiemonster.txt'), SEEDED_DEFAULT_LIST, 'utf8');
  return home;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], {
      cwd,
      env: { ...process.env, DESIGN_LENS_HOME: tmpHome() },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dl-e2e-'));
}

interface VerifyCheck {
  id: string;
  ok: boolean;
  detail: string;
}

interface VerifyReport {
  ok: boolean;
  checks: VerifyCheck[];
}

/** Ids of the checks that failed — the terse "what broke" witness. */
function failedIds(report: VerifyReport): string[] {
  return report.checks.filter((check) => !check.ok).map((check) => check.id);
}

/**
 * Copy the pristine clone so a destructive test cannot poison the ones after it. `cpSync` preserves
 * the exact bytes, so the copy passes `verify` before the mutation and only the mutation can fail it.
 */
function corruptedCopy(projectDir: string, mutate: (indexHtml: string) => string): string {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-corrupt-'));
  const dest = path.join(copy, 'project');
  fs.cpSync(projectDir, dest, { recursive: true });
  const indexPath = path.join(dest, 'clone', 'index.html');
  fs.writeFileSync(indexPath, mutate(fs.readFileSync(indexPath, 'utf8')), 'utf8');
  return dest;
}

describe('verify on a basic clone', () => {
  let server: StaticServer;
  let out: string;
  let projectDir: string;
  const scratch: string[] = [];

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    const cloned = await runCli(
      ['clone', server.url('/index.html'), '--out', out, '--project', 'basic'],
      out,
    );
    expect(cloned.code, `clone failed: ${cloned.stderr}`).toBe(0);
    projectDir = (JSON.parse(cloned.stdout.trim()) as { projectDir: string }).projectDir;
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
    for (const dir of scratch) fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  // why: the headline AC of T21 — a clone the pipeline just wrote must verify clean. This is the
  // single assertion the customize-clone skill's entire edit loop depends on being reachable.
  it('exits 0 on a good clone', async () => {
    const result = await runCli(['verify', projectDir], out);
    expect(result.code, `verify failed: ${result.stderr}`).toBe(0);
  });

  // why: the human summary belongs on stderr and nothing may reach stdout without `--json` (the CLI
  // I/O contract every skill and the sealed gate rely on). A stray progress line on stdout would
  // break any caller that pipes `--json` into a parser.
  it('prints the check summary to stderr and nothing to stdout without --json', async () => {
    const result = await runCli(['verify', projectDir], out);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('verify passed');
    expect(result.stderr).toContain('PASS dl-id-unique');
  });

  // why: `--json` is the machine surface. It must be parseable, land on stdout, and report every
  // invariant — a report that silently dropped checks would let a regression hide behind `ok: true`.
  it('--json prints a parseable passing report on stdout', async () => {
    const result = await runCli(['verify', projectDir, '--json'], out);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as VerifyReport;
    expect(report.ok).toBe(true);
    expect(failedIds(report)).toEqual([]);
    expect(report.checks).toHaveLength(9);
  });

  // why: THE acceptance criterion — "verify exits 1 on a clone with a duplicated data-dl-id". This is
  // the only test that proves a finding actually reaches `process.exitCode` rather than being printed
  // and forgotten; the skill's loop reads the exit code, not the text.
  it('exits 1 on a clone with a duplicated data-dl-id', async () => {
    const broken = corruptedCopy(projectDir, (html) =>
      // Give the SECOND stamped element the first one's id. Both ids exist in every clone of `basic`.
      html.replace('data-dl-id="dl-2"', 'data-dl-id="dl-1"'),
    );
    scratch.push(broken);

    const result = await runCli(['verify', broken, '--json'], out);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout) as VerifyReport;
    expect(report.ok).toBe(false);
    expect(failedIds(report)).toEqual(['dl-id-unique']);
    expect(result.stderr).toContain('verify FAILED');
    // A violated invariant is a failed run, not a crash: no `error:` line, and the report still prints.
    expect(result.stderr).not.toContain('error:');
  });

  // why: inertness is the product's central safety promise ("a photograph, not a program"). If a
  // `<script>` were reintroduced into a clone — by a serializer regression or a careless edit —
  // verify must catch it on the REAL document, not just on the unit suite's synthetic strings.
  it('exits 1 on a clone with a reintroduced <script>', async () => {
    const broken = corruptedCopy(projectDir, (html) => html.replace('</body>', '<script>alert(1)</script></body>'));
    scratch.push(broken);

    const result = await runCli(['verify', broken, '--json'], out);
    expect(result.code).toBe(1);
    expect(failedIds(JSON.parse(result.stdout) as VerifyReport)).toEqual(['inert']);
  });

  // why: `dl-overrides.css` must stay LAST in the cascade or every appended override silently loses
  // to the clone's own stylesheets. This is the first code in the repo that enforces it, and it can
  // only be proved against a real `<head>` that the localize pass actually built.
  it('exits 1 when a stylesheet is linked after dl-overrides.css', async () => {
    const broken = corruptedCopy(projectDir, (html) =>
      html.replace('</head>', '<style>.late{color:red}</style></head>'),
    );
    scratch.push(broken);

    const result = await runCli(['verify', broken, '--json'], out);
    expect(result.code).toBe(1);
    expect(failedIds(JSON.parse(result.stdout) as VerifyReport)).toEqual(['overrides-linked-last']);
  });

  // why: spec 06 §Verification loop — after appending `[data-dl-id]` rules to dl-overrides.css, editing
  // a text node, and adding a file under assets/custom/, verify MUST still exit 0. A verifier that
  // rejects the only edits the customize-clone skill is allowed to make would make the skill unusable
  // (its instruction on failure is "fix or revert"), so this direction matters as much as the failures.
  it('still exits 0 after the legal ADR-002 agent edits', async () => {
    const edited = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-edited-'));
    const dest = path.join(edited, 'project');
    fs.cpSync(projectDir, dest, { recursive: true });
    scratch.push(dest);

    // 1. Append override rules to the (previously empty) override sheet.
    const overrides = path.join(dest, 'clone', 'assets', 'dl-overrides.css');
    fs.appendFileSync(overrides, '[data-dl-id="dl-1"] { color: rebeccapurple; }\n', 'utf8');
    expect(fs.statSync(overrides).size).toBeGreaterThan(0);

    // 2. Edit a text node, addressed the only way the skill may address anything: by data-dl-id.
    const indexPath = path.join(dest, 'clone', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const edit = html.replace(/(<h1[^>]*data-dl-id="[^"]+"[^>]*>)[^<]*/, '$1Our Brand Now');
    expect(edit, 'the basic clone must contain a stamped <h1> to edit').not.toBe(html);
    fs.writeFileSync(indexPath, edit, 'utf8');

    // 3. Add a user-supplied asset under assets/custom/ — never listed in the manifest.
    const custom = path.join(dest, 'clone', 'assets', 'custom');
    fs.mkdirSync(custom, { recursive: true });
    fs.writeFileSync(path.join(custom, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');

    const result = await runCli(['verify', dest, '--json'], out);
    expect(result.code, `verify rejected a legal agent edit: ${result.stderr}`).toBe(0);
    expect((JSON.parse(result.stdout) as VerifyReport).ok).toBe(true);
  });

  // why: `verify` runs at the end of every clone and its summary is REPORT.md's `## Verify` body
  // (spec 03's six-heading contract). A clone that reported its own invariants as broken — or wrote
  // the old "not run during clone" placeholder — would mean the pipeline and the verifier disagree.
  it('records a PASS summary under REPORT.md `## Verify` at clone time', () => {
    const report = fs.readFileSync(path.join(projectDir, 'REPORT.md'), 'utf8');
    expect(report).toContain('## Verify\nPASS — all 9 clone-format invariants hold.');
  });

  // why: a directory that is not a clone at all is an operator error, not a finding: it must produce
  // the `error:` line + exit 1 that the CLI contract promises, and never a report claiming `ok`.
  it('exits 1 with an error line when the target is not a directory', async () => {
    const result = await runCli(['verify', path.join(out, 'no-such-project')], out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('error:');
    expect(result.stdout).toBe('');
  });

  // why: ADR-002 forbids persistent state; `verify` is a read-only check and must never write into
  // the project (a `.verify-cache`, a rewritten manifest). Any write would also break the ratchet's
  // promise that a clone's bytes are the clone's bytes.
  it('writes nothing into the project dir', async () => {
    const before = fs.readdirSync(projectDir, { recursive: true }).map(String).sort();
    await runCli(['verify', projectDir, '--json'], out);
    expect(fs.readdirSync(projectDir, { recursive: true }).map(String).sort()).toEqual(before);
  });
});
