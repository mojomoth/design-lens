/**
 * Run log e2e: the BUILT bundle appends one JSON line per command to `<…>/.design-lens/RUNLOG.jsonl`
 * and `runlog <dir>` marks phases and summarizes them.
 *
 * WHY this exists: the record is written from a process `exit` listener, which only a real process
 * exercises. These tests prove what a unit test cannot: exactly one line per command (including
 * `serve`, whose action resolves only after a signal), the real exit code, clone's last stderr line
 * still being the ethics notice, project trees left byte-identical, the `off` opt-out, the absolute
 * override, and that projects outside any `.design-lens` (e.g. a bare mkdtemp in the shared $TMPDIR)
 * produce no log at all.
 *
 * Every spawn builds its env with DESIGN_LENS_RUNLOG and DESIGN_LENS_AGENT explicitly set or removed,
 * so a developer's own run-log settings never leak into the assertions. 127.0.0.1 fixtures only.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashTree } from '../../src/capture/evidence.js';
import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';
import type { CommandRecord, MarkRecord, RunLogRecord } from '../../src/lib/runlog.js';
import type { RunLogSummary } from '../../src/commands/runlog.js';
import { VERSION } from '../../src/version.js';

const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const SITES = fileURLToPath(new URL('../fixtures/sites', import.meta.url));
const NOTICE =
  'Note: this clone is for private design study only — see REPORT.md "License & usage notice" before shipping anything derived.';

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RunLogEnvChoice {
  /** Value for DESIGN_LENS_RUNLOG; undefined removes it. */
  runlog?: string;
  /** Value for DESIGN_LENS_AGENT; undefined removes it. */
  agent?: string;
}

const SEEDED_DEFAULT_LIST = '! design-lens e2e stand-in list\n###dl-e2e-remote-list-matches-nothing\n';
const homes: string[] = [];

/** See clone.test.ts: consent blocking is ON by default, so every run gets a seeded throwaway home. */
function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-home-'));
  homes.push(home);
  const cacheDir = path.join(home, 'cache', 'filterlists');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'fanboy-cookiemonster.txt'), SEEDED_DEFAULT_LIST, 'utf8');
  return home;
}

function cliEnv(choice: RunLogEnvChoice): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DESIGN_LENS_HOME: tmpHome() };
  delete env.DESIGN_LENS_RUNLOG;
  delete env.DESIGN_LENS_AGENT;
  if (choice.runlog !== undefined) env.DESIGN_LENS_RUNLOG = choice.runlog;
  if (choice.agent !== undefined) env.DESIGN_LENS_AGENT = choice.agent;
  return env;
}

function runCli(args: string[], cwd: string, choice: RunLogEnvChoice = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], { cwd, env: cliEnv(choice) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function readRecords(file: string): RunLogRecord[] {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  expect(text === '' || text.endsWith('\n'), 'every record is a complete line').toBe(true);
  return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as RunLogRecord);
}

function commandRecords(file: string): CommandRecord[] {
  return readRecords(file).filter((record): record is CommandRecord => record.kind === 'command');
}

function filesNamed(dir: string, name: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[]).filter((entry) => path.basename(entry) === name);
}

