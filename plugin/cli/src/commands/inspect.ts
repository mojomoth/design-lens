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
  type Role,
} from '../analyze/heuristics.js';
import {
  classify,
  filterByRole,
  probeElements,
  type InspectDocument,
  type InspectElement,
  type UnclassifiedInspectElement,
  type PageProbe,
} from '../analyze/inspect.js';
import type { DetailsProbe, ElementDetails } from '../analyze/inspect-details.js';
import { detailsFromObservation, inventoryFromObservation, type ComprehensiveDetails } from '../analyze/inspect-observations.js';
import { observePage, type ElementObservation, type ObservationDocument } from '../analyze/observations.js';
import { fontWarnings, guardFontRequests, waitForFonts, type FontReadiness, type PlaywrightModule } from '../capture/browser.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { startStaticServer } from '../lib/static-server.js';
import { parseViewport } from '../lib/viewport.js';

/** A clone is a handful of local files on loopback; anything slower than this is a real failure. */
const NAVIGATION_TIMEOUT_MS = 30_000;

export interface InspectOptions {
  /** Enrich selected elements with resolved layout and typography measurements. */
  details?: boolean;
  /** Direct lookup across light DOM and open shadow roots; implies details. */
  id?: string | string[];
  /** Include all stamped elements, including hidden nodes and open shadow trees. */
  all?: boolean;
  /** CSS-pixel viewport; omitted preserves the legacy desktop geometry. */
  viewport?: string;
  /** Restrict output to one role. Validated before anything is launched. */
  kind?: string;
  /** 2-space indented JSON instead of the default compact single line. */
  pretty?: boolean;
}

export type DetailedInspectElement = (InspectElement | UnclassifiedInspectElement) & { details: ElementDetails | ComprehensiveDetails };

export interface CompleteInspectDocument {
  elements: (InspectElement | UnclassifiedInspectElement)[];
  colors: 'see tokens.json';
}

export interface DetailedInspectDocument {
  elements: DetailedInspectElement[];
  colors: 'see tokens.json';
  page: DetailsProbe['page'] & {
    fonts: FontReadiness;
    source: 'clone';
    fontFaces: ObservationDocument['fontFaces'];
    activeCaptureId?: string;
    complete: boolean;
    warnings: string[];
  };
}

export interface InspectResult {
  document: InspectDocument | CompleteInspectDocument | DetailedInspectDocument;
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
  const ids = options.id === undefined ? undefined : [...new Set(Array.isArray(options.id) ? options.id : [options.id])];
  if (options.all && (ids !== undefined || options.kind !== undefined)) throw new Error('--all cannot be combined with --id or --kind');
  if (ids !== undefined) {
    if (options.kind !== undefined) throw new Error('--id and --kind cannot be used together');
    if (ids.length === 0) throw new Error('--id requires at least one stamped ID');
    for (const id of ids) {
      if (!/^dl-[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(3)))) {
        throw new Error(`invalid --id "${id}"; expected a stamped ID like dl-17`);
      }
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
    const fontRequests = await guardFontRequests(tab);
    // Match capture's reduced-motion preference; CSS that ignores it can still animate.
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    await tab.goto(server.url('/index.html'), {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const fonts = await waitForFonts(tab, fontRequests);
    const probe: PageProbe = await tab.evaluate(probeElements, [...SELECTORS]);

    const { document, warnings } = classify(probe, {
      origin: server.origin,
      viewportHeight: viewport.height,
    });
    warnings.push(...fontWarnings(fonts, fontRequests));
    let projected: InspectDocument | CompleteInspectDocument | DetailedInspectDocument = kind === null ? document : filterByRole(document, kind);
    if (options.details === true || ids !== undefined || options.all === true) {
      const observations = await observePage(tab, { includeDocumentElements: options.all === true || ids !== undefined, includeInactiveVariants: options.all === true || ids !== undefined });
      warnings.push(...observations.warnings);
      const byId = new Map<string, ElementObservation[]>();
      for (const element of observations.elements) {
        const matches = byId.get(element.dlId) ?? [];
        matches.push(element);
        byId.set(element.dlId, matches);
      }
      const classified = new Map(document.elements.map((element) => [element.dlId, element]));
      const selectedIds = ids ?? (options.all ? observations.elements.map((element) => element.dlId) : projected.elements.map((element) => element.dlId));
      const selected = selectedIds.map((id) => {
        const matches = byId.get(id) ?? [];
        if (matches.length === 0) throw new Error(`no element found with data-dl-id "${id}" in the document or open shadow roots`);
        if (matches.length > 1) throw new Error(`multiple elements found with data-dl-id "${id}" across document and open shadow roots`);
        const observation = matches[0];
        const inventory = inventoryFromObservation(observation, server.origin, classified.get(id));
        return { inventory, observation };
      });
      if (options.details === true || ids !== undefined) {
        if (!observations.body) throw new Error('cannot inspect details: document has no body');
        const body = { dlId: 'body', ...observations.body };
        const bodyInventory = inventoryFromObservation(body, server.origin);
        projected = {
          elements: selected.map(({ inventory, observation }) => ({ ...inventory, details: detailsFromObservation(observation, server.origin) })),
          colors: document.colors,
          page: { viewport: observations.viewport, deviceScaleFactor: observations.deviceScaleFactor,
            rootFontSize: observations.rootFontSize,
            body: { rect: body.rect, styles: bodyInventory.styles, details: detailsFromObservation(body, server.origin) },
            fonts, source: 'clone', fontFaces: observations.fontFaces,
            ...(observations.activeCaptureId ? { activeCaptureId: observations.activeCaptureId } : {}),
            complete: observations.complete && fonts.status === 'ready' && fonts.failedFamilies.length === 0,
            warnings: [...new Set(warnings)] },
        };
      } else projected = { elements: selected.map(({ inventory }) => inventory), colors: document.colors };
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
    .option('--id <dl-id>', 'inspect a stamped element across open shadow roots (repeatable; implies --details)', (value: string, previous?: string[]) => [...(previous ?? []), value])
    .option('--all', 'include all stamped elements, including hidden and open shadow content (excludes --kind and --id)')
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
