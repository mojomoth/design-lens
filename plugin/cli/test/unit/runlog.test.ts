/**
 * Unit tests for the local run log (lib/runlog.ts) and the pure halves of `runlog <dir>`.
 *
 * The log is written from a process `exit` listener in every CLI process, so its failure modes are
 * silent by design: a wrong location pollutes `$TMPDIR` or a project dir without any test seeing an
 * error, a lost redaction leaks review codes into a file, and a summary that mis-pairs marks
 * attributes commands to the wrong phase. These tests pin the location rules, the redaction, the
 * record shape and the summary arithmetic without spawning a process; the spawned behaviour (one
 * line per command, `off`, clone's last stderr line, serve) is covered in test/e2e/runlog.test.ts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  argsAfterCommand,
  beginCommandRecord,
  effectiveExitCode,
  finishCommandRecord,
  lastRunLogWrite,
  markPhase,
  nearestDesignLensDir,
  recordedPhases,
  redactArgs,
  resolveRunLogFile,
  runLogPreAction,
  signalExitCode,
  TERMINATING_SIGNALS,
  timePhase,
  timePhaseSync,
  type CommandRecord,
  type RunLogInvocation,
} from '../../src/lib/runlog.js';
import {
  formatRunLogSummary,
  parseRunLog,
  planRunlog,
  resolveRunlogLocation,
  summarizeRunLog,
} from '../../src/commands/runlog.js';
import { qaRunPhases } from '../../src/commands/qa.js';
import { VERSION } from '../../src/version.js';

const ROOT = path.resolve(os.tmpdir(), 'dl-runlog-unit');
const DL = path.join(ROOT, '.design-lens');

function invocation(command: string, operands: unknown[] = [], options: Record<string, unknown> = {}, cwd = ROOT): RunLogInvocation {
  return { command, operands, options, cwd };
}

/** Only the directories named here exist; everything else is absent. */
function existing(...dirs: string[]): (dir: string) => boolean {
  const set = new Set(dirs.map((dir) => path.resolve(dir)));
  return (dir) => set.has(path.resolve(dir));
}

const NO_ENV = {};

/** Deterministic ISO timestamps without writing a timestamp literal. */
function at(seconds: number): string {
  return new Date(Date.UTC(2026, 9, 6, 9, 0, 0) + seconds * 1000).toISOString();
}

