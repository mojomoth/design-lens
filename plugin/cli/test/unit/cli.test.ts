import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { VERSION } from '../../src/version.js';

// why: spec 00-product §Product identity requires `design-lens --version` to emit EXACTLY the
// locked `0.4.0`, byte-identical to package.json and both plugin manifests (the strict gate's S4
// version lock and the T27 provenance stamp both depend on it). This drives the real commander
// program in-process; if the flag name, the emitted string, or the VERSION source regressed, the
// dual-tool install verification and provenance would silently diverge and this test goes red.
describe('design-lens --version', () => {
  it('emits the locked version 0.4.0 on stdout and exits successfully', () => {
    const program = buildProgram();
    let out = '';
    // exitOverride turns commander's process.exit into a thrown CommanderError so the test never
    // tears down the vitest worker; configureOutput captures what would have hit the real streams.
    program.exitOverride();
    program.configureOutput({
      writeOut: (str) => {
        out += str;
      },
      writeErr: (str) => {
        out += str;
      },
    });
    let exitCode: number | undefined;
    try {
      program.parse(['--version'], { from: 'user' });
    } catch (err) {
      // commander signals the `--version` short-circuit via a CommanderError with exitCode 0.
      exitCode = (err as { exitCode?: number }).exitCode;
    }
    expect(out.trim()).toBe('0.4.0');
    expect(exitCode).toBe(0);
  });

  it('keeps the exported VERSION constant equal to the locked 0.4.0 (single source of truth)', () => {
    // why: every version consumer (CLI flag, manifests, provenance) reads this constant; pinning
    // it here means a stray bump can only pass once all lockstep artifacts are updated together.
    expect(VERSION).toBe('0.4.0');
  });
});
