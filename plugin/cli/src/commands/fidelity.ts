import type { Command } from 'commander';

import { runFidelity } from '../analyze/fidelity.js';

export { runFidelity } from '../analyze/fidelity.js';

export function registerFidelityCommand(program: Command): void {
  program.command('fidelity')
    .argument('<projectDir>', 'a clone project with saved source evidence')
    .description('Compare the current clone offline against the saved source at every captured viewport.')
    .option('--json', 'print the complete machine-readable comparison report')
    .action(async (projectDir: string, options: { json?: boolean }): Promise<void> => {
      try {
        const result = await runFidelity(projectDir);
        if (options.json) process.stdout.write(result.json);
        else {
          process.stderr.write(`Fidelity: ${result.report.status}\n`);
          for (const capture of result.report.captures) {
            process.stderr.write(`${capture.viewport.width}x${capture.viewport.height}: ${capture.status}\n`);
          }
          for (const issue of result.report.issues) process.stderr.write(`${issue}\n`);
          for (const issue of result.report.inertIssues) process.stderr.write(`${issue}\n`);
          process.stderr.write('Detailed measurements and image differences: fidelity.json\n');
        }
        if (result.report.status !== 'pass') process.exitCode = 1;
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