const temps: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-runlog-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  finishCommandRecord(0);
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('run log location', () => {
  // why: the default location is the nearest `.design-lens` at or above the project. If the search
  // stopped at the immediate parent, `.design-lens/<slug>/sub` layouts lose their log; if it ignored
  // the name, `inspect ./site` would write into whatever directory contains the user's repo.
  it('finds the nearest ancestor-or-self directory named .design-lens', () => {
    expect(nearestDesignLensDir(DL)).toBe(DL);
    expect(nearestDesignLensDir(path.join(DL, 'example-com'))).toBe(DL);
    expect(nearestDesignLensDir(path.join(DL, 'example-com', 'qa', 'qa-1-0123abcd'))).toBe(DL);
    const inner = path.join(DL, 'nested', '.design-lens');
    expect(nearestDesignLensDir(path.join(inner, 'project'))).toBe(inner);
    expect(nearestDesignLensDir(path.join(ROOT, 'site'))).toBeNull();
  });

  // why: every project-taking command logs beside its project, never inside it (inspect, verify and
  // validate-design must leave the project tree byte-identical; e2e pins that with tree hashes).
  it('anchors positional-project commands at the project dir', () => {
    for (const command of ['tokens', 'inspect', 'screenshot', 'serve', 'verify', 'fidelity', 'validate-design', 'tone']) {
      expect(resolveRunLogFile(invocation(command, [path.join(DL, 'site')]), NO_ENV, existing()), command)
        .toBe(path.join(DL, 'RUNLOG.jsonl'));
    }
    expect(resolveRunLogFile(invocation('inspect', ['.design-lens/site']), NO_ENV, existing()))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
  });

  // why: e2e projects made directly by mkdtemp sit in the shared $TMPDIR. A parent-dir default would
  // make every worktree's suite append to one `$TMPDIR/RUNLOG.jsonl`; no `.design-lens` means no log.
  it('writes nothing for a project outside any .design-lens directory', () => {
    const bare = path.join(os.tmpdir(), 'dl-e2e-abc123');
    expect(resolveRunLogFile(invocation('inspect', [bare]), NO_ENV, existing(os.tmpdir(), bare))).toBeNull();
  });

  // why: the opt-out must win over every location rule, in the spellings users actually type.
  it('is disabled by DESIGN_LENS_RUNLOG=off, 0 or false', () => {
    for (const value of ['off', '0', 'false', 'OFF', ' False ']) {
      expect(resolveRunLogFile(invocation('inspect', [path.join(DL, 'site')]), { DESIGN_LENS_RUNLOG: value }, existing(DL)), value).toBeNull();
    }
  });

  // why: an absolute override is how a user collects logs from projects that live outside
  // `.design-lens`; a relative value is ambiguous across cwd changes and falls back to the default.
  it('honours an absolute DESIGN_LENS_RUNLOG and ignores a relative one', () => {
    const file = path.join(ROOT, 'logs', 'all.jsonl');
    expect(resolveRunLogFile(invocation('inspect', [path.join(ROOT, 'site')]), { DESIGN_LENS_RUNLOG: file }, existing())).toBe(file);
    expect(resolveRunLogFile(invocation('inspect', [path.join(DL, 'site')]), { DESIGN_LENS_RUNLOG: 'logs/all.jsonl' }, existing()))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
  });

  // why: setup provisions the runtime and runlog reads/writes the log itself; logging either would
  // add records nobody asked for (and runlog would log its own summaries).
  it('never logs setup or runlog, even with an override', () => {
    const env = { DESIGN_LENS_RUNLOG: path.join(ROOT, 'all.jsonl') };
    expect(resolveRunLogFile(invocation('setup'), env, existing(DL))).toBeNull();
    expect(resolveRunLogFile(invocation('runlog', [DL]), env, existing(DL))).toBeNull();
  });

  // why: clone creates its default out root during the action, so the location is decided from the
  // path alone (existence is checked at write time); `--out` elsewhere must not log.
  it('anchors clone at its resolved --out root', () => {
    expect(resolveRunLogFile(invocation('clone', ['https://example.com'], { out: './.design-lens' }), NO_ENV, existing()))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
    expect(resolveRunLogFile(invocation('clone', ['https://example.com'], { out: path.join(ROOT, 'out') }), NO_ENV, existing(ROOT)))
      .toBeNull();
    expect(resolveRunLogFile(invocation('clone', ['https://example.com'], { out: path.join(DL, 'batch') }), NO_ENV, existing()))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
  });

  // why: qa logs with its --project; URL/dir-only invocations have no project and may only use an
  // existing `<cwd>/.design-lens`, otherwise they would create state wherever the user stands.
  it('uses --project for qa and an existing <cwd>/.design-lens for URL-only runs', () => {
    expect(resolveRunLogFile(invocation('qa', [], { project: path.join(DL, 'site'), dir: '/build' }), NO_ENV, existing()))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
    expect(resolveRunLogFile(invocation('qa', [], { url: 'http://127.0.0.1:1/' }), NO_ENV, existing(DL))).toBe(path.join(DL, 'RUNLOG.jsonl'));
    expect(resolveRunLogFile(invocation('qa', [], { url: 'http://127.0.0.1:1/' }), NO_ENV, existing(ROOT))).toBeNull();
    expect(resolveRunLogFile(invocation('screenshot', [undefined], { url: 'http://127.0.0.1:1/' }), NO_ENV, existing(DL)))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
    expect(resolveRunLogFile(invocation('screenshot', [], { url: 'http://127.0.0.1:1/' }), NO_ENV, existing())).toBeNull();
  });

  // why: qa-confirm's positional is `<project>/qa/<runId>`; anchoring it like a project dir would
  // still find the right `.design-lens`, but a parent-dir rule would write into `<project>/qa/`.
  it('anchors qa-confirm at the qa dir', () => {
    expect(resolveRunLogFile(invocation('qa-confirm', [path.join(DL, 'site', 'qa', 'qa-1-0123abcd')]), NO_ENV, existing()))
      .toBe(path.join(DL, 'RUNLOG.jsonl'));
  });
});

