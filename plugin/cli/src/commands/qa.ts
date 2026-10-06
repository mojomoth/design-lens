import type { Command } from 'commander';

import { QA_DEFAULT_MAX_CLICKS, QA_DEFAULT_TIMEOUT_S, QA_DEFAULT_VIEWPORTS, resolveQaOptions, runQa, type QaRawOptions } from '../analyze/qa-run.js';
import { markPhase, recordVerdict, timePhase, type PhaseTiming } from '../lib/runlog.js';

export { resolveQaOptions, runQa } from '../analyze/qa-run.js';

/**
 * Run-log phases from the per-viewport `timings` qa.json already stores. Viewports run one after
 * another, so each named phase is summed across viewports (first-seen order). The remainder of each
 * viewport's `total` becomes `viewport-other` and the run time outside every viewport (server,
 * browser launch, lineage, review images, writes) becomes `other`, so the phases partition the run.
 */
export function qaRunPhases(viewportTimings: ReadonlyArray<Readonly<Record<string, number>>>, runMs: number): PhaseTiming[] {
  const sums = new Map<string, number>();
  let viewportsMs = 0;
  let viewportOther = 0;
  for (const timings of viewportTimings) {
    let named = 0;
    for (const [name, ms] of Object.entries(timings)) {
      if (name === 'total' || !Number.isFinite(ms)) continue;
      sums.set(name, (sums.get(name) ?? 0) + ms);
      named += ms;
    }
    const total = Number.isFinite(timings.total) ? timings.total : named;
    viewportsMs += total;
    viewportOther += Math.max(0, total - named);
  }
  const phases: PhaseTiming[] = [...sums].map(([name, ms]) => ({ name, ms }));
  if (viewportTimings.length > 0) phases.push({ name: 'viewport-other', ms: viewportOther });
  phases.push({ name: 'other', ms: Math.max(0, runMs - viewportsMs) });
  return phases;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerQaCommand(program: Command): void {
  program.command('qa')
    .description('Render a build at each viewport and check for dead controls, stand-in links, covered controls, clipped content, flattened icons, unsourced numbers and (with --project) reference reuse, Build contract drift and lineage; writes screenshots, review images and qa.json.')
    .option('--url <url>', 'the build to check (http/https, e.g. a dev server)')
    .option('--dir <buildDir>', 'a static build directory containing index.html (served on loopback for the run)')
    .option('--project <projectDir>', 'the clone project the build was designed from (evidence, manifest, VARIATIONS.md)')
    .option('--mode <mode>', 'derive or clone-base (default: the Build contract mode, else derive); needs --project')
    .option('--content <file>', 'a content/fact source the page copy must come from (repeatable)', collect, [])
    .option('--brand <text>', 'a source brand that must not remain in the build (repeatable)', collect, [])
    .option('--viewports <list>', `viewports to check (default: the evidence capture viewports with --project, else ${QA_DEFAULT_VIEWPORTS})`)
    .option('--out <dir>', 'output directory (must not exist; default <projectDir>/qa/<runId> or ./.design-lens/qa/<runId>)')
    .option('--max-clicks <n>', `controls clicked per viewport, 0-200 (default ${QA_DEFAULT_MAX_CLICKS})`)
    .option('--timeout <s>', `whole-run budget in seconds (default ${QA_DEFAULT_TIMEOUT_S})`)
    .option('--json', 'print the complete qa.json report')
    .action(async (options: QaRawOptions & { json?: boolean }): Promise<void> => {
      try {
        const resolved = await timePhase('resolve', () => resolveQaOptions(options, process.cwd()));
        const runStarted = performance.now();
        const result = await runQa(resolved);
        const runMs = performance.now() - runStarted;
        for (const phase of qaRunPhases(result.report.viewports.map((viewport) => viewport.timings), runMs)) markPhase(phase.name, phase.ms);
        for (const viewport of result.report.viewports) {
          for (const finding of viewport.findings) {
            process.stderr.write(`design-lens: ${finding.severity} ${finding.check} ${finding.viewport}${finding.selector ? ` ${finding.selector}` : ''}: ${finding.detail.replace(/\s+/g, ' ')}\n`);
          }
        }
        for (const entry of result.report.skipped.filter((item) => item.affectsStatus)) {
          process.stderr.write(`design-lens: warning: skipped ${entry.check}${entry.viewport ? ` ${entry.viewport}` : ''}: ${entry.reason}\n`);
        }
        process.stderr.write(`design-lens: qa ${result.report.status} (${result.report.counts.fail} fail, ${result.report.counts.warn} warn); open every review image (each shows 6 yellow badge characters; read them left to right), then run design-lens qa-confirm ${result.out} --codes <one code per image, in order>\n`);
        process.stdout.write(options.json
          ? `${JSON.stringify(result.report)}\n`
          : `${JSON.stringify({ status: result.report.status, out: result.out, counts: result.report.counts, review: result.reviewPaths })}\n`);
        recordVerdict(result.report.status);
        if (result.report.status !== 'pass') process.exitCode = 1;
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
