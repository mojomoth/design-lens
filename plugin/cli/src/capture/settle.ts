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
