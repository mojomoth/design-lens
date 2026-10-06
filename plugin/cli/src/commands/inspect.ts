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
 * `--lite` is the compact, target-only projection (`analyze/inspect-lite.ts`); `--viewports`
 * measures several viewports in one server and one browser. In lite mode an id or selector that
 * is absent at a viewport is a `page.warnings` entry, never an error.
 *
 * Spec: specs/05-element-inventory.md §inspect.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import type { Browser, Page } from 'playwright';

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
import {
  LITE_MAX_PER_SELECTOR,
  LITE_TEXT_CHARS,
  probeLite,
  projectLiteElement,
  validateSelectorSyntax,
  type LiteElement,
  type LiteInspectDocument,
  type LitePage,
  type LiteProbeRequest,
  type LiteProbeResult,
  type LiteViewportsInspectDocument,
} from '../analyze/inspect-lite.js';
import { detailsFromObservation, inventoryFromObservation, type ComprehensiveDetails } from '../analyze/inspect-observations.js';
import { observePage, type ElementObservation, type ObservationDocument } from '../analyze/observations.js';
import {
  fontWarnings,
  guardFontRequests,
  waitForFonts,
  type FontReadiness,
  type FontRequestGuard,
  type PlaywrightModule,
} from '../capture/browser.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { markPhase, timePhase } from '../lib/runlog.js';
import { startStaticServer, type StaticServer } from '../lib/static-server.js';
import { parseViewport, parseViewports, type Viewport } from '../lib/viewport.js';

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
  /** Compact target-only projection; see `analyze/inspect-lite.ts`. */
  lite?: boolean;
  /** CSS selectors evaluated in the document and every open shadow root; ids come first. */
  selector?: string | string[];
  /** Comma-separated viewports measured in one browser session; requires `lite`. */
  viewports?: string;
}

/** Every option decision, made before a port or a browser exists. */
export interface InspectPlan {
  kind: Role | null;
  viewports: Viewport[];
  /** `--viewports` was given: the output is the per-viewport document even for one entry. */
  multi: boolean;
  ids: string[] | undefined;
  selectors: string[] | undefined;
  all: boolean;
  details: boolean;
  lite: boolean;
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
  document: InspectDocument | CompleteInspectDocument | DetailedInspectDocument | LiteInspectDocument | LiteViewportsInspectDocument;
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

function unique(value: string | string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : [...new Set(Array.isArray(value) ? value : [value])];
}

/**
 * Validate every flag combination and value. Throws (⇒ exit 1, empty stdout) before anything is
 * served or launched; the browser's own selector parser is the single later check.
 */
export function planInspect(options: InspectOptions): InspectPlan {
  const kind = parseKind(options.kind);
  if (options.viewport !== undefined && options.viewports !== undefined) {
    throw new Error('--viewport and --viewports cannot be used together');
  }
  if (options.viewports !== undefined && options.lite !== true) throw new Error('--viewports requires --lite');
  const viewports = options.viewports !== undefined
    ? parseViewports(options.viewports)
    : [parseViewport(options.viewport ?? `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`)];
  const ids = unique(options.id);
  const selectors = unique(options.selector);
  if (options.all && (ids !== undefined || options.kind !== undefined || selectors !== undefined)) {
    throw new Error('--all cannot be combined with --id, --kind or --selector');
  }
  if (options.kind !== undefined && selectors !== undefined) throw new Error('--kind and --selector cannot be used together');
  if (ids !== undefined) {
    if (options.kind !== undefined) throw new Error('--id and --kind cannot be used together');
    if (ids.length === 0) throw new Error('--id requires at least one stamped ID');
    for (const id of ids) {
      if (!/^dl-[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(3)))) {
        throw new Error(`invalid --id "${id}"; expected a stamped ID like dl-17`);
      }
    }
  }
  if (selectors !== undefined) {
    if (selectors.length === 0) throw new Error('--selector requires at least one CSS selector');
    for (const selector of selectors) validateSelectorSyntax(selector);
  }
  if (options.lite === true && options.details === true) {
    throw new Error('--lite and --details cannot be used together; --details is the full projection');
  }
  return {
    kind, viewports, multi: options.viewports !== undefined, ids, selectors,
    all: options.all === true, details: options.details === true, lite: options.lite === true,
  };
}

function rejectBrowserInvalid(result: LiteProbeResult): void {
  if (result.invalidSelectors.length > 0) {
    throw new Error(`invalid --selector "${result.invalidSelectors[0]}": the browser cannot parse it`);
  }
}

interface OpenedClone {
  tab: Page;
  fonts: FontReadiness;
  /** Read after the probes too: font requests can still fail while the page is measured. */
  fontRequests: FontRequestGuard;
  navigateMs: number;
  fontsMs: number;
}

