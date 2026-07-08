/**
 * `serve <projectDir>` e2e: clone the `basic` fixture with the BUILT bundle, then serve the on-disk
 * clone and drive it over real HTTP.
 *
 * WHY this exists: `serve` is the one command that does not terminate, and none of its interesting
 * behaviour is reachable from a unit test (spec 08 forbids binding ports there — only `parsePort` is
 * covered in `test/unit/serve.test.ts`). Three contracts can only be proved here:
 *   1. the chosen ephemeral port reaches STDOUT before the process parks — otherwise a caller can
 *      never learn where to point a browser, and the command is useless;
 *   2. `GET /index.html` is 200 and assets resolve, i.e. it serves `<projectDir>/clone/` — while
 *      `manifest.json` (a project-root sibling holding the capture-origin URLs sealed A4 keeps out of
 *      `clone/`) is NOT reachable;
 *   3. Ctrl-C exits 0. This is not cosmetic: `server.close()` waits for open connections, and HTTP
 *      keep-alive means the fetch below holds a socket for seconds after its response. Without
 *      `closeAllConnections()` in `lib/static-server.ts` the process hangs and this test times out —
 *      which is exactly what a user pressing Ctrl-C in a browser session would experience.
 *
 * Tests only ever touch 127.0.0.1 fixtures on ephemeral ports (never 4630/4631, never the live web).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStaticServer, type StaticServer } from '../../src/lib/static-server.js';

/** The committed artifact under test — NOT the TS source (spec 08: e2e drives the built bundle). */
const BUNDLE = fileURLToPath(new URL('../../dist/design-lens.cjs', import.meta.url));
const SITES = fileURLToPath(new URL('../fixtures/sites', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** See clone.test.ts: consent blocking is ON by default, so every run gets a seeded throwaway home. */
const SEEDED_DEFAULT_LIST = '! design-lens e2e stand-in list\n###dl-e2e-remote-list-matches-nothing\n';

function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-home-'));
  const cacheDir = path.join(home, 'cache', 'filterlists');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'fanboy-cookiemonster.txt'), SEEDED_DEFAULT_LIST, 'utf8');
  return home;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], {
      cwd,
      env: { ...process.env, DESIGN_LENS_HOME: tmpHome() },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dl-e2e-'));
}

