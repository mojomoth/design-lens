/**
 * The `runlog <dir>` command — phase marks and a summary of the local run log.
 *
 * Skills and their helper subagents bracket their work with `--mark <phase> --event start|end` so
 * that the per-command records the CLI already appends (lib/runlog.ts) can be attributed to phases
 * and agents afterwards; `--summary` (the default without `--mark`) folds both kinds of line into
 * per-phase windows, per-command and per-agent counts, token notes and the phase timings commands
 * recorded about themselves. This command's own invocations are never logged.
 *
 * Unlike the automatic command record, an explicit mark that cannot be written is an error: the
 * caller asked for exactly that write. `DESIGN_LENS_RUNLOG=off` still wins (nothing is written) and
 * an absolute `DESIGN_LENS_RUNLOG` names the file for marks and summaries alike, so marks always
 * land beside the command records they describe.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import {
  appendRunLogRecord,
  directoryExists,
  MARK_EVENTS,
  MARK_PHASE_PATTERN,
  nearestDesignLensDir,
  runLogAgent,
  runLogDisabled,
  runLogOverride,
  RUNLOG_DIR_NAME,
  RUNLOG_ENV,
  RUNLOG_FILE_NAME,
  type CommandRecord,
  type MarkEvent,
  type MarkRecord,
  type PhaseTiming,
  type RunLogEnv,
  type RunLogRecord,
} from '../lib/runlog.js';

export interface RunlogOptions {
  mark?: string;
  event?: string;
  note?: string;
  tokens?: string;
  summary?: boolean;
  json?: boolean;
}

export interface RunlogPlan {
  dir: string;
  mark: { phase: string; event: MarkEvent; note?: string; tokens?: number } | null;
  summary: boolean;
  json: boolean;
}

/** Validate flags before touching the file system. */
export function planRunlog(dir: string, options: RunlogOptions): RunlogPlan {
  const { mark, event, note, tokens } = options;
  if (mark === undefined) {
    if (event !== undefined) throw new Error('--event requires --mark <phase>');
    if (note !== undefined || tokens !== undefined) throw new Error('--note and --tokens require --mark <phase>');
    return { dir, mark: null, summary: true, json: options.json === true };
  }
  if (!MARK_PHASE_PATTERN.test(mark)) {
    throw new Error(`invalid --mark "${mark}"; expected a phase name matching ${MARK_PHASE_PATTERN.source}`);
  }
  const markEvent = MARK_EVENTS.find((candidate) => candidate === event);
  if (markEvent === undefined) throw new Error(`--mark requires --event ${MARK_EVENTS.join('|')}`);
  let tokenCount: number | undefined;
  if (tokens !== undefined) {
    tokenCount = Number(tokens);
    if (!/^\d+$/.test(tokens.trim()) || !Number.isSafeInteger(tokenCount)) {
      throw new Error(`invalid --tokens "${tokens}"; expected a non-negative integer`);
    }
  }
  return {
    dir,
    mark: { phase: mark, event: markEvent, ...(note !== undefined ? { note } : {}), ...(tokenCount !== undefined ? { tokens: tokenCount } : {}) },
    summary: options.summary === true,
    json: options.json === true,
  };
}

/** `disabled`: `DESIGN_LENS_RUNLOG` turns writing off; the default-located file is still readable. */
export interface RunlogLocation {
  file: string;
  disabled: boolean;
}

/**
 * `<dir>` must exist. The log dir is `<dir>` when it is named `.design-lens`, else its nearest
 * `.design-lens` ancestor, else `<dir>/.design-lens` when that exists; anything else is an error.
 * An absolute `DESIGN_LENS_RUNLOG` names the file exactly as it does for command records.
 */
