/**
 * The `serve <projectDir>` command — a loopback preview server for a clone.
 *
 * All the work lives in `lib/static-server.ts`; this module owns validation, the stdout contract,
 * and the one thing no other command needs: staying alive. `inspect` and `screenshot` serve the
 * clone for the duration of one render and tear the server down in a `finally`; `serve` blocks until
 * the user interrupts it, which is why the chosen port must reach stdout BEFORE the process parks
 * (spec 02 §M3 command surface: "`--port <n>` (0 = ephemeral, default; the chosen port is printed to
 * stdout)"). A caller that reads one line of stdout knows where to point a browser.
 *
 * It serves `<projectDir>/clone/`, not the project dir: `manifest.json`, `REPORT.md`, `tokens.json`
 * and `screenshots/` are provenance ABOUT the clone and are not part of the site. `manifest.json`
 * also carries the capture-origin URLs that sealed A4 keeps out of `clone/` — serving the project
 * root would publish them on the preview server.
 *
 * I/O discipline (guardrails / spec 00): the origin/port JSON → stdout, the human "press Ctrl-C"
 * hint and the shutdown notice → stderr. Exit 1 only for a bad `--port`, a project that is not a
 * clone, or a bind failure (e.g. `--port` already taken).
 *
 * Spec: specs/00-product.md §Interfaces; specs/02-clone-engine.md §M3 polish.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { startStaticServer, type StaticServer } from '../lib/static-server.js';

/** The signals a foreground server must shut down cleanly on. */
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export interface ServeOptions {
  /** Raw `--port` string from commander; absent ⇒ ephemeral. */
  port?: string;
}

export interface ServeResult {
  server: StaticServer;
  /** Absolute `<projectDir>/clone` — the served root. */
  cloneDir: string;
  /** The exact bytes written to stdout, trailing newline included. */
  json: string;
}

/**
 * Parse `--port`. Absent ⇒ 0 ⇒ the OS assigns an ephemeral port (the default the spec fixes).
 *
 * Pure and exported so the port grammar is unit-testable without binding a socket (spec 08 forbids
 * listening servers in unit tests). Rejects non-integers up front rather than letting `listen()`
 * coerce them: `Number('80abc')` is NaN and `listen(NaN)` silently binds an ephemeral port, which
 * would answer a typo by serving on a port the user never asked for.
 *
 * @throws on anything that is not an integer in [0, 65535].
 */
export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  const invalid = new Error(`invalid --port "${raw}"; expected an integer between 0 and 65535`);
  if (!/^\d+$/.test(trimmed)) throw invalid;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port > 65535) throw invalid;
  return port;
}

/**
 * Validate the project, bind the server, and hand it back still listening. The caller owns stdout and
 * the shutdown handlers, so this stays callable from a test without installing process-wide signal
 * traps. Throws (⇒ exit 1) on a bad `--port`, a non-clone directory, or a bind failure.
 */
export async function runServe(projectDir: string, options: ServeOptions = {}): Promise<ServeResult> {
  // Validate before binding: a typo in `--port` should never leave a socket open.
  const port = parsePort(options.port);

  const root = path.resolve(projectDir);
  const cloneDir = path.join(root, 'clone');
  const indexPath = path.join(cloneDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`not a design-lens clone project: missing ${indexPath}`);
  }

  const server = await startStaticServer(cloneDir, { port });
  const json = `${JSON.stringify({
    port: server.port,
    origin: server.origin,
    url: server.url('/index.html'),
    root: cloneDir,
  })}\n`;

  process.stderr.write(`design-lens: serving ${cloneDir} at ${server.origin} — press Ctrl-C to stop\n`);
  return { server, cloneDir, json };
}

/**
 * Arm the shutdown handlers NOW (synchronously, in the promise executor) and resolve once a signal
 * has arrived and the server is closed. Resolving lets the process exit naturally: with the listening
 * handle gone and no other work pending Node's loop drains on its own — no `process.exit()`, which
 * would race the stdout flush.
 *
 * Callers MUST invoke this BEFORE announcing the port on stdout. The parent is a separate OS process:
 * the instant those bytes reach the pipe it may signal us back, and on another core that can happen
 * before this function's first statement runs. A SIGTERM landing before the listener is installed
 * kills the process by node's default disposition — the port leaks and the exit status is a signal
 * rather than 0.
 */
function serveUntilSignal(server: StaticServer): Promise<void> {
  return new Promise<void>((resolve) => {
    const shutdown = (signal: string): void => {
      process.stderr.write(`\ndesign-lens: ${signal} received, shutting down\n`);
      void server.close().then(
        () => resolve(),
        (err: unknown) => {
          const detail = err instanceof Error ? err.message : String(err);
          process.stderr.write(`error: ${detail}\n`);
          process.exitCode = 1;
          resolve();
        },
      );
    };
    // `once`, not `on`: a second Ctrl-C should kill a server wedged mid-close, not re-enter shutdown.
    for (const signal of SHUTDOWN_SIGNALS) process.once(signal, () => shutdown(signal));
  });
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .argument('<projectDir>', 'a clone project directory, e.g. .design-lens/example-com')
    .description('Serve <projectDir>/clone/ on 127.0.0.1 until interrupted.')
    .option('--port <n>', 'port to bind; 0 (the default) picks a free ephemeral port')
    .action(async (projectDir: string, options: ServeOptions): Promise<void> => {
      try {
        const { server, json } = await runServe(projectDir, options);
        // Order is load-bearing: arm the signal handlers, THEN announce the port. A caller that reads
        // this line and immediately sends SIGTERM must find a handler already installed (see
        // `serveUntilSignal`). Announcing first loses that race on a multi-core machine.
        const parked = serveUntilSignal(server);
        process.stdout.write(json);
        await parked;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${detail}\n`);
        process.exitCode = 1;
      }
    });
}
