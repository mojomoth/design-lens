import path from 'node:path';

import type { Command } from 'commander';

import { runQaConfirm } from '../analyze/qa-review.js';
import { recordVerdict } from '../lib/runlog.js';

export { generateReviewCode, hashReviewCode, runQaConfirm, verifyReviewCode } from '../analyze/qa-review.js';

export function registerQaConfirmCommand(program: Command): void {
  program.command('qa-confirm')
    .argument('<qaDir>', 'a qa run directory containing qa.json')
    .description('Confirm that every qa review image was viewed by entering the code drawn on each image, in review order; writes review.json.')
    .requiredOption('--codes <codes>', 'comma-separated codes in the order of the review images printed by qa')
    .action(async (qaDir: string, options: { codes: string }): Promise<void> => {
      try {
        const codes = options.codes.split(',');
        const result = await runQaConfirm(qaDir, codes);
        recordVerdict(result.confirmed && result.review ? 'pass' : 'unconfirmed');
        if (!result.confirmed || !result.review) {
          process.stderr.write(`matched ${result.matched} of ${result.total} review images; unconfirmed: ${result.unconfirmed.join(', ') || `(${codes.length} code(s) given for ${result.total} image(s))`}\n`);
          process.exitCode = 1;
          return;
        }
        process.stderr.write(`design-lens: review confirmed (${result.total} images): ${path.resolve(qaDir, 'review.json')}\n`);
        process.stdout.write(`${JSON.stringify(result.review)}\n`);
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
