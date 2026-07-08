/// <reference lib="dom" />
/**
 * Launch headless Chromium and start capturing every response into a {@link ResourceStore}.
 *
 * Playwright is EXTERNAL to the bundle (spec 01), so it is loaded at run time via
 * `lib/runtime-deps.ts#loadRuntimeDep` rather than imported at the top level. `emulateMedia`
 * `reducedMotion: 'reduce'` MUST be set BEFORE navigation so reveal animations freeze at their
 * final state (spec 02 §1). Resource capture is wired the instant the page exists: each response's
 * body is read asynchronously and recorded; body-read failures are tolerated as warnings, never
 * thrown (a redirect/opaque response has no readable body). Callers MUST `await drainResponses()`
 * once the page has settled, then close the browser.
 *
 * This module also owns the read-only counterpart: {@link renderScreenshot} and
 * {@link renderScreenshotOfDir} launch a BARE browser (no capture wiring, no relaxed web security)
 * purely to paint a page and hand back PNG bytes. They back both the `screenshot` command and the
 * `clone-full.png` fidelity re-render at the end of `clone` (spec 02 §M3).
 *
 * Spec: specs/02-clone-engine.md §1 (Launch), §M3 (Screenshots).
 */

import type { Browser, BrowserContext, Page, Response } from 'playwright';

import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { startStaticServer } from '../lib/static-server.js';
import { ResourceStore } from '../localize/resource-store.js';

/**
 * The slice of the Playwright module we use (loaded at run time, external to the bundle).
 * Exported so `commands/inspect.ts` — which needs a bare browser, not a capturing one — can
 * `loadRuntimeDep` against the same shape instead of re-declaring it.
 */
export interface PlaywrightModule {
  chromium: {
    launch(options?: { headless?: boolean; args?: string[] }): Promise<Browser>;
  };
}

/**
 * Chromium flags that let the render capture EVERY referenced asset, not just same-origin ones.
 *
 * A CSS `@font-face`/`background-image` on a cross-origin CDN is fetched by the browser in CORS
 * mode; if the CDN sends no `Access-Control-Allow-Origin` (the common case, and the sealed fixture's
 * alt-port CDN), Chromium fails the request with `net::ERR_FAILED` and the bytes never reach the
 * ResourceStore — so the asset would stay a live remote URL in the clone. Disabling web security
 * makes those cross-origin asset loads succeed so they ARE captured during render (spec 02 §6
 * "woff2 fonts captured during render"; sealed A15). This is safe here: the clone output is inert
 * (no script ever runs FROM the clone), and faithfully mirroring cross-origin assets is the whole
 * point of the tool (ADR-011).
 */
const CAPTURE_LAUNCH_ARGS = ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'];

/** A launched browser plus the live capture surfaces the pipeline drives. */
export interface Capture {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Every 2xx response body captured during render. */
  store: ResourceStore;
  /** Non-fatal capture warnings (e.g. a response body that could not be read). */
  warnings: string[];
  /** Resolve once every in-flight response body has been read into the store. */
  drainResponses(): Promise<void>;
}

/** Options that shape the render context. Timeouts/settle live in `capture/settle.ts`. */
export interface LaunchOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  /** Override the default Chromium UA; omitted ⇒ real default Chromium UA (spec 02 §1). */
  userAgent?: string;
}

/** Launch Chromium, open a page with capture wired, and set reduced-motion before any navigation. */
export async function launchCapture(options: LaunchOptions): Promise<Capture> {
  const { chromium } = loadRuntimeDep<PlaywrightModule>('playwright');
  const browser = await chromium.launch({ headless: true, args: CAPTURE_LAUNCH_ARGS });
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.deviceScaleFactor,
    // Bypass Content-Security-Policy so a target page's CSP cannot block asset loads we need to
    // capture; combined with --disable-web-security this maximises cross-origin asset capture.
    bypassCSP: true,
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const store = new ResourceStore();
  const warnings: string[] = [];
  const pending: Promise<void>[] = [];

  page.on('response', (response: Response) => {
    const status = response.status();
    if (status < 200 || status >= 300) return;
    pending.push(
      (async () => {
        let body: Buffer;
        try {
          body = await response.body();
        } catch {
          warnings.push(`could not read response body: ${response.url()}`);
          return;
        }
        const contentType = (response.headers()['content-type'] ?? '').trim();
        // `via: 'network'` — these bytes came off the wire while the page rendered. A resource the
        // render never requested is recorded later, with `via: 'refetch'` (localize/fetch-missing).
        store.record({ url: response.url(), status, contentType, body, via: 'network' });
      })(),
    );
  });

  return {
    browser,
    context,
    page,
    store,
    warnings,
    // Snapshot the queue: awaiting may let already-registered handlers push more, so loop to a fixpoint.
    async drainResponses(): Promise<void> {
      let drained = 0;
      while (drained < pending.length) {
        const batch = pending.slice(drained);
        drained = pending.length;
        await Promise.allSettled(batch);
      }
    },
  };
}