describe('run log through the built bundle', () => {
  let server: StaticServer;
  let root: string;
  let designLens: string;
  let log: string;
  let projectDir: string;
  let bare: string;
  let clone: CliResult;

  beforeAll(async () => {
    server = await startStaticServer(path.join(SITES, 'basic'));
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-runlog-e2e-')));
    designLens = path.join(root, '.design-lens');
    log = path.join(designLens, 'RUNLOG.jsonl');
    bare = path.join(root, 'bare');
    fs.mkdirSync(bare);
    // Default `--out ./.design-lens`: the out root does not exist before the action creates it.
    clone = await runCli(['clone', server.url('/index.html'), '--project', 'basic'], root, { agent: 'e2e-cloner' });
    expect(clone.code, `clone failed: ${clone.stderr}`).toBe(0);
    projectDir = (JSON.parse(clone.stdout.trim()) as { projectDir: string }).projectDir;
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
    for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
  });

  // why: the nested `<root>/.design-lens/<project>` layout is the one every skill uses; the clone
  // record must land beside the project (never inside it, never in $TMPDIR) as exactly one line,
  // and the hook must not displace the ethics notice from clone's last stderr line.
  it('records a default-out clone once beside the project and keeps the ethics notice last', () => {
    expect(projectDir).toBe(path.join(designLens, 'basic'));
    const lines = clone.stderr.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe(NOTICE);
    expect(clone.stdout.endsWith('\n')).toBe(true);
    expect(clone.stdout.trim().split('\n')).toHaveLength(1);
    const records = readRecords(log);
    expect(records).toHaveLength(1);
    const record = records[0] as CommandRecord;
    expect(record).toMatchObject({
      v: 1, kind: 'command', command: 'clone', args: [server.url('/index.html'), '--project', 'basic'], cwd: root,
      version: VERSION, agent: 'e2e-cloner', exitCode: 0,
    });
    expect(record.ms).toBeGreaterThan(0);
    expect(filesNamed(projectDir, 'RUNLOG.jsonl')).toEqual([]);
    expect(fs.existsSync(path.join(root, 'RUNLOG.jsonl'))).toBe(false);
  });

  // why: helper (subagent) CLI runs were invisible — no per-phase timing. The clone record must carry
  // the capture and materialize phases in pipeline order, as whole milliseconds, so a slow stage
  // (readiness, attempts, fidelity) can be found from the run log alone.
  it('attaches capture and materialize phases to the clone record', () => {
    const record = commandRecords(log)[0];
    expect(record.command).toBe('clone');
    const names = (record.phases ?? []).map((phase) => phase.name);
    const pipeline = ['launch', 'navigate', 'sweep', 'robots', 'stamp', 'promote', 'frames', 'stabilize-readiness',
      'stabilize-freeze', 'attempts', 'refetch', 'reconcile', 'close', 'sanitize', 'localize', 'beautify', 'write', 'verify',
      'evidence-hash', 're-render', 'fidelity'];
    for (const name of pipeline) expect(names, name).toContain(name);
    const firstIndex = pipeline.map((name) => names.indexOf(name));
    expect(firstIndex).toEqual([...firstIndex].sort((a, b) => a - b));
    expect(names).not.toContain('compose');
    for (const phase of record.phases ?? []) {
      expect(Number.isInteger(phase.ms) && phase.ms >= 0, phase.name).toBe(true);
    }
    const phased = (record.phases ?? []).reduce((total, phase) => total + phase.ms, 0);
    expect(phased).toBeLessThanOrEqual(record.ms + (record.phases ?? []).length);
  });

  // why: read-only commands must stay read-only for the project (inspect/verify/validate-design
  // pin unchanged trees) while still appending their own line to the shared log.
  it('appends one line per command and leaves the project tree unchanged', async () => {
    const before = await hashTree(projectDir);
    const result = await runCli(['verify', projectDir, '--json'], root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    JSON.parse(result.stdout);
    expect(await hashTree(projectDir)).toEqual(before);
    const records = commandRecords(log);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ command: 'verify', args: [projectDir, '--json'], agent: null, exitCode: 0 });
  });

  // why: the opt-out is the user's guarantee that nothing is written; the absolute override is how
  // logs from several workspaces are collected; an unwritable override must change nothing at all.
  it('honours DESIGN_LENS_RUNLOG=off and an absolute override, silently', async () => {
    const off = await runCli(['verify', projectDir], root, { runlog: 'off' });
    expect(off.code).toBe(0);
    expect(commandRecords(log)).toHaveLength(2);

    const custom = path.join(root, 'collected.jsonl');
    const overridden = await runCli(['verify', bare], root, { runlog: custom, agent: 'collector' });
    expect(overridden.code).toBe(1);
    expect(commandRecords(custom)).toEqual([expect.objectContaining({ command: 'verify', exitCode: 1, agent: 'collector' })]);
    expect(commandRecords(log)).toHaveLength(2);

    const unwritable = path.join(root, 'missing', 'dir', 'collected.jsonl');
    const failed = await runCli(['verify', projectDir], root, { runlog: unwritable });
    expect(failed.code).toBe(0);
    expect(failed.stdout).toBe(off.stdout);
    expect(failed.stderr).toBe(off.stderr);
    expect(fs.existsSync(path.join(root, 'missing'))).toBe(false);
  });

  // why: a failing command is the one most worth seeing (exit code from process.exitCode), and a
  // project outside any `.design-lens` must not write into its parent — the $TMPDIR pollution case.
  it('records failures and never logs for projects outside .design-lens', async () => {
    const missing = await runCli(['verify', path.join(designLens, 'absent')], root);
    expect(missing.code).toBe(1);
    expect(commandRecords(log).at(-1)).toMatchObject({ command: 'verify', exitCode: 1 });
    const count = commandRecords(log).length;

    const outside = await runCli(['verify', bare], bare);
    expect(outside.code).toBe(1);
    expect(commandRecords(log)).toHaveLength(count);
    expect(filesNamed(bare, 'RUNLOG.jsonl')).toEqual([]);
    expect(fs.existsSync(path.join(root, 'RUNLOG.jsonl'))).toBe(false);
  });

  // why: URL-only invocations have no project; they may use `<cwd>/.design-lens` only when it already
  // exists, otherwise running from any directory would leave a log there.
  it('uses an existing <cwd>/.design-lens for URL-only invocations and nothing otherwise', async () => {
    const count = commandRecords(log).length;
    const inRoot = await runCli(['screenshot', '--url', 'file:///etc/passwd', '--out', 'x.png'], root);
    expect(inRoot.code).toBe(1);
    expect(commandRecords(log)).toHaveLength(count + 1);
    expect(commandRecords(log).at(-1)).toMatchObject({ command: 'screenshot', args: ['--url', 'file:///etc/passwd', '--out', 'x.png'], exitCode: 1 });

    const elsewhere = await runCli(['screenshot', '--url', 'file:///etc/passwd', '--out', 'x.png'], bare);
    expect(elsewhere.code).toBe(1);
    expect(commandRecords(log)).toHaveLength(count + 1);
    expect(fs.readdirSync(bare)).toEqual([]);
  });

  /** Spawn `serve` and resolve once its port line is on stdout (its own handlers are armed by then). */
  async function startServe(agent: string): Promise<{ child: ChildProcess; closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }> {
    const child = spawn(process.execPath, [BUNDLE, 'serve', projectDir], { cwd: root, env: cliEnv({ agent }) });
    let stdout = '';
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on('close', (code, signal) => resolve({ code, signal })));
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes('\n')) resolve();
      });
      child.on('close', () => reject(new Error('serve closed before announcing its port')));
    });
    return { child, closed };
  }

  // why: serve's action resolves only after a signal; a postAction-style writer would miss it on
  // some paths and an extra exit writer would duplicate it. Exactly one record, exit 0.
  it('records serve exactly once, at shutdown', async () => {
    const before = commandRecords(log).filter((record) => record.command === 'serve').length;
    const { child, closed } = await startServe('previewer');
    expect(commandRecords(log).filter((record) => record.command === 'serve')).toHaveLength(before);
    child.kill('SIGTERM');
    expect(await closed).toEqual({ code: 0, signal: null });
    const serves = commandRecords(log).filter((record) => record.command === 'serve');
    expect(serves).toHaveLength(before + 1);
    expect(serves.at(-1)).toMatchObject({ args: [projectDir], agent: 'previewer', exitCode: 0 });
  });

  // why: a signal no command handles (serve owns SIGINT/SIGTERM, not SIGHUP; any command before
  // Playwright arms its handlers) ends the process without an `exit` event. The interrupted run must
  // still be recorded (128 + signal number) and the process must still end by that same signal.
  it('records a run ended by an unhandled signal and still ends by that signal', async () => {
    const before = commandRecords(log).filter((record) => record.command === 'serve').length;
    const { child, closed } = await startServe('hangup');
    child.kill('SIGHUP');
    expect(await closed).toEqual({ code: null, signal: 'SIGHUP' });
    const serves = commandRecords(log).filter((record) => record.command === 'serve');
    expect(serves).toHaveLength(before + 1);
    expect(serves.at(-1)).toMatchObject({ args: [projectDir], agent: 'hangup', exitCode: 128 + os.constants.signals.SIGHUP });
  });

  // why: marks are how skills attribute helper-subagent CLI runs to phases (the invisible-helper
  // failure). The summary must pair the marks, count the command run inside the window, credit the
  // agent and carry the token note — and runlog itself must never appear as a command record.
  it('marks phases and summarizes commands, agents and tokens', async () => {
    const start = await runCli(['runlog', projectDir, '--mark', 'build', '--event', 'start'], root, { agent: 'builder' });
    expect(start.code, start.stderr).toBe(0);
    const started = JSON.parse(start.stdout) as { out: string; mark: MarkRecord };
    expect(started.out).toBe(log);
    expect(started.mark).toMatchObject({ v: 1, kind: 'mark', phase: 'build', event: 'start', agent: 'builder' });

    expect((await runCli(['verify', projectDir], root, { agent: 'builder' })).code).toBe(0);
    const end = await runCli(['runlog', root, '--mark', 'build', '--event', 'end', '--tokens', '1200', '--note', 'first pass'], bare, { agent: 'builder' });
    expect(end.code, end.stderr).toBe(0);

    const json = await runCli(['runlog', designLens, '--summary', '--json'], bare);
    expect(json.code, json.stderr).toBe(0);
    expect(json.stdout.trim().split('\n')).toHaveLength(1);
    const summary = JSON.parse(json.stdout) as RunLogSummary;
    expect(summary.log).toBe(log);
    expect(summary.windows).toEqual([expect.objectContaining({ phase: 'build', agent: 'builder', commands: 1, byCommand: { verify: 1 } })]);
    expect(summary.windows[0]!.ms).toBeGreaterThan(0);
    expect(summary.tokens).toEqual({ total: 1200, notes: [expect.objectContaining({ phase: 'build', event: 'end', tokens: 1200, note: 'first pass' })] });
    expect(summary.agents).toContainEqual({ agent: 'builder', commands: 1, marks: 2, commandMs: expect.any(Number) });
    expect(summary.commands.byCommand.map((entry) => entry.command)).toEqual(expect.arrayContaining(['clone', 'verify', 'screenshot', 'serve']));
    expect(commandRecords(log).some((record) => record.command === 'runlog')).toBe(false);

    const table = await runCli(['runlog', projectDir], root);
    expect(table.code).toBe(0);
    expect(table.stdout).toBe('');
    expect(table.stderr).toContain(`Run log: ${log}`);
    expect(table.stderr).toContain('build [builder]');
  });

  // why: a mark that cannot be placed must fail loudly (exit 1, nothing on stdout) instead of
  // landing in a surprising directory; the opt-out applies to explicit marks too.
  it('rejects unusable directories and malformed marks, and respects off for marks', async () => {
    const before = readRecords(log).length;
    for (const args of [
      ['runlog', path.join(root, 'absent')],
      ['runlog', bare],
      ['runlog', projectDir, '--mark', 'Build', '--event', 'start'],
      ['runlog', projectDir, '--event', 'end'],
      ['runlog', projectDir, '--mark', 'build', '--event', 'end', '--tokens', 'many'],
    ]) {
      const result = await runCli(args, root);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(result.stderr, args.join(' ')).toMatch(/^error: /m);
    }
    const disabled = await runCli(['runlog', projectDir, '--mark', 'build', '--event', 'start'], root, { runlog: 'off' });
    expect(disabled.code).toBe(0);
    expect(JSON.parse(disabled.stdout)).toEqual({ out: null, mark: null });
    expect(disabled.stderr).toContain('run log disabled');
    expect(readRecords(log)).toHaveLength(before);
  });

  // why: lite inspection loads its viewports concurrently, so the record must carry ONE wall-clock
  // phase for them (a sum of overlapping per-viewport timings would exceed the run's own time),
  // and the project must stay unchanged because inspect never writes into it.
  it('records inspect --lite --viewports as non-overlapping wall-clock phases', async () => {
    const before = await hashTree(projectDir);
    const result = await runCli(['inspect', projectDir, '--lite', '--viewports', '1440x900,390x844'], root, { agent: 'analyst' });
    expect(result.code, result.stderr).toBe(0);
    expect(await hashTree(projectDir)).toEqual(before);
    const record = commandRecords(log).at(-1)!;
    expect(record).toMatchObject({ command: 'inspect', agent: 'analyst', exitCode: 0 });
    expect((record.phases ?? []).map((phase) => phase.name)).toEqual(['serve', 'launch', 'lite-viewports', 'close']);
    expect((record.phases ?? []).reduce((total, phase) => total + phase.ms, 0)).toBeLessThanOrEqual(record.ms + 4);

    const detailed = await runCli(['inspect', projectDir], root);
    expect(detailed.code, detailed.stderr).toBe(0);
    expect((commandRecords(log).at(-1)!.phases ?? []).map((phase) => phase.name)).toEqual(['serve', 'launch', 'navigate', 'fonts', 'probe', 'close']);
  });

  // why: tone reads, hashes and decodes every full-page screenshot; its record must say which of
  // reading, profiling and writing took the time.
  it('records tone phases', async () => {
    const result = await runCli(['tone', projectDir], root);
    expect(result.code, result.stderr).toBe(0);
    const record = commandRecords(log).at(-1)!;
    expect(record).toMatchObject({ command: 'tone', exitCode: 0 });
    expect((record.phases ?? []).map((phase) => phase.name)).toEqual(['read', 'profile', 'write']);
  });

  // why: qa stores per-viewport timings in qa.json; the run log must carry their per-phase totals
  // (plus the remainder outside them) so a slow build check is attributable without opening qa.json.
  it('records qa phases derived from its per-viewport timings', async () => {
    const out = path.join(root, 'qa-run');
    const result = await runCli(['qa', '--dir', path.join(SITES, 'qa-study', 'clean'), '--project', projectDir, '--viewports', '390x844',
      '--max-clicks', '0', '--out', out], root, { agent: 'verifier' });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    const record = commandRecords(log).at(-1)!;
    expect(record).toMatchObject({ command: 'qa', agent: 'verifier', exitCode: result.code });
    const qa = JSON.parse(fs.readFileSync(path.join(out, 'qa.json'), 'utf8')) as { viewports: Array<{ timings: Record<string, number> }> };
    const timings = qa.viewports[0]!.timings;
    const names = (record.phases ?? []).map((phase) => phase.name);
    expect(names[0]).toBe('resolve');
    for (const name of Object.keys(timings).filter((key) => key !== 'total')) {
      expect(record.phases).toContainEqual({ name, ms: timings[name] });
    }
    expect(names.slice(-2)).toEqual(['viewport-other', 'other']);
    expect(names).not.toContain('total');
    expect(record.verdict).toBe(JSON.parse(result.stdout).status);
  });

  // why: validate-design exits 1 on a fail verdict by design; without the recorded verdict the summary counted those
  // intended exits as tool errors, and an interrupted phase had no way to be closed without counting its idle gap.
  it('records verdicts apart from errors and closes an interrupted phase with an abort mark', async () => {
    const verdict = await runCli(['validate-design', projectDir, '--json'], root);
    expect(verdict.code).toBe(1);
    expect(commandRecords(log).at(-1)).toMatchObject({ command: 'validate-design', exitCode: 1, verdict: 'fail' });
    const error = await runCli(['qa-confirm', path.join(projectDir, 'qa', 'absent'), '--codes', 'ABC234'], root);
    expect(error.code).toBe(1);
    expect(error.stderr).toMatch(/^error: /m);
    expect(commandRecords(log).at(-1)).toMatchObject({ command: 'qa-confirm', exitCode: 1 });
    expect(commandRecords(log).at(-1)!.verdict).toBeUndefined();
    expect((await runCli(['runlog', projectDir, '--mark', 'repair', '--event', 'start'], root)).code).toBe(0);
    const abort = await runCli(['runlog', projectDir, '--mark', 'repair', '--event', 'abort'], root);
    expect(abort.code, abort.stderr).toBe(0);
    expect(JSON.parse(abort.stdout).mark).toMatchObject({ phase: 'repair', event: 'abort' });
    const summary = JSON.parse((await runCli(['runlog', designLens, '--json'], root)).stdout) as RunLogSummary;
    expect(summary.windows.find((window) => window.phase === 'repair')).toMatchObject({ aborted: true });
    expect(summary.phases.find((phase) => phase.phase === 'repair')).toMatchObject({ ms: 0, aborted: 1 });
    expect(summary.commands.byCommand.find((entry) => entry.command === 'validate-design')).toMatchObject({ failed: 1, verdicts: 1 });
    expect(summary.commands.byCommand.find((entry) => entry.command === 'qa-confirm')).toEqual(expect.not.objectContaining({ verdicts: expect.anything() }));
  });
});
