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
 * Spec: specs/02-clone-engine.md §1 (Launch).
 */

import type { Browser, BrowserContext, Page, Response } from 'playwright';

import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { ResourceStore } from '../localize/resource-store.js';

/** The slice of the Playwright module this module uses (loaded at run time, external to the bundle). */
interface PlaywrightModule {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<Browser>;
  };
}

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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.deviceScaleFactor,
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
        store.record({ url: response.url(), status, contentType, body });
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
