/**
 * Navigate to the target URL and wait for the page to settle, then read robots.txt out-of-band.
 *
 * `networkidle` is the standard capture signal but is documented "DISCOURAGED" and can be starved
 * forever by analytics/websockets, so it MUST be capped via `Promise.race` against a fixed sleep
 * (spec 02 §2, Verified facts). After idle we wait a further `--settle` ms for late reveal work.
 * A `goto` failure (DNS, timeout) is fatal upstream (exit 1); the robots fetch is best-effort —
 * any failure yields `false` with no warning, and the clone PROCEEDS regardless (transparency, not
 * blocking).
 *
 * Spec: specs/02-clone-engine.md §2 (Navigate & settle).
 */

import type { BrowserContext, Page } from 'playwright';

/** The hard cap on `networkidle`, in ms — beyond this we stop waiting and settle (spec 02 §2). */
const NETWORKIDLE_CAP_MS = 15_000;

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Inputs for one navigate+settle cycle. All times are already in milliseconds. */
export interface SettleOptions {
  url: string;
  /** Per-navigation timeout for `page.goto` (ms) — already clamped to the remaining budget. */
  gotoTimeoutMs: number;
  /** Extra quiet time after networkidle (the `--settle` flag, ms). */
  settleMs: number;
  /** Absolute wall-clock deadline (ms since epoch) for the whole run; caps the idle wait. */
  deadline: number;
}

/** Facts read from the settled page for the manifest/report. */
export interface SettleResult {
  finalUrl: string;
  title: string;
}

/**
 * `page.goto(url, { waitUntil: 'load' })`, then a capped `networkidle`, then the `--settle` wait.
 * Throws if navigation itself fails — the caller treats that as fatal.
 */
export async function navigateAndSettle(page: Page, options: SettleOptions): Promise<SettleResult> {
  await page.goto(options.url, { waitUntil: 'load', timeout: Math.max(1, options.gotoTimeoutMs) });

  const idleCap = Math.min(NETWORKIDLE_CAP_MS, Math.max(0, options.deadline - Date.now()));
  await Promise.race([
    // timeout: 0 disables Playwright's own timeout; the sleep is what caps the wait.
    page.waitForLoadState('networkidle', { timeout: 0 }).catch(() => undefined),
    sleep(idleCap),
  ]);

  await sleep(options.settleMs);

  return { finalUrl: page.url(), title: await page.title() };
}

/** The fraction of the viewport height to advance per scroll step (spec 02 §M2 lazy-load sweep). */
const SCROLL_STEP_RATIO = 0.8;
/** Pause between scroll steps, in ms — long enough for IntersectionObserver callbacks to fire. */
const SCROLL_INTERVAL_MS = 150;
/**
 * Hard cap on scroll steps in one pass. A malicious/infinite-scroll page could keep growing forever;
 * `scrollHeight / step` for any sane page is well under this, so the cap only ever bounds pathology.
 */
const MAX_SCROLL_STEPS = 400;

/** Inputs for one lazy-load scroll sweep. All times are already in milliseconds. */
export interface SweepOptions {
  /** Render viewport height (px); the scroll step is a fraction of this. */
  viewportHeight: number;
  /** Quiet time (`--settle` ms) to wait after scrolling back to the top of each pass. */
  settleMs: number;
  /** Absolute wall-clock deadline (ms since epoch); caps each pass's networkidle re-wait. */
  deadline: number;
}

/**
 * The per-step scroll distance in px: `viewportHeight * 0.8`, floored, never below 1 so a zero or
 * fractional viewport still makes forward progress. Pure and exported so the 0.8 ratio is pinned by
 * a unit test — a regression to e.g. a full-viewport jump would skip elements whose observer margin
 * only fires on a partial overlap.
 */
export function scrollStepPx(viewportHeight: number): number {
  return Math.max(1, Math.floor(viewportHeight * SCROLL_STEP_RATIO));
}