export function resolveRunlogLocation(
  dir: string,
  env: RunLogEnv,
  isDirectory: (candidate: string) => boolean = directoryExists,
): RunlogLocation {
  const absolute = path.resolve(dir);
  if (!isDirectory(absolute)) throw new Error(`not a directory: ${absolute}`);
  const disabled = runLogDisabled(env);
  const override = runLogOverride(env);
  if (override !== null) return { file: override, disabled };
  const ancestor = nearestDesignLensDir(absolute);
  if (ancestor !== null) return { file: path.join(ancestor, RUNLOG_FILE_NAME), disabled };
  const child = path.join(absolute, RUNLOG_DIR_NAME);
  if (isDirectory(child)) return { file: path.join(child, RUNLOG_FILE_NAME), disabled };
  throw new Error(`no ${RUNLOG_DIR_NAME} directory at or above ${absolute}, and ${child} does not exist`);
}

export interface ParsedRunLog {
  records: RunLogRecord[];
  invalidLines: number;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgent(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPhaseList(value: unknown): value is PhaseTiming[] {
  return Array.isArray(value) && value.every((item) =>
    isRecordObject(item) && typeof item.name === 'string' && typeof item.ms === 'number' && Number.isFinite(item.ms));
}

function toRecord(value: unknown): RunLogRecord | null {
  if (!isRecordObject(value) || value.v !== 1 || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return null;
  if (!isAgent(value.agent)) return null;
  if (value.kind === 'command') {
    if (typeof value.command !== 'string' || typeof value.exitCode !== 'number' || typeof value.ms !== 'number' || !Number.isFinite(value.ms)) return null;
    if (value.phases !== undefined && !isPhaseList(value.phases)) return null;
    if (value.verdict !== undefined && typeof value.verdict !== 'string') return null;
    return value as unknown as CommandRecord;
  }
  if (value.kind === 'mark') {
    if (typeof value.phase !== 'string' || !MARK_EVENTS.some((event) => event === value.event)) return null;
    if (value.note !== undefined && typeof value.note !== 'string') return null;
    if (value.tokens !== undefined && (typeof value.tokens !== 'number' || !Number.isFinite(value.tokens))) return null;
    return value as unknown as MarkRecord;
  }
  return null;
}

/** Parse JSONL leniently: a line that is not a well-formed record is counted, never fatal. */
export function parseRunLog(text: string): ParsedRunLog {
  const records: RunLogRecord[] = [];
  let invalidLines = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }
    const record = toRecord(parsed);
    if (record === null) invalidLines += 1;
    else records.push(record);
  }
  return { records, invalidLines };
}

export interface PhaseWindow {
  phase: string;
  agent: string | null;
  start: string;
  /** null while no matching `end` or `abort` mark exists. */
  end: string | null;
  ms: number | null;
  /** Present when an `abort` mark closed the window: the work was interrupted, its time is not a phase cost. */
  aborted?: true;
  /** Command records whose start lies inside the window (an open window extends to the log's end). */
  commands: number;
  commandMs: number;
  byCommand: Record<string, number>;
}

export interface RunLogSummary {
  log: string;
  records: number;
  invalidLines: number;
  span: { from: string; to: string; ms: number } | null;
  windows: PhaseWindow[];
  /** `ms` sums completed windows only; aborted windows are counted and timed apart (keys present when any). */
  phases: Array<{ phase: string; windows: number; open: number; ms: number; commands: number; aborted?: number; abortedMs?: number }>;
  unmatchedEnds: Array<{ phase: string; agent: string | null; at: string }>;
  commands: {
    count: number;
    /** Non-zero exits; `verdicts` (present when any) counts those that were a reported non-pass verdict, not an error. */
    failed: number;
    verdicts?: number;
    ms: number;
    byCommand: Array<{ command: string; count: number; failed: number; verdicts?: number; ms: number }>;
  };
  agents: Array<{ agent: string | null; commands: number; marks: number; commandMs: number }>;
  tokens: {
    total: number;
    notes: Array<{ at: string; phase: string; event: MarkEvent; agent: string | null; tokens?: number; note?: string }>;
  };
  commandPhases: Array<{ command: string; phase: string; count: number; ms: number }>;
}

function getOrInsert<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

/**
 * Fold records into the summary. Marks pair per (phase, agent), most recent unmatched start first,
 * so concurrent helpers marking the same phase name never close each other's windows.
 */
export function summarizeRunLog(log: string, parsed: ParsedRunLog): RunLogSummary {
  const ordered = parsed.records
    .map((record, index) => ({ record, index, time: Date.parse(record.at) }))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  const commandEntries = ordered.filter((entry): entry is { record: CommandRecord; index: number; time: number } =>
    entry.record.kind === 'command');

  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const { record, time } of ordered) {
    from = Math.min(from, time);
    to = Math.max(to, record.kind === 'command' ? time + record.ms : time);
  }
  const span = ordered.length === 0
    ? null
    : { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ms: Math.round(to - from) };

