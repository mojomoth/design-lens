/// <reference lib="dom" />
/**
 * Launch headless Chromium and start capturing every response into a {@link ResourceStore}.
 *
 * Playwright is EXTERNAL to the bundle (spec 01), so it is loaded at run time via
 * `lib/runtime-deps.ts#loadRuntimeDep` rather than imported at the top level. `emulateMedia`
 * `reducedMotion: 'reduce'` MUST be set BEFORE navigation so the page sees the preference from
 * its first render (spec 02 §1); CSS that ignores it can still animate. Resource capture is wired
 * the instant the page exists: each response's
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

import type { APIResponse, Browser, BrowserContext, Page, Response, Route } from 'playwright';

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

/** Request failures precede the load event, so the FontFaceSet wait alone cannot bound them. */
export interface FontRequestGuard {
  networkTimeout: boolean;
  failures: string[];
}

/**
 * Bound initial font requests on bare render/inspect pages. A stalled font can otherwise hold the
 * load event forever, preventing the later readiness timer from even starting. Keep normal load
 * waiting for styles, images, and frames; preserve browser redirect and HTTP-error handling.
 * Playwright does not route followed redirect hops; those keep native loading/navigation behavior
 * and the separate font-readiness wait after load.
 */
export async function guardFontRequests(page: Page): Promise<FontRequestGuard> {
  const guard: FontRequestGuard = { networkTimeout: false, failures: [] };
  async function abort(route: Route, reason: 'timedout' | 'failed'): Promise<void> {
    try {
      await route.abort(reason);
    } catch (error) {
      if (!page.isClosed()) {
        const detail = error instanceof Error ? error.message : String(error);
        guard.failures.push(`could not abort failed font request: ${detail}`);
      }
    }
  }

  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'font') {
      await route.continue();
      return;
    }

    let response: APIResponse;
    try {
      // Returning redirects to Chromium preserves its redirect chain and cross-origin checks.
      response = await route.fetch({ timeout: FONTS_READY_TIMEOUT_MS, maxRedirects: 0 });
    } catch (error) {
      if (page.isClosed()) return;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      if (timedOut) guard.networkTimeout = true;
      else {
        const detail = error instanceof Error ? error.message : String(error);
        guard.failures.push(`font request failed: ${route.request().url()} (${detail})`);
      }
      await abort(route, timedOut ? 'timedout' : 'failed');
      return;
    }

    try {
      // APIResponse forwards status, headers, and bytes, including ordinary 404/500 responses.
      await route.fulfill({ response });
    } catch (error) {
      if (!page.isClosed()) {
        const detail = error instanceof Error ? error.message : String(error);
        guard.failures.push(`could not forward font response: ${detail}`);
        await abort(route, 'failed');
      }
    } finally {
      try {
        await response.dispose();
      } catch (error) {
        if (!page.isClosed()) {
          const detail = error instanceof Error ? error.message : String(error);
          guard.failures.push(`could not release font response: ${detail}`);
        }
      }
    }
  });
  return guard;
}

/** Readiness is not proof of the intended face: failed faces can leave fallback metrics. */
export interface FontReadiness {
  status: 'ready' | 'timeout' | 'unavailable';
  failedFamilies: string[];
}

/** Bounded, shared font sampling for screenshots and computed measurements. */
export async function waitForFonts(page: Page, requests?: FontRequestGuard): Promise<FontReadiness> {
  try {
    const fonts = await page.evaluate(async (timeoutMs: number): Promise<FontReadiness> => {
      if (!document.fonts) return { status: 'unavailable', failedFamilies: [] };
      let timer: number | undefined;
      try {
        const status = await Promise.race([
          document.fonts.ready.then(() => 'ready' as const),
          new Promise<'timeout'>((resolve) => {
            timer = window.setTimeout(() => resolve('timeout'), timeoutMs);
          }),
        ]);
        const failed = new Set<string>();
        document.fonts.forEach((face) => {
          if (face.status === 'error') failed.add(face.family);
        });
        return { status, failedFamilies: [...failed].sort() };
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
      }
    }, FONTS_READY_TIMEOUT_MS);
    return requests?.networkTimeout ? { ...fonts, status: 'timeout' } : fonts;
  } catch {
    return { status: requests?.networkTimeout ? 'timeout' : 'unavailable', failedFamilies: [] };
  }
}

/** Callers route these diagnostics to stderr; detailed inspection also records the status. */
export function fontWarnings(fonts: FontReadiness, requests?: FontRequestGuard): string[] {
  const warnings: string[] = [...(requests?.failures ?? [])];
  if (fonts.status === 'timeout') {
    const phase = requests?.networkTimeout ? 'request' : 'readiness';
    warnings.push(`font ${phase} timed out after 5000ms; fallback metrics may be present`);
  }
  if (fonts.status === 'unavailable') warnings.push('font readiness unavailable; font metrics could not be confirmed');
  if (fonts.failedFamilies.length > 0) warnings.push(`failed font families: ${fonts.failedFamilies.join(', ')}; fallback metrics may be present`);
  return warnings;
}

/** Everything that shapes one PNG. All times are milliseconds. */
export interface RenderScreenshotOptions {
  /** Capture callers retain diagnostics in their manifest/report as well as stderr. */
  onWarning?: (warning: string) => void;
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
 * Without the `document.fonts.ready` wait a shot taken right after `load` can show fallback font
 * metrics. The in-page `Promise.race` bounds only this after-load wait to
 * {@link FONTS_READY_TIMEOUT_MS}; unresolved faces remain explicit warnings in the evidence.
 */
async function waitForPaint(page: Page, settleMs: number, requests: FontRequestGuard, onWarning?: (warning: string) => void): Promise<FontReadiness> {
  const fonts = await waitForFonts(page, requests);
  for (const warning of fontWarnings(fonts, requests)) {
    onWarning?.(warning);
    process.stderr.write(`design-lens: warning: ${warning}\n`);
  }
  await page.waitForTimeout(settleMs);
  return fonts;
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

/** Capture current pixels after a readiness failure without Playwright waiting for fonts again. */
async function capturePngWithUnreadyFonts(page: Page, fullPage: boolean, deviceScaleFactor: number): Promise<Buffer> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const session = await page.context().newCDPSession(page);
  try {
    const { cssContentSize, cssLayoutViewport } = await session.send('Page.getLayoutMetrics');
    const size = fullPage ? cssContentSize : {
      width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight,
    };
    const clip = {
      x: 0, y: 0,
      width: Math.ceil(size.width), height: Math.ceil(size.height), scale: deviceScaleFactor,
    };
    const shot = await session.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: fullPage, clip,
    });
    // A fresh CDP session captures CSS pixels; scale explicitly to match the requested PNG density.
    return Buffer.from(shot.data, 'base64');
  } finally {
    await session.detach();
  }
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
    const fontRequests = await guardFontRequests(page);
    // Set the preference before navigation; it does not freeze CSS that ignores reduced motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'load', timeout: options.navigationTimeoutMs });
    const fonts = await waitForPaint(page, options.settleMs, fontRequests, options.onWarning);
    return fonts.status === 'ready'
      ? await capturePng(page, options.fullPage)
      : await capturePngWithUnreadyFonts(page, options.fullPage, options.deviceScaleFactor);
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
