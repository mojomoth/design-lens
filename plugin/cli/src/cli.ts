/**
 * The design-lens commander program.
 *
 * Kept as a pure factory (no `parse`, no `process.exit`) so unit tests can drive it in-process
 * with `exitOverride()`/`configureOutput()` and assert output without spawning a process. It
 * registers the capture and measurement commands (clone/tokens/inspect/screenshot/serve/verify/
 * fidelity/validate-design/tone), the build checks (qa/qa-confirm), `runlog`, and `setup`
 * (ADR-016 hook-less provisioning), alongside the locked `--version` flag.
 */

import { Command } from 'commander';
import { VERSION } from './version.js';
import { registerCloneCommand } from './commands/clone.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerScreenshotCommand } from './commands/screenshot.js';
import { registerServeCommand } from './commands/serve.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerTokensCommand } from './commands/tokens.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerFidelityCommand } from './commands/fidelity.js';
import { registerValidateDesignCommand } from './commands/validate-design.js';
import { registerToneCommand } from './commands/tone.js';
import { registerQaCommand } from './commands/qa.js';
import { registerQaConfirmCommand } from './commands/qa-confirm.js';
import { registerRunlogCommand } from './commands/runlog.js';
import { runLogPreAction } from './lib/runlog.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('design-lens')
    .description('Capture reference pages and measure design evidence for frontend development.')
    // Long flag only (spec 00-product lists `--version`); prints VERSION then exits 0.
    .version(VERSION, '--version', 'print the design-lens version and exit');
  registerCloneCommand(program);
  registerTokensCommand(program);
  registerInspectCommand(program);
  registerScreenshotCommand(program);
  registerServeCommand(program);
  registerVerifyCommand(program);
  registerFidelityCommand(program);
  registerValidateDesignCommand(program);
  registerToneCommand(program);
  registerQaCommand(program);
  registerQaConfirmCommand(program);
  registerRunlogCommand(program);
  registerSetupCommand(program);
  // Run log: every subcommand action is recorded once, at process exit, beside (never inside) the
  // project. The hook never throws and never writes to stdout or stderr.
  program.hook('preAction', runLogPreAction);
  return program;
}