  interface OpenStart { phase: string; agent: string | null; time: number; at: string }
  const openStarts = new Map<string, OpenStart[]>();
  const closed: Array<{ start: OpenStart; endTime: number | null; endAt: string | null; aborted: boolean }> = [];
  const unmatchedEnds: RunLogSummary['unmatchedEnds'] = [];
  const notes: RunLogSummary['tokens']['notes'] = [];
  let tokenTotal = 0;

  for (const { record, time } of ordered) {
    if (record.kind !== 'mark') continue;
    const key = JSON.stringify([record.phase, record.agent]);
    if (record.event === 'start') {
      getOrInsert(openStarts, key, () => []).push({ phase: record.phase, agent: record.agent, time, at: record.at });
    } else {
      const start = openStarts.get(key)?.pop();
      if (start === undefined) unmatchedEnds.push({ phase: record.phase, agent: record.agent, at: record.at });
      else closed.push({ start, endTime: time, endAt: record.at, aborted: record.event === 'abort' });
    }
    if (record.tokens !== undefined || record.note !== undefined) {
      notes.push({
        at: record.at, phase: record.phase, event: record.event, agent: record.agent,
        ...(record.tokens !== undefined ? { tokens: record.tokens } : {}),
        ...(record.note !== undefined ? { note: record.note } : {}),
      });
      tokenTotal += record.tokens ?? 0;
    }
  }
  for (const starts of openStarts.values()) {
    for (const start of starts) closed.push({ start, endTime: null, endAt: null, aborted: false });
  }
  closed.sort((a, b) => a.start.time - b.start.time);

  const windows: PhaseWindow[] = closed.map(({ start, endTime, endAt, aborted }) => {
    const inside = commandEntries.filter(({ time }) => time >= start.time && (endTime === null || time <= endTime));
    const byCommand: Record<string, number> = {};
    for (const { record } of inside) byCommand[record.command] = (byCommand[record.command] ?? 0) + 1;
    return {
      phase: start.phase,
      agent: start.agent,
      start: start.at,
      end: endAt,
      ms: endTime === null ? null : Math.round(endTime - start.time),
      ...(aborted ? { aborted: true as const } : {}),
      commands: inside.length,
      commandMs: inside.reduce((sum, { record }) => sum + record.ms, 0),
      byCommand,
    };
  });

  const phaseTotals = new Map<string, RunLogSummary['phases'][number]>();
  for (const window of windows) {
    const total = getOrInsert(phaseTotals, window.phase, (): RunLogSummary['phases'][number] => ({ phase: window.phase, windows: 0, open: 0, ms: 0, commands: 0 }));
    total.windows += 1;
    if (window.ms === null) total.open += 1;
    else if (window.aborted) {
      total.aborted = (total.aborted ?? 0) + 1;
      total.abortedMs = (total.abortedMs ?? 0) + window.ms;
    } else total.ms += window.ms;
    total.commands += window.commands;
  }