describe('run log record', () => {
  // why: qa review codes prove a human looked at each review image; logging them in clear would let
  // any later reader confirm a run without looking. Both flag spellings must be covered.
  it('redacts the values of --codes and --code', () => {
    expect(redactArgs(['qa/qa-1-0123abcd', '--codes', 'ABC234,XYZ789', '--json'])).toEqual(['qa/qa-1-0123abcd', '--codes', '<redacted>', '--json']);
    expect(redactArgs(['--code=ABC234', '--codes=A,B', '--codesx', 'keep'])).toEqual(['--code=<redacted>', '--codes=<redacted>', '--codesx', 'keep']);
    expect(redactArgs(['--codes'])).toEqual(['--codes']);
  });

  // why: args are "argv after the command name"; argv[0]/argv[1] are the node and bundle paths.
  it('takes the args after the first occurrence of the command name', () => {
    expect(argsAfterCommand(['/usr/bin/node', '/x/design-lens.cjs', 'inspect', 'site', '--lite'], 'inspect')).toEqual(['site', '--lite']);
    expect(argsAfterCommand(['inspect', 'inspect'], 'inspect')).toEqual(['inspect']);
    expect(argsAfterCommand(['a'], 'inspect')).toEqual([]);
  });

  // why: actions report failure through process.exitCode; the exit listener's `code` alone would
  // miss nothing, but a string exitCode (allowed by Node) must not become NaN in the record.
  it('derives the exit code from process.exitCode, falling back to the exit code', () => {
    expect(effectiveExitCode(undefined, 0)).toBe(0);
    expect(effectiveExitCode(1, 0)).toBe(1);
    expect(effectiveExitCode('2', 0)).toBe(2);
    expect(effectiveExitCode('x', 1)).toBe(1);
  });

  // why: the record shape is what `runlog --summary` and humans read; a missing field (agent, ppid,
  // version) makes helper-subagent runs indistinguishable again, which is the failure RUNLOG fixes.
  it('writes one command line through the preAction hook with the contracted shape', async () => {
    const root = tempDir();
    const qaDir = path.join(root, '.design-lens', 'site', 'qa', 'qa-1-0123abcd');
    fs.mkdirSync(qaDir, { recursive: true });
    const saved = { runlog: process.env.DESIGN_LENS_RUNLOG, agent: process.env.DESIGN_LENS_AGENT };
    delete process.env.DESIGN_LENS_RUNLOG;
    process.env.DESIGN_LENS_AGENT = 'unit-reviewer';
    try {
      const program = new Command();
      program.command('qa-confirm').argument('<qaDir>').option('--codes <list>').action(() => undefined);
      program.hook('preAction', runLogPreAction);
      program.parse(['node', 'design-lens.cjs', 'qa-confirm', qaDir, '--codes', 'ABC234,XYZ789']);
      markPhase('verify-codes', 12.4);
      await timePhase('write', () => 'done');
      expect(finishCommandRecord(0)).toEqual({ ok: true, file: path.join(root, '.design-lens', 'RUNLOG.jsonl') });
    } finally {
      if (saved.runlog === undefined) delete process.env.DESIGN_LENS_RUNLOG;
      else process.env.DESIGN_LENS_RUNLOG = saved.runlog;
      if (saved.agent === undefined) delete process.env.DESIGN_LENS_AGENT;
      else process.env.DESIGN_LENS_AGENT = saved.agent;
    }
    const lines = fs.readFileSync(path.join(root, '.design-lens', 'RUNLOG.jsonl'), 'utf8').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('');
    const record = JSON.parse(lines[0]!) as CommandRecord;
    expect(Object.keys(record)).toEqual(['v', 'kind', 'at', 'command', 'args', 'cwd', 'pid', 'ppid', 'version', 'agent', 'exitCode', 'ms', 'phases']);
    expect(record).toMatchObject({
      v: 1, kind: 'command', command: 'qa-confirm', args: [qaDir, '--codes', '<redacted>'], cwd: process.cwd(),
      pid: process.pid, ppid: process.ppid, version: VERSION, agent: 'unit-reviewer', exitCode: 0,
    });
    expect(new Date(record.at).toISOString()).toBe(record.at);
    expect(record.ms).toBeGreaterThanOrEqual(0);
    expect(record.phases?.map((phase) => phase.name)).toEqual(['verify-codes', 'write']);
    expect(record.phases?.[0]?.ms).toBe(12);
    expect(fs.readdirSync(path.join(root, '.design-lens', 'site'))).toEqual(['qa']);
  });

  // why: the record is written once per process; a second finish (or a duplicate exit) must not
  // append a second line, and phases from an earlier in-process command must not leak forward.
  it('writes at most once per begin and resets phases on the next begin', () => {
    const root = tempDir();
    const file = path.join(root, 'all.jsonl');
    const env = { DESIGN_LENS_RUNLOG: file };
    markPhase('stale', 5);
    expect(beginCommandRecord({ invocation: invocation('verify', [root]), args: [root], env })).toBe(file);
    expect(recordedPhases()).toEqual([]);
    expect(finishCommandRecord(1)).toEqual({ ok: true, file });
    expect(finishCommandRecord(1)).toBeNull();
    const records = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as CommandRecord);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ command: 'verify', exitCode: 1, agent: null });
    expect(records[0]).not.toHaveProperty('phases');
  });

  // why: "best effort and silent" — an unwritable location must neither throw nor print (clone's
  // last stderr line is pinned), and directories must never be created to make the write succeed.
  it('fails silently without creating directories', () => {
    const root = tempDir();
    const file = path.join(root, 'missing', 'all.jsonl');
    const stderr = vi.spyOn(process.stderr, 'write');
    const stdout = vi.spyOn(process.stdout, 'write');
    try {
      beginCommandRecord({ invocation: invocation('verify', [root]), args: [], env: { DESIGN_LENS_RUNLOG: file } });
      const result = finishCommandRecord(0);
      expect(result?.ok).toBe(false);
      expect(lastRunLogWrite()).toEqual(result);
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
    expect(fs.existsSync(path.join(root, 'missing'))).toBe(false);
  });

  // why: a signal-ended command is recorded with the status a shell reports for it (128 + signal
  // number); a wrong mapping would make an interrupted helper run look like a clean or generic failure.
  it('maps terminating signals to the shell exit status', () => {
    expect(TERMINATING_SIGNALS).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
    expect(TERMINATING_SIGNALS.map((signal) => signalExitCode(signal))).toEqual(
      TERMINATING_SIGNALS.map((signal) => 128 + os.constants.signals[signal]),
    );
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
  });

  // why: integration wraps clone/qa/inspect phases in timePhase; a phase that throws must still be
  // timed (failed phases are the ones worth seeing) and the error must reach the caller unchanged.
  it('times a rejected phase and rethrows', async () => {
    beginCommandRecord({ invocation: invocation('setup'), args: [], env: NO_ENV });
    await expect(timePhase('navigate', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(recordedPhases().map((phase) => phase.name)).toEqual(['navigate']);
  });

  // why: clone's materialize stages (sanitize, localize, write, verify) are synchronous; their
  // phases must be recorded in call order with the value returned and a throw still timed.
  it('times synchronous phases, returning the value and timing a throw', () => {
    beginCommandRecord({ invocation: invocation('setup'), args: [], env: NO_ENV });
    expect(timePhaseSync('sanitize', () => 42)).toBe(42);
    expect(() => timePhaseSync('write', () => { throw new Error('disk full'); })).toThrow('disk full');
    expect(recordedPhases().map((phase) => phase.name)).toEqual(['sanitize', 'write']);
    expect(recordedPhases().every((phase) => Number.isInteger(phase.ms) && phase.ms >= 0)).toBe(true);
  });
});

describe('runlog command planning and location', () => {
  // why: a mark without an event (or an event without a mark) cannot be paired into a window, and a
  // phase name outside the grammar breaks the table; all must fail before anything is written.
  it('rejects malformed mark flags', () => {
    expect(() => planRunlog('.', { event: 'start' })).toThrow('--event requires --mark');
    expect(() => planRunlog('.', { note: 'x' })).toThrow('--note and --tokens require --mark');
    expect(() => planRunlog('.', { mark: 'build' })).toThrow('--mark requires --event start|end');
    expect(() => planRunlog('.', { mark: 'Build', event: 'start' })).toThrow('invalid --mark');
    expect(() => planRunlog('.', { mark: 'a'.repeat(41), event: 'start' })).toThrow('invalid --mark');
    expect(() => planRunlog('.', { mark: 'build', event: 'begin' })).toThrow('--mark requires --event');
    expect(() => planRunlog('.', { mark: 'build', event: 'end', tokens: '-3' })).toThrow('invalid --tokens');
    expect(() => planRunlog('.', { mark: 'build', event: 'end', tokens: '1.5' })).toThrow('invalid --tokens');
    expect(planRunlog('.', {})).toEqual({ dir: '.', mark: null, summary: true, json: false });
    expect(planRunlog('.', { mark: 'build-2', event: 'end', tokens: '1200', note: 'n', json: true })).toEqual({
      dir: '.', mark: { phase: 'build-2', event: 'end', note: 'n', tokens: 1200 }, summary: false, json: true,
    });
  });

  // why: skills pass whatever directory they hold (the .design-lens root, a project, or the
  // workspace containing .design-lens); all three must reach the same log, anything else must fail.
  it('resolves the log dir from <dir> and errors when there is none', () => {
    const file = path.join(DL, 'RUNLOG.jsonl');
    expect(resolveRunlogLocation(DL, NO_ENV, existing(DL))).toEqual({ file, disabled: false });
    expect(resolveRunlogLocation(path.join(DL, 'site'), NO_ENV, existing(path.join(DL, 'site')))).toEqual({ file, disabled: false });
    expect(resolveRunlogLocation(ROOT, NO_ENV, existing(ROOT, DL))).toEqual({ file, disabled: false });
    expect(() => resolveRunlogLocation(ROOT, NO_ENV, existing(ROOT))).toThrow('no .design-lens directory');
    expect(() => resolveRunlogLocation(path.join(ROOT, 'absent'), NO_ENV, existing())).toThrow('not a directory');
    expect(resolveRunlogLocation(ROOT, { DESIGN_LENS_RUNLOG: '/var/log/dl.jsonl' }, existing(ROOT))).toEqual({ file: '/var/log/dl.jsonl', disabled: false });
    expect(resolveRunlogLocation(DL, { DESIGN_LENS_RUNLOG: 'off' }, existing(DL))).toEqual({ file, disabled: true });
  });
});

describe('runlog summary', () => {
  const command = (seconds: number, name: string, extra: Partial<CommandRecord> = {}): string => JSON.stringify({
    v: 1, kind: 'command', at: at(seconds), command: name, args: [], cwd: '/w', pid: 1, ppid: 0, version: VERSION,
    agent: null, exitCode: 0, ms: 1000, ...extra,
  });
  const mark = (seconds: number, phase: string, event: 'start' | 'end', extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ v: 1, kind: 'mark', at: at(seconds), phase, event, agent: null, ...extra });

  const text = [
    mark(0, 'analysis', 'start'),
    command(5, 'inspect', { agent: 'analyst', phases: [{ name: 'navigate', ms: 300 }, { name: 'probe', ms: 50 }] }),
    mark(1, 'build', 'start', { agent: 'builder' }),
    mark(2, 'build', 'start', { agent: 'helper' }),
    command(12, 'qa', { agent: 'builder', exitCode: 1, ms: 4000, phases: [{ name: 'navigate', ms: 700 }] }),
    mark(20, 'analysis', 'end', { tokens: 3000, note: 'first pass' }),
    mark(30, 'build', 'end', { agent: 'helper', tokens: 500 }),
    command(40, 'inspect', { agent: 'analyst', phases: [{ name: 'navigate', ms: 100 }] }),
    mark(45, 'review', 'end'),
    '{"v":2,"kind":"command"}',
    'not json',
    '',
  ].join('\n');

  // why: unreadable lines (a torn write, a future schema) must be counted, not crash the summary or
  // silently vanish.
  it('parses records and counts unreadable lines', () => {
    const parsed = parseRunLog(text);
    expect(parsed.records).toHaveLength(9);
    expect(parsed.invalidLines).toBe(2);
  });

  // why: windows pair per (phase, agent) so concurrent helpers marking the same phase never close
  // each other's windows; commands are attributed by start time; unpaired marks stay visible.
  it('builds phase windows, command, agent, token and phase-timing aggregates', () => {
    const summary = summarizeRunLog('/w/.design-lens/RUNLOG.jsonl', parseRunLog(text));
    expect(summary.records).toBe(9);
    expect(summary.span).toEqual({ from: at(0), to: at(45), ms: 45_000 });
    expect(summary.windows.map((window) => [window.phase, window.agent, window.ms, window.commands])).toEqual([
      ['analysis', null, 20_000, 2],
      ['build', 'builder', null, 3],
      ['build', 'helper', 28_000, 2],
    ]);
    expect(summary.windows[0]!.byCommand).toEqual({ inspect: 1, qa: 1 });
    expect(summary.windows[0]!.commandMs).toBe(5000);
    expect(summary.phases).toEqual([
      { phase: 'analysis', windows: 1, open: 0, ms: 20_000, commands: 2 },
      { phase: 'build', windows: 2, open: 1, ms: 28_000, commands: 5 },
    ]);
    expect(summary.unmatchedEnds).toEqual([{ phase: 'review', agent: null, at: at(45) }]);
    expect(summary.commands).toEqual({
      count: 3, failed: 1, ms: 6000,
      byCommand: [{ command: 'inspect', count: 2, failed: 0, ms: 2000 }, { command: 'qa', count: 1, failed: 1, ms: 4000 }],
    });
    expect(summary.agents).toEqual([
      { agent: null, commands: 0, marks: 3, commandMs: 0 },
      { agent: 'builder', commands: 1, marks: 1, commandMs: 4000 },
      { agent: 'helper', commands: 0, marks: 2, commandMs: 0 },
      { agent: 'analyst', commands: 2, marks: 0, commandMs: 2000 },
    ]);
    expect(summary.tokens).toEqual({
      total: 3500,
      notes: [
        { at: at(20), phase: 'analysis', event: 'end', agent: null, tokens: 3000, note: 'first pass' },
        { at: at(30), phase: 'build', event: 'end', agent: 'helper', tokens: 500 },
      ],
    });
    expect(summary.commandPhases).toEqual([
      { command: 'inspect', phase: 'navigate', count: 2, ms: 400 },
      { command: 'inspect', phase: 'probe', count: 1, ms: 50 },
      { command: 'qa', phase: 'navigate', count: 1, ms: 700 },
    ]);
  });

  // why: the human table is the default output skills paste into reports; it must name the log and
  // carry every section, and an empty log must still summarize instead of failing.
  it('formats a compact table, including for an empty log', () => {
    const table = formatRunLogSummary(summarizeRunLog('/w/.design-lens/RUNLOG.jsonl', parseRunLog(text)));
    expect(table).toContain('Run log: /w/.design-lens/RUNLOG.jsonl (9 records, 2 unreadable lines skipped)');
    expect(table).toContain('  build [builder] +1.0s open 3 commands (inspect 2, qa 1)');
    expect(table).toContain('Phase totals:\n  analysis 1 windows 20.0s 2 commands\n  build 2 windows (1 open) 28.0s 5 commands\n');
    expect(table).toContain('Commands: 3 (1 failed) 6.0s');
    expect(table).toContain('Token notes: 3500 tokens');
    expect(table).toContain('  inspect navigate 2x 0.4s');
    const empty = summarizeRunLog('/w/.design-lens/RUNLOG.jsonl', parseRunLog(''));
    expect(empty.span).toBeNull();
    expect(formatRunLogSummary(empty)).toBe('Run log: /w/.design-lens/RUNLOG.jsonl (0 records)\nCommands: 0 (0 failed) 0.0s\n');
  });
});