/**
 * Scroll the page from top to bottom in `scrollStepPx` increments, dispatching a synthetic `scroll`
 * event each step so IntersectionObserver-based lazy-loaders that listen on `window` also fire, then
 * stop once no further downward progress is made (bottom reached) or the step cap trips.
 */
async function scrollToBottom(page: Page, step: number): Promise<void> {
  await page.evaluate(
    async ({ step, intervalMs, maxSteps }) => {
      const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      let previousY = -1;
      for (let i = 0; i < maxSteps; i += 1) {
        window.scrollBy(0, step);
        // Some lazy-loaders subscribe to scroll on window rather than using IntersectionObserver;
        // a synthetic event wakes both without depending on real scroll momentum.
        window.dispatchEvent(new Event('scroll'));
        await pause(intervalMs);
        const y = window.scrollY;
        // No forward movement ⇒ we are at (or past) the bottom; stop.
        if (y <= previousY) break;
        previousY = y;
      }
    },
    { step, intervalMs: SCROLL_INTERVAL_MS, maxSteps: MAX_SCROLL_STEPS },
  );
}

/**
 * Trigger lazy-loaded content before serialization by scrolling the whole page (spec 02 §M2). One
 * pass scrolls to the bottom, re-races a capped `networkidle` so newly-requested images land in the
 * ResourceStore, scrolls back to the top, and settles. If the sweep itself grew the document (one
 * level of infinite-scroll), it repeats ONCE. Optional stage: the caller treats a throw as a warning
 * and proceeds, so a page that never settles cannot block the clone.
 */
export async function lazyLoadSweep(page: Page, options: SweepOptions): Promise<void> {
  const step = scrollStepPx(options.viewportHeight);
  let heightBefore = await page.evaluate(() => document.body.scrollHeight);

  // Pass 0 always runs; pass 1 runs only if pass 0 revealed more page. The loop can never run more
  // than twice — that is the spec's "repeat ONCE" bound.
  for (let pass = 0; pass < 2; pass += 1) {
    await scrollToBottom(page, step);

    const idleCap = Math.min(NETWORKIDLE_CAP_MS, Math.max(0, options.deadline - Date.now()));
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 0 }).catch(() => undefined),
      sleep(idleCap),
    ]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(options.settleMs);

    const heightAfter = await page.evaluate(() => document.body.scrollHeight);
    if (heightAfter <= heightBefore) break;
    heightBefore = heightAfter;
  }
}

/**
 * Best-effort robots.txt check for the captured path. Fetches `<origin>/robots.txt` in the browser
 * context (real UA) and returns whether a `User-agent: *` group `Disallow`s the path. Any
 * fetch/parse failure ⇒ `false` (no warning): the clone always proceeds, this only feeds a notice.
 */
export async function checkRobotsDisallowed(context: BrowserContext, pageUrl: string): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(pageUrl);
  } catch {
    return false;
  }
  try {
    const response = await context.request.get(`${target.origin}/robots.txt`);
    if (!response.ok()) return false;
    return pathIsDisallowed(await response.text(), target.pathname);
  } catch {
    return false;
  }
}

/**
 * Parse a robots.txt body and decide whether the `User-agent: *` group disallows `pathname`.
 * Exported for unit testing (pure). A path is disallowed when it starts with a non-empty
 * `Disallow:` prefix from the wildcard group; `Disallow:` with an empty value allows everything.
 */
export function pathIsDisallowed(robotsTxt: string, pathname: string): boolean {
  let inWildcardGroup = false;
  let sawGroup = false;
  let disallowed = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === 'user-agent') {
      // A run of consecutive user-agent lines shares the following rules; reset on a new group.
      if (sawGroup) inWildcardGroup = false;
      if (value === '*') inWildcardGroup = true;
      sawGroup = false;
    } else if (field === 'disallow') {
      sawGroup = true;
      if (inWildcardGroup && value !== '' && pathname.startsWith(value)) disallowed = true;
    } else {
      sawGroup = true;
    }
  }
  return disallowed;
}