/** The single JSON line `serve` prints to stdout before it parks. */
interface ServeInfo {
  port: number;
  origin: string;
  url: string;
  root: string;
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ServeHandle {
  child: ChildProcessWithoutNullStreams;
  info: ServeInfo;
  stderr: () => string;
  /** Send `signal` and resolve with how the process actually exited. */
  stop: (signal: NodeJS.Signals) => Promise<Exit>;
}

/**
 * Spawn a long-running `serve` and resolve as soon as it announces its port on stdout. Rejects if the
 * process dies first, so a bind failure surfaces as a readable error instead of a hung test.
 */
async function startServe(args: string[], cwd: string): Promise<ServeHandle> {
  const child = spawn(process.execPath, [BUNDLE, 'serve', ...args], {
    cwd,
    env: { ...process.env, DESIGN_LENS_HOME: tmpHome() },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  const exited = new Promise<Exit>((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });

  const firstLine = await new Promise<string>((resolve, reject) => {
    const check = (): void => {
      const newline = stdout.indexOf('\n');
      if (newline !== -1) resolve(stdout.slice(0, newline));
    };
    child.stdout.on('data', check);
    child.on('close', () => reject(new Error(`serve exited before printing its port. stderr:\n${stderr}`)));
  });

  return {
    child,
    info: JSON.parse(firstLine) as ServeInfo,
    stderr: () => stderr,
    stop: (signal) => {
      child.kill(signal);
      return exited;
    },
  };
}

describe('serve on a basic clone', () => {
  let fixture: StaticServer;
  let out: string;
  let projectDir: string;

  beforeAll(async () => {
    fixture = await startStaticServer(path.join(SITES, 'basic'));
    out = tmpOut();
    const cloned = await runCli(
      ['clone', fixture.url('/index.html'), '--out', out, '--project', 'basic'],
      out,
    );
    expect(cloned.code, `clone failed: ${cloned.stderr}`).toBe(0);
    projectDir = (JSON.parse(cloned.stdout.trim()) as { projectDir: string }).projectDir;
  });

  afterAll(async () => {
    await fixture.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  // why: THE acceptance criterion of T21 — `serve` returns 200 for index.html. It also pins the
  // stdout contract: the ephemeral port must be announced as parseable JSON BEFORE the process parks,
  // or no caller (agent, browser, this test) can ever reach the server it just started.
  it('announces an ephemeral port on stdout and returns 200 for index.html', async () => {
    const serve = await startServe([projectDir], out);
    try {
      expect(serve.info.port).toBeGreaterThan(0);
      expect(serve.info.origin).toBe(`http://127.0.0.1:${serve.info.port}`);
      expect(serve.info.root).toBe(path.join(projectDir, 'clone'));

      const response = await fetch(serve.info.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('Cloned by design-lens');
    } finally {
      await serve.stop('SIGINT');
    }
  });

  // why: a preview server that cannot serve the clone's own stylesheet renders an unstyled page — the
  // relative `assets/…` paths the localize pass wrote must resolve against the served root. And
  // `manifest.json` must NOT: it is a project-root sibling carrying the capture-origin URLs that
  // sealed A4 keeps out of `clone/`, so serving the project dir instead would publish them.
  it('serves clone/ assets but not the project-root manifest', async () => {
    const serve = await startServe([projectDir], out);
    try {
      const overrides = await fetch(`${serve.info.origin}/assets/dl-overrides.css`);
      expect(overrides.status).toBe(200);
      expect(overrides.headers.get('content-type')).toContain('text/css');
      await overrides.text();

      const manifest = await fetch(`${serve.info.origin}/manifest.json`);
      expect(manifest.status).toBe(404);
      await manifest.text();
    } finally {
      await serve.stop('SIGINT');
    }
  });

  // why: Ctrl-C must exit 0, not die by signal and not hang. `server.close()` alone waits for the
  // keep-alive socket the fetch above leaves open, so this asserts `closeAllConnections()` is still
  // in `lib/static-server.ts`. `code: 0` (rather than `signal: 'SIGINT'`) is the proof that our
  // handler ran instead of node's default kill.
  it('shuts down cleanly with exit 0 on SIGINT after serving a request', async () => {
    const serve = await startServe([projectDir], out);
    const response = await fetch(serve.info.url);
    expect(response.status).toBe(200);
    await response.text(); // leaves an idle keep-alive socket behind — the whole point

    const exit = await serve.stop('SIGINT');
    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
    expect(serve.stderr()).toContain('SIGINT received, shutting down');
  });

  // why: SIGTERM is how a supervisor (or an agent harness) stops a background `serve`. It must take
  // the same graceful path as Ctrl-C, or the port leaks until the process is reaped.
  //
  // This case signals IMMEDIATELY after the port line, with no fetch in between — and that is the
  // point. It caught a real race: `serve` used to announce the port and only then install its signal
  // handlers, so a caller reading stdout and signalling back (on another core, before the child's next
  // statement ran) killed it by default disposition — `code: null, signal: 'SIGTERM'`. Add a delay
  // here and this test passes while the bug remains. Do not "stabilize" it by waiting.
  it('shuts down cleanly with exit 0 on SIGTERM sent immediately after the port line', async () => {
    const serve = await startServe([projectDir], out);
    const exit = await serve.stop('SIGTERM');
    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
  });

  // why: an explicit `--port 0` must behave exactly like the default rather than trying to bind
  // literal port 0 — that is what "0 = ephemeral" means in the spec's command surface.
  it('treats --port 0 as ephemeral', async () => {
    const serve = await startServe([projectDir, '--port', '0'], out);
    try {
      expect(serve.info.port).toBeGreaterThan(0);
      expect((await fetch(serve.info.url)).status).toBe(200);
    } finally {
      await serve.stop('SIGINT');
    }
  });

  // why: `listen(NaN)` silently binds an ephemeral port, so a typo'd `--port` would look like success
  // and serve somewhere the user never asked. It must exit 1 with an `error:` line and bind nothing.
  it('exits 1 on a malformed --port without binding', async () => {
    const result = await runCli(['serve', projectDir, '--port', '80abc'], out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('error: invalid --port "80abc"');
    expect(result.stdout).toBe('');
  });

  // why: pointing `serve` at a directory that is not a clone must fail fast with the CLI contract's
  // one actionable line, not start a server over an arbitrary directory of the user's filesystem.
  it('exits 1 when the target is not a clone project', async () => {
    const result = await runCli(['serve', out], out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not a design-lens clone project');
    expect(result.stdout).toBe('');
  });
});
