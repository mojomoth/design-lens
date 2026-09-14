/**
 * The `inspect <projectDir>` command — the ephemeral element inventory.
 *
 * This module owns ONLY I/O and sequencing: serve `<projectDir>/clone/` on an ephemeral loopback
 * port, render it in headless Chromium at the capture viewport, run the probe, hand the numbers to
 * the pure classifier, print the answer. All role logic lives in `analyze/{inspect,heuristics}.ts`.
 *
 * Why it re-renders instead of parsing the HTML: the inventory must describe the clone AS IT IS NOW,
 * including `dl-overrides.css` and any element the agent has since edited. Roles depend on geometry
 * ("largest image in the first viewport", "nav link in the top quarter") and on computed styles
 * ("background contrasts with the body"), neither of which exists outside a layout engine. A cached
 * inventory would be stale the moment the user edited a single rule — hence ADR-002's decree that
 * there is no inventory file at all: the JSON goes to stdout and nowhere else, and this command
 * never writes a byte into `<projectDir>`.
 *
 * I/O discipline (guardrails / spec 05): human progress and warnings → stderr; inventory JSON →
 * stdout. Exit 1 only for a missing `clone/index.html`, a bad `--kind`, a server bind failure, or a
 * browser launch/navigation failure. An empty result for a role is exit 0.
 *
 * Spec: specs/05-element-inventory.md §inspect.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import type { Browser } from 'playwright';

import {
  DEVICE_SCALE_FACTOR,
  ROLES,
  SELECTORS,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  isRole,
  type Role,
} from '../analyze/heuristics.js';
import {
  classify,
  filterByRole,
  probeElements,
  type InspectDocument,
  type PageProbe,
} from '../analyze/inspect.js';
import type { PlaywrightModule } from '../capture/browser.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { startStaticServer } from '../lib/static-server.js';
import { parseViewport } from '../lib/viewport.js';

/** A clone is a handful of local files on loopback; anything slower than this is a real failure. */
const NAVIGATION_TIMEOUT_MS = 30_000;

export interface InspectOptions {
  /** CSS-pixel viewport; omitted preserves the legacy desktop geometry. */
  viewport?: string;
  /** Restrict output to one role. Validated before anything is launched. */
  kind?: string;
  /** 2-space indented JSON instead of the default compact single line. */
  pretty?: boolean;
}

export interface InspectResult {
  document: InspectDocument;
  /** The exact bytes written to stdout, trailing newline included. */
  json: string;
  warnings: string[];
}

/** Parse `--kind` into a role. Throws (⇒ exit 1) on anything outside the seven role names. */
function parseKind(kind: string | undefined): Role | null {
  if (kind === undefined) return null;
  if (!isRole(kind)) {
    throw new Error(`invalid --kind "${kind}": expected one of ${ROLES.join(', ')}`);
  }
  return kind;
}

/**
 * Serve the clone, measure it live, and return the inventory document.
 *
 * The server and the browser are torn down in `finally` even when navigation throws, so a failed
 * inspect never leaks a listening port or an orphan Chromium into the user's machine. Returns the
 * document rather than printing it, so the caller owns the stdout contract.
 */
export async function runInspect(
  projectDir: string,
  options: InspectOptions = {},
): Promise<InspectResult> {
  const root = path.resolve(projectDir);
  const cloneDir = path.join(root, 'clone');
  const indexPath = path.join(cloneDir, 'index.html');

  // Validate before touching a port or a browser: a typo in `--kind` should cost nothing.
  const kind = parseKind(options.kind);
  const viewport = parseViewport(options.viewport ?? `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);

  if (!fs.existsSync(indexPath)) {
    throw new Error(`not a design-lens clone project: missing ${indexPath}`);
  }

  const server = await startStaticServer(cloneDir);
  process.stderr.write(`design-lens: serving ${cloneDir} on ${server.origin}\n`);

  let browser: Browser | undefined;
  try {
    const { chromium } = loadRuntimeDep<PlaywrightModule>('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });
    const tab = await context.newPage();
    // Match capture's reduced-motion preference; CSS that ignores it can still animate.
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    await tab.goto(server.url('/index.html'), {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const probe: PageProbe = await tab.evaluate(probeElements, [...SELECTORS]);

    const { document, warnings } = classify(probe, {
      origin: server.origin,
      viewportHeight: viewport.height,
    });
    const projected = kind === null ? document : filterByRole(document, kind);

    const json = `${
      options.pretty === true ? JSON.stringify(projected, null, 2) : JSON.stringify(projected)
    }\n`;

    for (const warning of warnings) process.stderr.write(`design-lens: warning: ${warning}\n`);
    process.stderr.write(
      `design-lens: inspected ${probe.probes.length} element(s), ` +
        `reported ${projected.elements.length} (${warnings.length} warning(s))\n`,
    );

    return { document: projected, json, warnings };
  } finally {
    // Order matters: release Chromium's sockets before the server they point at goes away.
    if (browser) await browser.close();
    await server.close();
  }
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .argument('<projectDir>', 'a clone project directory, e.g. .design-lens/example-com')
    .description("Print the clone's live element inventory (logo, nav, hero, CTA, …) as JSON.")
    .option('--kind <role>', `restrict output to one role: ${ROLES.join('|')}`)
    .option('--viewport <WxH>', 'measurement viewport in CSS pixels (default: 1440x900)')
    .option('--pretty', 'pretty-print the inventory JSON (default: compact single line)')
    .action(async (projectDir: string, options: InspectOptions): Promise<void> => {
      try {
        const result = await runInspect(projectDir, options);
        process.stdout.write(result.json);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${detail}\n`);
        process.exitCode = 1;
      }
    });
}