describe('runlog abort marks and verdict exits', () => {
  const command = (seconds: number, name: string, extra: Partial<CommandRecord> = {}): string => JSON.stringify({
    v: 1, kind: 'command', at: at(seconds), command: name, args: [], cwd: '/w', pid: 1, ppid: 0, version: VERSION,
    agent: null, exitCode: 0, ms: 1000, ...extra,
  });
  const mark = (seconds: number, phase: string, event: 'start' | 'end' | 'abort'): string =>
    JSON.stringify({ v: 1, kind: 'mark', at: at(seconds), phase, event, agent: null });

  // why: an interrupted phase closed by its end mark reported an hour of idle gap as phase cost; an abort mark must
  // close the window, label it and keep its time out of the phase total.
  it('closes a window with an abort mark and reports its time apart', () => {
    expect(planRunlog('.', { mark: 'build', event: 'abort' }).mark).toEqual({ phase: 'build', event: 'abort' });
    expect(() => planRunlog('.', { mark: 'build', event: 'stop' })).toThrow('--mark requires --event start|end|abort');
    const text = [mark(0, 'build', 'start'), mark(3000, 'build', 'abort'), mark(3010, 'build', 'start'), mark(3070, 'build', 'end')].join('\n');
    const summary = summarizeRunLog('/w/.design-lens/RUNLOG.jsonl', parseRunLog(text));
    expect(summary.windows.map((window) => [window.ms, window.aborted ?? false])).toEqual([[3_000_000, true], [60_000, false]]);
    expect(summary.phases).toEqual([{ phase: 'build', windows: 2, open: 0, ms: 60_000, commands: 0, aborted: 1, abortedMs: 3_000_000 }]);
    const table = formatRunLogSummary(summary);
    expect(table).toContain('  build [(no agent)] +0.0s 3000.0s aborted 0 commands');
    expect(table).toContain('  build 2 windows 60.0s 0 commands; 1 aborted 3000.0s not counted');
  });

  // why: validate-design and qa exit 1 on a fail verdict by design; counting those as failures made an intended
  // verdict look like a tool error in the summary.
  it('separates reported verdict exits from errors', () => {
    const text = [
      command(0, 'validate-design', { exitCode: 1, verdict: 'fail' }),
      command(1, 'validate-design', { exitCode: 1 }),
      command(2, 'qa', { exitCode: 0, verdict: 'pass' }),
    ].join('\n');
    const summary = summarizeRunLog('/w/.design-lens/RUNLOG.jsonl', parseRunLog(text));
    expect(summary.commands).toMatchObject({ count: 3, failed: 2, verdicts: 1 });
    expect(summary.commands.byCommand[0]).toEqual({ command: 'validate-design', count: 2, failed: 2, verdicts: 1, ms: 2000 });
    const table = formatRunLogSummary(summary);
    expect(table).toContain('Commands: 3 (2 failed: 1 verdict, 1 error) 3.0s');
    expect(table).toContain('  qa 1 (0 failed) 1.0s');
    expect(parseRunLog(command(0, 'qa', { verdict: 7 as unknown as string })).invalidLines).toBe(1);
  });
});

describe('qa run-log phases', () => {
  // why: qa viewports run one after another, so its phases must be per-name sums across viewports
  // that, with viewport-other and other, add up to the run time; double-counting `total` or a
  // negative remainder would make the run-log phase table lie about where qa spends its time.
  it('sums per-viewport timings and partitions the run time', () => {
    const phases = qaRunPhases([
      { navigate: 300, fonts: 20, probes: 100, total: 500 },
      { navigate: 200, fonts: 10, controls: 400, total: 650 },
    ], 1500);
    expect(phases).toEqual([
      { name: 'navigate', ms: 500 },
      { name: 'fonts', ms: 30 },
      { name: 'probes', ms: 100 },
      { name: 'controls', ms: 400 },
      { name: 'viewport-other', ms: 120 },
      { name: 'other', ms: 350 },
    ]);
    expect(phases.reduce((total, phase) => total + phase.ms, 0)).toBe(1500);
    expect(qaRunPhases([], 40)).toEqual([{ name: 'other', ms: 40 }]);
    expect(qaRunPhases([{ navigate: 90 }], 50)).toEqual([
      { name: 'navigate', ms: 90 }, { name: 'viewport-other', ms: 0 }, { name: 'other', ms: 0 },
    ]);
  });
});