/** A fresh context per viewport: media queries, fonts and scroll state never leak between sizes. */
async function openClone(browser: Browser, server: StaticServer, viewport: Viewport): Promise<OpenedClone> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  const tab = await context.newPage();
  const fontRequests = await guardFontRequests(tab);
  // Match capture's reduced-motion preference; CSS that ignores it can still animate.
  await tab.emulateMedia({ reducedMotion: 'reduce' });
  const navigateStart = performance.now();
  await tab.goto(server.url('/index.html'), {
    waitUntil: 'load',
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  const fontsStart = performance.now();
  const fonts = await waitForFonts(tab, fontRequests);
  return {
    tab,
    fonts,
    fontRequests,
    navigateMs: Math.round(fontsStart - navigateStart),
    fontsMs: Math.round(performance.now() - fontsStart),
  };
}

/** One viewport of lite measurement; its context is closed before returning. */
async function inspectLiteViewport(browser: Browser, server: StaticServer, viewport: Viewport, plan: InspectPlan): Promise<{
  page: Omit<LitePage, 'viewport'>;
  elements: LiteElement[];
}> {
  const started = performance.now();
  const { tab, fonts, fontRequests, navigateMs, fontsMs } = await openClone(browser, server, viewport);
  try {
    const timings: Record<string, number> = { navigate: navigateMs, fonts: fontsMs };
    const selectionNotes: string[] = [];
    let roles: InspectElement[] | undefined;
    if (!plan.all && plan.ids === undefined && plan.selectors === undefined) {
      const rolesStart = performance.now();
      const classified = classify(await tab.evaluate(probeElements, [...SELECTORS]), {
        origin: server.origin,
        viewportHeight: viewport.height,
      });
      selectionNotes.push(...classified.warnings);
      roles = (plan.kind === null ? classified.document : filterByRole(classified.document, plan.kind)).elements;
      timings.roles = Math.round(performance.now() - rolesStart);
    }
    const probeStart = performance.now();
    const request: LiteProbeRequest = {
      ids: roles ? roles.map((element) => element.dlId) : plan.ids ?? [],
      selectors: plan.selectors ?? [],
      all: plan.all,
      maxPerSelector: LITE_MAX_PER_SELECTOR,
      maxTextChars: LITE_TEXT_CHARS,
      measure: true,
    };
    const result = await tab.evaluate(probeLite, request);
    rejectBrowserInvalid(result);
    timings.probe = Math.round(performance.now() - probeStart);
    const roleOf = new Map((roles ?? []).map((element) => [element.dlId, element.role]));
    const elements = result.elements.map((element) => projectLiteElement(
      element, server.origin, element.id === null ? undefined : roleOf.get(element.id),
    ));
    timings.total = Math.round(performance.now() - started);
    return {
      page: {
        rootFontSize: result.rootFontSize,
        fonts,
        ...(result.activeCaptureId ? { activeCaptureId: result.activeCaptureId } : {}),
        complete: fonts.status === 'ready' && fonts.failedFamilies.length === 0 && result.issues.length === 0,
        warnings: [...new Set([...fontWarnings(fonts, fontRequests), ...result.issues, ...selectionNotes, ...result.notes])],
        timings,
      },
      elements,
    };
  } finally {
    await tab.context().close();
  }
}

/**
 * Navigation dominates lite cost (`load` waits for every variant's assets), so contexts load
 * concurrently; the bound keeps eight composed renderers from holding eight full DOMs at once.
 */
const LITE_VIEWPORT_CONCURRENCY = 3;

/** Results keep input order; the first rejection rejects the whole map. */
async function mapBounded<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Lite output for one or several viewports in one browser; stderr and stdout keep input order. */
async function runLite(browser: Browser, server: StaticServer, plan: InspectPlan, pretty: boolean): Promise<InspectResult> {
  const measured: LiteViewportsInspectDocument['viewports'] = [];
  const warnings: string[] = [];
  const results = await mapBounded(plan.viewports, LITE_VIEWPORT_CONCURRENCY, (viewport) => inspectLiteViewport(browser, server, viewport, plan));
  for (const [index, viewport] of plan.viewports.entries()) {
    const { page, elements } = results[index];
    const label = `${viewport.width}x${viewport.height}`;
    for (const warning of page.warnings) {
      const line = plan.multi ? `${label}: ${warning}` : warning;
      warnings.push(line);
      process.stderr.write(`design-lens: warning: ${line}\n`);
    }
    process.stderr.write(
      `design-lens: lite inspection at ${label} reported ${elements.length} element(s) (${page.warnings.length} warning(s))\n`,
    );
    measured.push({ viewport, page, elements });
  }
  const document: LiteInspectDocument | LiteViewportsInspectDocument = plan.multi
    ? { colors: 'see tokens.json', viewports: measured }
    : { colors: 'see tokens.json', page: { viewport: measured[0].viewport, ...measured[0].page }, elements: measured[0].elements };
  const json = `${pretty ? JSON.stringify(document, null, 2) : JSON.stringify(document)}\n`;
  return { document, json, warnings };
}

/**
 * Selector addressing for the detailed projection: matches resolve to stamped ids in the same
 * document-plus-shadow scope as `--id`. Unstamped matches cannot be addressed and become warnings.
 */
async function resolveSelectorIds(tab: Page, selectors: string[], warnings: string[]): Promise<string[]> {
  const request: LiteProbeRequest = {
    ids: [], selectors, all: false, maxPerSelector: LITE_MAX_PER_SELECTOR, maxTextChars: LITE_TEXT_CHARS, measure: false,
  };
  const result = await tab.evaluate(probeLite, request);
  rejectBrowserInvalid(result);
  warnings.push(...result.notes);
  const ids: string[] = [];
  for (const element of result.elements) {
    if (element.id === null) {
      warnings.push(`--selector ${element.matched.map((selector) => `"${selector}"`).join(', ')} matched an element without data-dl-id at ${element.path ?? element.tag}; it cannot be inspected by id`);
    } else ids.push(element.id);
  }
  return ids;
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
  const plan = planInspect(options);
  const kind = plan.kind;
  const viewport = plan.viewports[0];

  if (!fs.existsSync(indexPath)) {
    throw new Error(`not a design-lens clone project: missing ${indexPath}`);
  }

  const server = await timePhase('serve', () => startStaticServer(cloneDir));
  process.stderr.write(`design-lens: serving ${cloneDir} on ${server.origin}\n`);

  let browser: Browser | undefined;
  try {
    const { chromium } = loadRuntimeDep<PlaywrightModule>('playwright');
    const launched = await timePhase('launch', () => chromium.launch({ headless: true }));
    browser = launched;
    // Lite viewports load concurrently: one wall-clock phase, never a sum of overlapping timings.
    if (plan.lite) return await timePhase('lite-viewports', () => runLite(launched, server, plan, options.pretty === true));

    const { tab, fonts, fontRequests, navigateMs, fontsMs } = await openClone(launched, server, viewport);
    markPhase('navigate', navigateMs);
    markPhase('fonts', fontsMs);
    const { probe, document, warnings } = await timePhase('probe', async () => {
      const probed: PageProbe = await tab.evaluate(probeElements, [...SELECTORS]);
      return { probe: probed, ...classify(probed, { origin: server.origin, viewportHeight: viewport.height }) };
    });
    warnings.push(...fontWarnings(fonts, fontRequests));
    const ids = plan.selectors === undefined
      ? plan.ids
      : [...new Set([...(plan.ids ?? []), ...await resolveSelectorIds(tab, plan.selectors, warnings)])];
    let projected: InspectDocument | CompleteInspectDocument | DetailedInspectDocument = kind === null ? document : filterByRole(document, kind);
    if (options.details === true || ids !== undefined || options.all === true) {
      const observations = await timePhase('observe', () => observePage(tab, { includeDocumentElements: options.all === true || ids !== undefined, includeInactiveVariants: options.all === true || ids !== undefined }));
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
    const closeStarted = performance.now();
    try {
      if (browser) await browser.close();
    } finally {
      await server.close();
      markPhase('close', performance.now() - closeStarted);
    }
  }
}

function collect(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .argument('<projectDir>', 'a clone project directory, e.g. .design-lens/example-com')
    .description("Print the clone's live element inventory (logo, nav, hero, CTA, …) as JSON.")
    .option('--kind <role>', `restrict output to one role: ${ROLES.join('|')}`)
    .option('--viewport <WxH>', 'measurement viewport in CSS pixels (default: 1440x900)')
    .option('--viewports <list>', 'measure several viewports in one browser session, e.g. 1440x900,768x1024,390x844 (requires --lite)')
    .option('--details', 'include resolved styles, DOM relationships and page measurements')
    .option('--lite', 'compact projection of the selected elements: geometry, font, color, box, layout, effects, pseudo content')
    .option('--id <dl-id>', 'inspect a stamped element across open shadow roots (repeatable; implies --details unless --lite)', collect)
    .option('--selector <css>', `select elements by CSS selector in the document and every open shadow root (repeatable; at most ${LITE_MAX_PER_SELECTOR} matches each; implies --details unless --lite)`, collect)
    .option('--all', 'include all stamped elements, including hidden and open shadow content (excludes --kind, --id and --selector; with --lite: visible elements of the active variant)')
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