  const byCommand = new Map<string, RunLogSummary['commands']['byCommand'][number]>();
  const agents = new Map<string, RunLogSummary['agents'][number]>();
  const commandPhases = new Map<string, RunLogSummary['commandPhases'][number]>();
  let failed = 0;
  let verdicts = 0;
  let commandMs = 0;
  for (const { record } of ordered) {
    const agent = getOrInsert(agents, JSON.stringify(record.agent), () => ({ agent: record.agent, commands: 0, marks: 0, commandMs: 0 }));
    if (record.kind === 'mark') {
      agent.marks += 1;
      continue;
    }
    agent.commands += 1;
    agent.commandMs += record.ms;
    const entry = getOrInsert(byCommand, record.command, (): RunLogSummary['commands']['byCommand'][number] => ({ command: record.command, count: 0, failed: 0, ms: 0 }));
    entry.count += 1;
    entry.ms += record.ms;
    commandMs += record.ms;
    if (record.exitCode !== 0) {
      entry.failed += 1;
      failed += 1;
      if (record.verdict !== undefined && record.verdict !== 'pass') {
        entry.verdicts = (entry.verdicts ?? 0) + 1;
        verdicts += 1;
      }
    }
    for (const phase of record.phases ?? []) {
      const timing = getOrInsert(commandPhases, JSON.stringify([record.command, phase.name]), () =>
        ({ command: record.command, phase: phase.name, count: 0, ms: 0 }));
      timing.count += 1;
      timing.ms += phase.ms;
    }
  }

