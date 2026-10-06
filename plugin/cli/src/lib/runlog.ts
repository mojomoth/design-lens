/**
 * The local run log: one JSON line per design-lens command (and per `runlog --mark`) appended to a
 * `RUNLOG.jsonl` that sits beside the projects, never inside one.
 *
 * Constraints this module exists to keep:
 * - Best effort and silent. A run-log failure never prints, never throws out of a hook and never
 *   changes the exit code: `clone`'s last stderr line must stay the ethics notice, stdout carries only
 *   each command's machine JSON, and inspect/verify/validate-design must leave project dirs unchanged.
 * - Location is decided without creating anything: `DESIGN_LENS_RUNLOG` (`off`|`0`|`false` disables;
 *   an absolute path names the file) or the nearest ancestor-or-self directory named `.design-lens`
 *   of the command's project anchor; URL/dir-only invocations use `<cwd>/.design-lens` only when it
 *   already exists. Directories are never created, so a test project in a bare `mkdtemp` (whose
 *   parent is the shared `$TMPDIR`) never produces a log.
 * - One record per process, written by a single `appendFileSync` from a `process.once('exit')`
 *   listener, so actions that resolve only after a signal (`serve`) and actions that reject still
 *   produce exactly one line, with the exit code the process really ends with. A SIGINT, SIGTERM or
 *   SIGHUP that no command handles ends the process without `exit`; a listener that acts only when
 *   it is alone writes the record (128 + signal number) and re-raises the signal.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { VERSION } from '../version.js';

export const RUNLOG_FILE_NAME = 'RUNLOG.jsonl';
export const RUNLOG_DIR_NAME = '.design-lens';
export const RUNLOG_ENV = 'DESIGN_LENS_RUNLOG';
export const AGENT_ENV = 'DESIGN_LENS_AGENT';

/** Commands whose own invocations are never logged (`--version`/`--help` never reach an action). */
export const UNLOGGED_COMMANDS: ReadonlySet<string> = new Set(['setup', 'runlog']);

/** Commands whose first positional argument is the project directory. */
const POSITIONAL_PROJECT_COMMANDS: ReadonlySet<string> = new Set([
  'tokens', 'inspect', 'screenshot', 'serve', 'verify', 'fidelity', 'validate-design', 'tone', 'qa-confirm',
]);

/** Flags whose value is a secret (qa review codes) and is replaced before it reaches the log. */
const REDACTED_FLAGS: ReadonlySet<string> = new Set(['--codes', '--code']);
export const REDACTED_VALUE = '<redacted>';

export const MARK_PHASE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export interface PhaseTiming {
  name: string;
  ms: number;
}

export interface CommandRecord {
  v: 1;
  kind: 'command';
  /** Start time, ISO 8601. */
  at: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  ppid: number;
  version: string;
  agent: string | null;
  exitCode: number;
  ms: number;
  phases?: PhaseTiming[];
  /** The status a verdict command reported (e.g. `fail`); its non-zero exit is that verdict, not an error. */
  verdict?: string;
}

/** `abort` closes a window whose work was interrupted; its time is reported apart from completed phases. */
export type MarkEvent = 'start' | 'end' | 'abort';
export const MARK_EVENTS: readonly MarkEvent[] = ['start', 'end', 'abort'];

export interface MarkRecord {
  v: 1;
  kind: 'mark';
  at: string;
  phase: string;
  event: MarkEvent;
  note?: string;
  tokens?: number;
  agent: string | null;
}

export type RunLogRecord = CommandRecord | MarkRecord;

export type RunLogEnv = Readonly<Record<string, string | undefined>>;

/** What a command invocation contributes to the location decision. */
export interface RunLogInvocation {
  command: string;
  /** Commander's processed positional arguments, in declaration order. */
  operands: readonly unknown[];
  options: Readonly<Record<string, unknown>>;
  cwd: string;
}