/** How long to wait for webfonts to resolve before shooting; a slow CDN must not hang the shot. */
const FONTS_READY_TIMEOUT_MS = 5_000;

/** Everything that shapes one PNG. All times are milliseconds. */
export interface RenderScreenshotOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  /** Capture the whole scrollable document rather than just the viewport. */
  fullPage: boolean;
  /** `page.goto` budget. */
  navigationTimeoutMs: number;
  /** Quiet time after `load` + webfont readiness, for late reveal work. */
  settleMs: number;
}

/**
 * Wait for the page to be *paintable*: webfonts resolved, then a short quiet period.
 *
 * Without the `document.fonts.ready` wait a shot taken right after `load` shows fallback font
 * metrics — the exact thing a design study must not record. The in-page `Promise.race` bounds it:
 * a webfont that never arrives costs {@link FONTS_READY_TIMEOUT_MS}, not the whole run.
 */
async function waitForPaint(page: Page, settleMs: number): Promise<void> {
  try {
    await page.evaluate(
      (ms: number) =>
        Promise.race([
          document.fonts.ready.then(() => undefined),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
        ]),
      FONTS_READY_TIMEOUT_MS,
    );
  } catch {
    // A detached frame or a document with no Font Loading API: shoot what is there rather than fail.
  }
  await page.waitForTimeout(settleMs);
}

/**
 * Screenshot the page as it currently stands.
 *
 * Rewinds to the top first: `capture/settle.ts#lazyLoadSweep` scrolls the document to the bottom to
 * trip IntersectionObserver images, and although it scrolls back, a non-full-page shot taken on any
 * scrolled page would frame the FOOTER and silently pass every "is it a PNG" assertion. The rewind
 * is a no-op on an unscrolled page, so it costs nothing to always do it.
 */
export async function capturePng(page: Page, fullPage: boolean): Promise<Buffer> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.screenshot({ fullPage, type: 'png' });
}

/**
 * Launch a bare browser, paint `url`, and return the PNG bytes. The browser is always closed.
 *
 * Deliberately NOT `launchCapture`: that one wires a ResourceStore that would read and buffer every
 * response body, and relaxes web security to mirror cross-origin assets. A screenshot needs neither
 * — it wants the bytes the pixels, not the network.
 */
export async function renderScreenshot(url: string, options: RenderScreenshotOptions): Promise<Buffer> {
  const { chromium } = loadRuntimeDep<PlaywrightModule>('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: options.viewport,
      deviceScaleFactor: options.deviceScaleFactor,
    });
    const page = await context.newPage();
    // Before any navigation, so a reveal animation is frozen at its final state rather than mid-fade.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'load', timeout: options.navigationTimeoutMs });
    await waitForPaint(page, options.settleMs);
    return await capturePng(page, options.fullPage);
  } finally {
    await browser.close();
  }
}

/**
 * Serve `dir` on an ephemeral loopback port, paint its `index.html`, and return the PNG bytes.
 *
 * This is how `clone-full.png` proves fidelity: the clone is re-rendered FROM DISK exactly as a
 * browser would see it, so a broken asset path shows up as a hole in the picture. The server is
 * closed in a `finally`; {@link renderScreenshot} has already closed the browser by then, which is
 * the required order — Chromium's sockets must be released before the server they point at goes away.
 */
export async function renderScreenshotOfDir(
  dir: string,
  options: RenderScreenshotOptions,
): Promise<Buffer> {
  const server = await startStaticServer(dir);
  try {
    return await renderScreenshot(server.url('/index.html'), options);
  } finally {
    await server.close();
  }
}
