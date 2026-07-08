/**
 * The design-lens commander program.
 *
 * Kept as a pure factory (no `parse`, no `process.exit`) so unit tests can drive it in-process
 * with `exitOverride()`/`configureOutput()` and assert output without spawning a process. All
 * six subcommands (clone/tokens/inspect/screenshot/serve/verify — spec 00-product §Interfaces)
 * are registered here, alongside the locked `--version` flag.
 */

import { Command } from 'commander';
import { VERSION } from './version.js';
import { registerCloneCommand } from './commands/clone.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerScreenshotCommand } from './commands/screenshot.js';
import { registerServeCommand } from './commands/serve.js';
import { registerTokensCommand } from './commands/tokens.js';
import { registerVerifyCommand } from './commands/verify.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('design-lens')
    .description('Clone a reference site into an editable local mirror.')
    // Long flag only (spec 00-product lists `--version`); prints VERSION then exits 0.
    .version(VERSION, '--version', 'print the design-lens version and exit');
  registerCloneCommand(program);
  registerTokensCommand(program);
  registerInspectCommand(program);
  registerScreenshotCommand(program);
  registerServeCommand(program);
  registerVerifyCommand(program);
  return program;
}