  return {
    log,
    records: parsed.records.length,
    invalidLines: parsed.invalidLines,
    span,
    windows,
    phases: [...phaseTotals.values()],
    unmatchedEnds,
    commands: { count: commandEntries.length, failed, ...(verdicts > 0 ? { verdicts } : {}), ms: commandMs, byCommand: [...byCommand.values()] },
    agents: [...agents.values()],
    tokens: { total: tokenTotal, notes },
    commandPhases: [...commandPhases.values()],
  };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function agentLabel(agent: string | null): string {
  return agent === null ? '(no agent)' : agent;
}

function countsLabel(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length === 0 ? '' : ` (${entries.map(([name, count]) => `${name} ${count}`).join(', ')})`;
}

/** The compact human table printed to stderr when `--json` is absent. */
export function formatRunLogSummary(summary: RunLogSummary): string {
  const lines: string[] = [];
  const invalid = summary.invalidLines > 0 ? `, ${summary.invalidLines} unreadable lines skipped` : '';
  lines.push(`Run log: ${summary.log} (${summary.records} records${invalid})`);
  if (summary.span !== null) lines.push(`Span: ${summary.span.from} .. ${summary.span.to} (${seconds(summary.span.ms)})`);
  const origin = summary.span === null ? 0 : Date.parse(summary.span.from);
  if (summary.windows.length > 0) {
    lines.push('Phases:');
    for (const window of summary.windows) {
      const offset = `+${seconds(Date.parse(window.start) - origin)}`;
      const duration = window.ms === null ? 'open' : `${seconds(window.ms)}${window.aborted ? ' aborted' : ''}`;
      lines.push(`  ${window.phase} [${agentLabel(window.agent)}] ${offset} ${duration} ${window.commands} commands${countsLabel(window.byCommand)}`);
    }
  }
  for (const end of summary.unmatchedEnds) lines.push(`  ${end.phase} [${agentLabel(end.agent)}] end without start at ${end.at}`);
  if (summary.phases.length > 0) {
    lines.push('Phase totals:');
    for (const phase of summary.phases) {
      const open = phase.open > 0 ? ` (${phase.open} open)` : '';
      const aborted = phase.aborted ? `; ${phase.aborted} aborted ${seconds(phase.abortedMs ?? 0)} not counted` : '';
      lines.push(`  ${phase.phase} ${phase.windows} windows${open} ${seconds(phase.ms)} ${phase.commands} commands${aborted}`);
    }
  }
  const failedLabel = (failed: number, verdictCount: number | undefined): string =>
    verdictCount ? `${failed} failed: ${verdictCount} verdict, ${failed - verdictCount} error` : `${failed} failed`;
  lines.push(`Commands: ${summary.commands.count} (${failedLabel(summary.commands.failed, summary.commands.verdicts)}) ${seconds(summary.commands.ms)}`);
  for (const entry of summary.commands.byCommand) {
    lines.push(`  ${entry.command} ${entry.count} (${failedLabel(entry.failed, entry.verdicts)}) ${seconds(entry.ms)}`);
  }
  if (summary.agents.length > 0) {
    lines.push('Agents:');
    for (const agent of summary.agents) {
      lines.push(`  ${agentLabel(agent.agent)} ${agent.commands} commands ${agent.marks} marks ${seconds(agent.commandMs)}`);
    }
  }
  if (summary.tokens.notes.length > 0) {
    lines.push(`Token notes: ${summary.tokens.total} tokens`);
    for (const note of summary.tokens.notes) {
      const tokens = note.tokens === undefined ? '' : ` ${note.tokens} tokens`;
      const text = note.note === undefined ? '' : ` ${JSON.stringify(note.note)}`;
      lines.push(`  ${note.phase} ${note.event} [${agentLabel(note.agent)}]${tokens}${text}`);
    }
  }
  if (summary.commandPhases.length > 0) {
    lines.push('Command phases:');
    for (const timing of summary.commandPhases) {
      lines.push(`  ${timing.command} ${timing.phase} ${timing.count}x ${seconds(timing.ms)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function readLogText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

export interface RunlogResult {
  file: string;
  /** True when a requested mark was not written because `DESIGN_LENS_RUNLOG` disables the log. */
  disabled: boolean;
  mark: MarkRecord | null;
  summary: RunLogSummary | null;
}

export function runRunlog(plan: RunlogPlan, env: RunLogEnv = process.env, now: () => number = Date.now): RunlogResult {
  const location = resolveRunlogLocation(plan.dir, env);
  let mark: MarkRecord | null = null;
  if (plan.mark !== null && !location.disabled) {
    mark = {
      v: 1,
      kind: 'mark',
      at: new Date(now()).toISOString(),
      phase: plan.mark.phase,
      event: plan.mark.event,
      ...(plan.mark.note !== undefined ? { note: plan.mark.note } : {}),
      ...(plan.mark.tokens !== undefined ? { tokens: plan.mark.tokens } : {}),
      agent: runLogAgent(env),
    };
    const written = appendRunLogRecord(location.file, mark);
    if (!written.ok) throw new Error(`could not record the mark in ${location.file}: ${written.reason}`);
  }
  const summary = plan.summary ? summarizeRunLog(location.file, parseRunLog(readLogText(location.file))) : null;
  return { file: location.file, disabled: plan.mark !== null && location.disabled, mark, summary };
}

export function registerRunlogCommand(program: Command): void {
  program
    .command('runlog')
    .argument('<dir>', 'a .design-lens directory, or a directory at or below one (e.g. a project)')
    .description('Record phase marks in the local run log and summarize it.')
    .option('--mark <phase>', 'append a phase mark (lowercase letters, digits and dashes); requires --event')
    .option('--event <event>', 'start|end|abort, the mark event (abort closes a window whose work was interrupted)')
    .option('--note <text>', 'free-text note stored with the mark')
    .option('--tokens <n>', 'token count stored with the mark')
    .option('--summary', 'summarize the run log (the default without --mark)')
    .option('--json', 'print the summary as JSON to stdout instead of a table on stderr')
    .action((dir: string, options: RunlogOptions): void => {
      try {
        const plan = planRunlog(dir, options);
        const result = runRunlog(plan);
        if (result.disabled) process.stderr.write(`design-lens: run log disabled by ${RUNLOG_ENV}; mark not recorded\n`);
        if (plan.mark !== null) {
          if (plan.summary) {
            if (result.mark !== null) process.stderr.write(`design-lens: recorded ${result.mark.phase} ${result.mark.event} in ${result.file}\n`);
          } else {
            process.stdout.write(`${JSON.stringify({ out: result.mark === null ? null : result.file, mark: result.mark })}\n`);
          }
        }
        if (result.summary !== null) {
          if (plan.json) process.stdout.write(`${JSON.stringify(result.summary)}\n`);
          else process.stderr.write(formatRunLogSummary(result.summary));
        }
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
