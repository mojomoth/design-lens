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
 * stdout. Invalid options, missing/ambiguous direct IDs, missing `clone/index.html`, or failed
 * server/browser measurement exit 1. An empty result for a role is exit 0.
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
  relativizeUrl,
  type Role,
} from '../analyze/heuristics.js';
import {
  classify,
  filterByRole,
  probeElements,
  toElement,
  type InspectDocument,
  type InspectElement,
  type UnclassifiedInspectElement,
  type PageProbe,
} from '../analyze/inspect.js';
import { probeDetails, type DetailsProbe, type ElementDetails } from '../analyze/inspect-details.js';
import { fontWarnings, waitForFonts, type FontReadiness, type PlaywrightModule } from '../capture/browser.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { startStaticServer } from '../lib/static-server.js';
import { parseViewport } from '../lib/viewport.js';

/** A clone is a handful of local files on loopback; anything slower than this is a real failure. */
const NAVIGATION_TIMEOUT_MS = 30_000;

export interface InspectOptions {
  /** Enrich selected elements with resolved layout and typography measurements. */
  details?: boolean;
  /** Direct light-DOM lookup, independent of role classification; implies details. */
  id?: string;
  /** CSS-pixel viewport; omitted preserves the legacy desktop geometry. */
  viewport?: string;
  /** Restrict output to one role. Validated before anything is launched. */
  kind?: string;
  /** 2-space indented JSON instead of the default compact single line. */
  pretty?: boolean;
}

export type DetailedInspectElement = (InspectElement | UnclassifiedInspectElement) & { details: ElementDetails };

export interface DetailedInspectDocument {
  elements: DetailedInspectElement[];
  colors: 'see tokens.json';
  page: DetailsProbe['page'] & { fonts: FontReadiness };
}

export interface InspectResult {
  document: InspectDocument | DetailedInspectDocument;
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
  if (options.id !== undefined) {
    if (options.kind !== undefined) throw new Error('--id and --kind cannot be used together');
    if (!/^dl-[1-9]\d*$/.test(options.id) || !Number.isSafeInteger(Number(options.id.slice(3)))) {
      throw new Error(`invalid --id "${options.id}"; expected a stamped ID like dl-17`);
    }
  }

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
    const fonts = await waitForFonts(tab);
    const probe: PageProbe = await tab.evaluate(probeElements, [...SELECTORS]);

    const { document, warnings } = classify(probe, {
      origin: server.origin,
      viewportHeight: viewport.height,
    });
    warnings.push(...fontWarnings(fonts));
    let projected: InspectDocument | DetailedInspectDocument = kind === null ? document : filterByRole(document, kind);
    if (options.details === true || options.id !== undefined) {
      let selected: (InspectElement | UnclassifiedInspectElement)[] = projected.elements;
      if (options.id !== undefined) {
        const id = options.id;
        const matches = probe.probes.filter((element) => element.dlId === id);
        if (matches.length === 0) throw new Error(`no light-DOM element found with data-dl-id "${id}"`);
        if (matches.length > 1) throw new Error(`multiple light-DOM elements found with data-dl-id "${id}"`);
        selected = [document.elements.find((element) => element.dlId === id)
          ?? toElement({ probe: matches[0], dlId: id }, null, null, server.origin)];
      }
      const measured = await tab.evaluate(probeDetails, selected.map((element) => element.dlId));
      const byId = new Map(measured.elements.map((element) => [element.dlId, element]));
      projected = {
        elements: selected.map((element) => {
          const measurement = byId.get(element.dlId);
          if (!measurement) throw new Error(`element disappeared during measurement: ${element.dlId}`);
          return { ...element, rect: measurement.rect, styles: measurement.styles, details: {
            ...measurement.details,
            currentSrc: measurement.details.currentSrc === null ? null : relativizeUrl(measurement.details.currentSrc, server.origin),
          } };
        }),
        colors: document.colors,
        page: { ...measured.page, fonts },
      };
    }

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
    try {
      if (browser) await browser.close();
    } finally {
      await server.close();
    }
  }
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .argument('<projectDir>', 'a clone project directory, e.g. .design-lens/example-com')
    .description("Print the clone's live element inventory (logo, nav, hero, CTA, …) as JSON.")
    .option('--kind <role>', `restrict output to one role: ${ROLES.join('|')}`)
    .option('--viewport <WxH>', 'measurement viewport in CSS pixels (default: 1440x900)')
    .option('--details', 'include resolved styles, DOM relationships and page measurements')
    .option('--id <dl-id>', 'inspect one light-DOM element, including hidden elements (implies --details; excludes --kind; no shadow DOM)')
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
