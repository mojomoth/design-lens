import type { Command } from 'commander';

import { runTone } from '../analyze/tone.js';
import { markPhase } from '../lib/runlog.js';

export { runTone } from '../analyze/tone.js';

export function registerToneCommand(program: Command): void {
  program.command('tone')
    .argument('<projectDir>', 'a clone project with saved source evidence')
    .description('Measure pixel-derived tone (light/mid/dark shares, full-bleed dark bands) of every captured full-page screenshot into tone.json.')
    .option('--json', 'print the complete tone.json document')
    .action(async (projectDir: string, options: { json?: boolean }): Promise<void> => {
      try {
        const result = await runTone(projectDir, markPhase);
        for (const warning of result.warnings) process.stderr.write(`design-lens: warning: ${warning}\n`);
        for (const capture of result.document.captures) {
          const profile = capture.profile;
          if (profile) {
            process.stderr.write(`design-lens: tone ${capture.captureId} (${capture.viewport.width}x${capture.viewport.height}): darkShare ${profile.darkShare}, fullBleedDarkShare ${profile.fullBleedDarkShare}, ${profile.darkBandCount} dark band(s), darkUsage ${profile.darkUsage}\n`);
          }
        }
        process.stdout.write(options.json ? `${JSON.stringify(result.document)}\n` : `${JSON.stringify({ out: result.out, captures: result.document.captures.length })}\n`);
        if (result.profiles === 0) {
          process.stderr.write('error: no full-page screenshot could be profiled\n');
          process.exitCode = 1;
        }
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