/**
 * Where a command's record is anchored: `ancestor` searches the path and its ancestors for a
 * directory named `.design-lens`; `cwd` uses `<cwd>/.design-lens` only if it already exists.
 */
export type RunLogAnchor = { kind: 'ancestor'; path: string } | { kind: 'cwd'; cwd: string };

export type RunLogWriteResult = { ok: true; file: string } | { ok: false; reason: string };

/** `off`/`0`/`false` (any case, surrounding whitespace ignored) disable the log entirely. */
export function runLogDisabled(env: RunLogEnv): boolean {
  const raw = env[RUNLOG_ENV];
  return raw !== undefined && ['off', '0', 'false'].includes(raw.trim().toLowerCase());
}

/** An absolute `DESIGN_LENS_RUNLOG` names the log file; anything else defers to the default rule. */
export function runLogOverride(env: RunLogEnv): string | null {
  const raw = env[RUNLOG_ENV];
  if (raw === undefined || runLogDisabled(env)) return null;
  return path.isAbsolute(raw) ? path.normalize(raw) : null;
}

/** The agent label recorded with every line; set by skills to tell subagent runs apart. */
export function runLogAgent(env: RunLogEnv): string | null {
  return env[AGENT_ENV] ?? null;
}

/** Lexical: the nearest ancestor-or-self of `target` whose basename is `.design-lens`. */
export function nearestDesignLensDir(target: string): string | null {
  let current = path.resolve(target);
  for (;;) {
    if (path.basename(current) === RUNLOG_DIR_NAME) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Which path a command's record is anchored to (null: the command never logs). */
export function runLogAnchor(invocation: RunLogInvocation): RunLogAnchor | null {
  const { command, operands, options, cwd } = invocation;
  if (UNLOGGED_COMMANDS.has(command)) return null;
  if (command === 'clone') {
    const out = typeof options.out === 'string' ? options.out : `./${RUNLOG_DIR_NAME}`;
    return { kind: 'ancestor', path: path.resolve(cwd, out) };
  }
  if (command === 'qa') {
    return typeof options.project === 'string'
      ? { kind: 'ancestor', path: path.resolve(cwd, options.project) }
      : { kind: 'cwd', cwd };
  }
  if (POSITIONAL_PROJECT_COMMANDS.has(command)) {
    const first = operands[0];
    if (typeof first === 'string' && first !== '') return { kind: 'ancestor', path: path.resolve(cwd, first) };
    return command === 'screenshot' ? { kind: 'cwd', cwd } : null;
  }
  return { kind: 'cwd', cwd };
}

/**
 * The log file for one invocation, or null when nothing should be written. Existence of an
 * ancestor-anchored directory is checked at write time instead: `clone` creates its default out
 * root during the action, and a clone that fails before creating it must leave no trace.
 */
export function resolveRunLogFile(
  invocation: RunLogInvocation,
  env: RunLogEnv,
  isDirectory: (dir: string) => boolean = directoryExists,
): string | null {
  const anchor = runLogAnchor(invocation);
  if (anchor === null || runLogDisabled(env)) return null;
  const override = runLogOverride(env);
  if (override !== null) return override;
  if (anchor.kind === 'cwd') {
    const dir = path.join(anchor.cwd, RUNLOG_DIR_NAME);
    return isDirectory(dir) ? path.join(dir, RUNLOG_FILE_NAME) : null;
  }
  const dir = nearestDesignLensDir(anchor.path);
  return dir === null ? null : path.join(dir, RUNLOG_FILE_NAME);
}

export function directoryExists(dir: string): boolean {
  return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** Replace the value of every secret-bearing flag (`--codes x` and `--codes=x`). */
export function redactArgs(args: readonly string[]): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (REDACTED_FLAGS.has(arg)) {
      redacted.push(arg);
      if (index + 1 < args.length) {
        redacted.push(REDACTED_VALUE);
        index += 1;
      }
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals > 0 && REDACTED_FLAGS.has(arg.slice(0, equals))) {
      redacted.push(`${arg.slice(0, equals)}=${REDACTED_VALUE}`);
      continue;
    }
    redacted.push(arg);
  }
  return redacted;
}

/** The argv tokens after the first occurrence of the command name (argv[0]/argv[1] are paths). */
export function argsAfterCommand(rawArgs: readonly string[], command: string): string[] {
  const index = rawArgs.indexOf(command);
  return index === -1 ? [] : rawArgs.slice(index + 1);
}

/** The argv the root program parsed (commander keeps it as an untyped `rawArgs` field). */
function parsedArgv(root: Command): readonly string[] {
  const raw: unknown = Reflect.get(root, 'rawArgs');
  return Array.isArray(raw) && raw.every((item): item is string => typeof item === 'string') ? raw : process.argv;
}

/** `process.exitCode ?? code`, as a number; a non-numeric exitCode falls back to the exit code. */
export function effectiveExitCode(exitCode: number | string | undefined, code: number): number {
  if (exitCode === undefined) return code;
  const parsed = Number(exitCode);
  return Number.isInteger(parsed) ? parsed : code;
}

/**
 * Append exactly one JSON line with a single `appendFileSync` (one `write(2)` on an O_APPEND fd, so
 * concurrent writers never interleave within a line). Never creates directories.
 */
export function appendRunLogRecord(file: string, record: RunLogRecord): RunLogWriteResult {
  try {
    if (!directoryExists(path.dirname(file))) return { ok: false, reason: `log directory does not exist: ${path.dirname(file)}` };
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    return { ok: true, file };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// Per-process state: a CLI process runs exactly one command, so one pending record suffices. A
// second preAction in the same process (in-process tests) replaces it instead of stacking listeners.
interface PendingRecord {
  file: string;
  startedAt: number;
  startedMono: number;
  record: Omit<CommandRecord, 'exitCode' | 'ms' | 'phases'>;
}

let pending: PendingRecord | null = null;
let processListenersInstalled = false;
let lastWrite: RunLogWriteResult | null = null;
const phases: PhaseTiming[] = [];
let verdict: string | null = null;

/** Record the status a verdict command reported, so a non-pass exit is told apart from an error. */
export function recordVerdict(status: string): void {
  verdict = status;
}

/** Record a measured phase for the current command record. Non-finite durations are not recorded. */
export function markPhase(name: string, ms: number): void {
  if (name === '' || !Number.isFinite(ms)) return;
  phases.push({ name, ms: Math.max(0, Math.round(ms)) });
}

/** Time `fn` as a named phase; the phase is recorded whether `fn` resolves or rejects. */
export async function timePhase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    markPhase(name, performance.now() - started);
  }
}

/** Synchronous {@link timePhase}: the phase is recorded whether `fn` returns or throws. */
export function timePhaseSync<T>(name: string, fn: () => T): T {
  const started = performance.now();
  try {
    return fn();
  } finally {
    markPhase(name, performance.now() - started);
  }
}

/** Phases recorded since the current command started. */
export function recordedPhases(): readonly PhaseTiming[] {
  return phases;
}

/** The outcome of the last record write in this process (null: nothing was due). Never printed. */
export function lastRunLogWrite(): RunLogWriteResult | null {
  return lastWrite;
}

export interface CommandStart {
  invocation: RunLogInvocation;
  /** Raw argv tokens after the command name. */
  args: readonly string[];
  env: RunLogEnv;
  now?: number;
}

/**
 * Begin the record for one command. Returns the file the record will go to (null: none). Resets the
 * phase list so phases from an earlier in-process command never leak into this record.
 */
export function beginCommandRecord(start: CommandStart): string | null {
  phases.length = 0;
  verdict = null;
  lastWrite = null;
  const file = resolveRunLogFile(start.invocation, start.env);
  if (file === null) {
    pending = null;
    return null;
  }
  const startedAt = start.now ?? Date.now();
  pending = {
    file,
    startedAt,
    startedMono: performance.now(),
    record: {
      v: 1,
      kind: 'command',
      at: new Date(startedAt).toISOString(),
      command: start.invocation.command,
      args: redactArgs(start.args),
      cwd: start.invocation.cwd,
      pid: process.pid,
      ppid: process.ppid,
      version: VERSION,
      agent: runLogAgent(start.env),
    },
  };
  return file;
}

/** Write the pending record (if any) once; later calls are no-ops until the next begin. */
export function finishCommandRecord(exitCode: number): RunLogWriteResult | null {
  const current = pending;
  pending = null;
  if (current === null) return null;
  const record: CommandRecord = {
    ...current.record,
    exitCode,
    ms: Math.max(0, Math.round(performance.now() - current.startedMono)),
    ...(phases.length > 0 ? { phases: [...phases] } : {}),
    ...(verdict !== null ? { verdict } : {}),
  };
  lastWrite = appendRunLogRecord(current.file, record);
  return lastWrite;
}

function onProcessExit(code: number): void {
  // An exit listener that throws would replace the command's exit status; nothing may escape.
  try {
    finishCommandRecord(effectiveExitCode(process.exitCode, code));
  } catch (error) {
    lastWrite = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Signals whose default disposition ends the process without an `exit` event. */
export const TERMINATING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
export type TerminatingSignal = (typeof TERMINATING_SIGNALS)[number];

/** The shell's status for a process ended by `signal`: 128 + the signal number. */
export function signalExitCode(signal: TerminatingSignal): number {
  return 128 + os.constants.signals[signal];
}

const signalListeners = new Map<TerminatingSignal, () => void>();

/**
 * A listener that only acts when it is the sole listener for the signal. When the command owns the
 * signal (serve's shutdown, Playwright's browser cleanup) the process ends through `exit` and that
 * listener writes the record. Otherwise the signal would have killed the process by its default
 * disposition: write the record, remove every run-log signal listener (which restores the default
 * disposition) and re-raise, so the process still ends by that signal exactly as it would have.
 */
function onTerminatingSignal(signal: TerminatingSignal): void {
  if (process.listenerCount(signal) > 1) return;
  try {
    finishCommandRecord(signalExitCode(signal));
  } catch (error) {
    lastWrite = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  for (const [name, listener] of signalListeners) process.removeListener(name, listener);
  signalListeners.clear();
  try {
    // Windows delivers SIGHUP to listeners but cannot send it; SIGTERM terminates the same way there.
    process.kill(process.pid, process.platform === 'win32' && signal === 'SIGHUP' ? 'SIGTERM' : signal);
  } catch (error) {
    // Unreachable for these signals on supported platforms; never throw out of a signal listener.
    process.exitCode = signalExitCode(signal);
    lastWrite = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function installProcessListeners(): void {
  if (processListenersInstalled) return;
  process.once('exit', onProcessExit);
  for (const signal of TERMINATING_SIGNALS) {
    const listener = (): void => onTerminatingSignal(signal);
    signalListeners.set(signal, listener);
    process.on(signal, listener);
  }
  processListenersInstalled = true;
}

/**
 * Commander `preAction` hook (registered on the root program, so it sees every subcommand action).
 * Never throws: a failure here is recorded in {@link lastRunLogWrite} and the command runs normally.
 */
export function runLogPreAction(root: Command, action: Command): void {
  try {
    const command = action.name();
    const file = beginCommandRecord({
      invocation: { command, operands: action.processedArgs, options: action.opts(), cwd: process.cwd() },
      args: argsAfterCommand(parsedArgv(root), command),
      env: process.env,
    });
    if (file !== null) installProcessListeners();
  } catch (error) {
    pending = null;
    lastWrite = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
