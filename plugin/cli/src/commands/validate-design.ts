import type { Command } from 'commander';

import { runValidateDesign } from '../analyze/design-validation.js';
import { recordVerdict } from '../lib/runlog.js';

export { runValidateDesign } from '../analyze/design-validation.js';

export function registerValidateDesignCommand(program: Command): void {
  program.command('validate-design')
    .argument('<projectDir>', 'a project containing DESIGN.md, VARIATIONS.md, and captured evidence')
    .description('Validate design recipes and measured claims without changing project files.')
    .option('--json', 'print the complete machine-readable validation report')
    .action(async (projectDir: string, options: { json?: boolean }): Promise<void> => {
      try {
        const result = await runValidateDesign(projectDir);
        if (options.json) process.stdout.write(result.json);
        else {
          process.stderr.write(`Design validation: ${result.report.status}\n`);
          for (const issue of result.report.issues) process.stderr.write(`${issue}\n`);
        }
        recordVerdict(result.report.status);
        if (result.report.status !== 'pass') process.exitCode = 1;
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
