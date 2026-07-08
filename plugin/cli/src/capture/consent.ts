/**
 * Consent/cookie-banner blocking — applied between launch and navigate (spec 02 §M2).
 *
 * The engine is `@ghostery/adblocker-playwright`, EXTERNAL to the bundle (spec 01, ADR-005: it is
 * MPL-2.0), so it is reached through `lib/runtime-deps.ts#loadRuntimeDep`, never a top-level import.
 *
 * ONE construction path. The blocker is ALWAYS built by reading filter-list TEXT and handing it to
 * `PlaywrightBlocker.parse(text)`. `--filter-list <file>` supplies that text from a local file and
 * REPLACES the default entirely (that is what makes it "a local list, deterministic tests, no
 * network" per spec 02). Otherwise the text is `consent-rules.ts`'s built-in generic ruleset plus
 * the cached remote default list (`<DESIGN_LENS_HOME>/cache/filterlists/`, 7-day TTL keyed on file
 * mtime), refreshed by download when stale. A download failure warns and leaves the built-in rules
 * standing (ADR-012); only a list that cannot be parsed — or an unreadable `--filter-list` — yields
 * `consentBlocking: "unavailable"`. Nothing here is fatal (degradation ladder, spec 02 §Error handling).
 *
 * WHY the two injection methods are overridden in {@link applyConsentBlocking}. `enableBlockingInPage`
 * gives us the two things we want — network blocking (`page.route`) and the engine's DOM-driven
 * discovery of which cosmetic rules match this page — but it *applies* the cosmetic result by
 * calling `this.injectStylesIntoFrame`, i.e. `frame.addStyleTag()` with a `display: none !important`
 * blob that can run to hundreds of KB for a real list. Two problems for a clone: the blob would be
 * serialized straight into `clone/index.html`, and hiding is not removing — the banner would still
 * be in the markup (sealed A16 and spec 08's banner e2e both assert ABSENCE). Both inject methods
 * dispatch through `this`, so overriding them on the instance intercepts the engine's cosmetic
 * verdict instead of applying it: we collect the selectors and hand them to `capture/stamp.ts`,
 * which REMOVES the matching elements before stamping. Scriptlet injection is dropped outright —
 * the clone is "a photograph, not a program" (guardrails), so no third-party script may run in the
 * capture and mutate the page we are photographing.
 *
 * Spec: specs/02-clone-engine.md §M2 (Consent blocking); specs/01-packaging.md (external deps).
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Page } from 'playwright';

import { designLensHome } from '../lib/home.js';
import { loadRuntimeDep } from '../lib/runtime-deps.js';
import { BUILTIN_CONSENT_RULES } from './consent-rules.js';

/** The external package name; also the key `bootstrap.sh` installs into the runtime prefix. */
export const ADBLOCKER_PACKAGE = '@ghostery/adblocker-playwright';

/** Default consent list (spec 02 §M2). Fetched only when the cached copy is missing or stale. */
export const DEFAULT_FILTER_LIST_URL = 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt';

/** On-disk name of the cached default list, under `<home>/cache/filterlists/`. */
export const DEFAULT_FILTER_LIST_FILENAME = 'fanboy-cookiemonster.txt';

/** Cache lifetime keyed on file mtime (spec 02 §M2: 7-day TTL). */
export const FILTER_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Value recorded in `REPORT.md` "Capture results" (spec 02 §M2 enumerates exactly these three). */
export type ConsentBlockingStatus = 'enabled' | 'disabled' | 'unavailable';

/** The slice of an adblocker `Request` the engine's `match()` consumes. */
export interface AdblockerRequest {
  readonly url: string;
}

/** `match()` verdict. `match: true` ⇒ the request is blocked (an `@@` exception yields `false`). */
export interface MatchResult {
  match: boolean;
}

/** The `getCosmeticsFilters` query. Generic rules only surface when DOM hints are supplied. */
export interface CosmeticsQuery {
  url: string;
  hostname: string;
  domain: string;
  getBaseRules: boolean;
  getInjectionRules: boolean;
  getExtendedRules: boolean;
  getRulesFromDOM: boolean;
  getRulesFromHostname: boolean;
  ids?: string[];
  classes?: string[];
  hrefs?: string[];
}

/**
 * The slice of `PlaywrightBlocker` this module uses. Declared structurally so the bundle typechecks
 * without the external package in scope (the `capture/browser.ts` pattern). `injectStylesIntoFrame`
 * and `injectScriptletsIntoFrame` are writable on purpose — see the module docstring.
 */
export interface ConsentBlocker {
  enableBlockingInPage(page: Page): Promise<unknown>;
  injectStylesIntoFrame(frame: unknown, styles: string): Promise<void>;
  injectScriptletsIntoFrame(frame: unknown, scripts: string[]): Promise<void>;
  match(request: AdblockerRequest): MatchResult;
  getCosmeticsFilters(query: CosmeticsQuery): { styles: string };
}

/** The slice of the adblocker module object we load at run time. */
export interface AdblockerModule {
  PlaywrightBlocker: { parse(filters: string): ConsentBlocker };
  Request: {
    fromRawDetails(details: { type: string; url: string; sourceUrl?: string }): AdblockerRequest;
  };
}

/** Load the external adblocker module (repo `node_modules` or `~/.design-lens/runtime`). */
export function loadAdblocker(): AdblockerModule {
  return loadRuntimeDep<AdblockerModule>(ADBLOCKER_PACKAGE);
}

/** Absolute path of the cached default filter list, honoring `DESIGN_LENS_HOME`. */
export function defaultFilterListCachePath(): string {
  return path.join(designLensHome(), 'cache', 'filterlists', DEFAULT_FILTER_LIST_FILENAME);
}

/**
 * How far ahead of `now` an mtime may sit before we stop believing it. A file written moments ago
 * routinely reports an mtime a few ms in the future (filesystem timestamp granularity), so a strict
 * `age >= 0` test would call a brand-new cache entry stale and re-download on every run.
 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Is a cache entry with this mtime still inside the TTL? An mtime FAR in the future (a wrong clock,
 * a restored backup) is distrusted and treated as stale — otherwise the entry would never refresh,
 * since `now` would have to catch up to it first.
 */
export function isCacheFresh(mtimeMs: number, nowMs: number, ttlMs: number = FILTER_LIST_TTL_MS): boolean {
  const ageMs = nowMs - mtimeMs;
  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) return false;
  return ageMs < ttlMs;
}

/**
 * Pull the selectors out of one cosmetic-hide stylesheet as emitted by `getCosmeticsFilters`, i.e.
 * `sel1,\nsel2,\nsel3 { display: none !important; }` (possibly several such blocks).
 *
 * Splitting on `,\n` rather than `,` is load-bearing: the engine emits exactly one selector per
 * line, while a single selector may legitimately contain commas inside a quoted attribute value
 * (e.g. `div[style*="rgb(136, 136, 136)"]`). A bare comma split would shatter those into
 * unparseable fragments.
 */
export function extractCosmeticSelectors(stylesCss: string): string[] {
  const selectors: string[] = [];
  for (const block of stylesCss.split('}')) {
    const brace = block.lastIndexOf('{');
    if (brace === -1) continue;
    for (const candidate of block.slice(0, brace).split(/,\r?\n/)) {
      const selector = candidate.trim();
      if (selector.length > 0) selectors.push(selector);
    }
  }
  return selectors;
}

/** Fetch a filter list over HTTP. Injectable so unit tests never touch the live web (guardrails). */
export type FilterListDownloader = (url: string, timeoutMs: number) => Promise<string>;

/** The production downloader: plain `fetch` with a hard abort, no redirects beyond the default. */
export const httpFilterListDownloader: FilterListDownloader = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

/** Where the remote default list came from — surfaced on stderr so a stale cache is never a mystery. */
export type DefaultListOrigin = 'cache' | 'download' | 'stale-cache';

/** Where the parsed filter text as a whole came from. `builtin` ⇒ no remote list was obtainable. */
export type FilterListOrigin = 'flag' | 'builtin' | `builtin+${DefaultListOrigin}`;

export interface ResolvedDefaultList {
  text: string;
  origin: DefaultListOrigin;
}

export interface ResolvedFilterList {
  text: string;
  origin: FilterListOrigin;
}

export interface ResolveDefaultListOptions {
  /** Absolute path of the cached default list. */
  cachePath: string;
  /** URL of the default list, fetched only when the cache is missing/stale. */
  listUrl: string;
  /** Hard cap for the download, in milliseconds. */
  timeoutMs: number;
  /** `Date.now()` at the call site, injected so the TTL branch is testable. */
  now: number;
  /** Injected so tests exercise the cache/stale/failure branches without a network. */
  download: FilterListDownloader;
  /** Non-fatal degradations are appended here (spec 02 §Error handling). */
  warnings: string[];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read the cache entry with its mtime, or `null` when it does not exist / cannot be read. */
function readCache(cachePath: string): { text: string; mtimeMs: number } | null {
  try {
    const text = fs.readFileSync(cachePath, 'utf8');
    return { text, mtimeMs: fs.statSync(cachePath).mtimeMs };
  } catch {
    // A missing or unreadable cache is the normal first-run state, not an error worth reporting:
    // the caller's next step is to download, and a download failure IS reported.
    return null;
  }
}

/**
 * Resolve the REMOTE default list (cache → download → stale cache), or `null` when none is
 * obtainable. Never throws: every failure becomes a warning. The caller composes the result with
 * {@link BUILTIN_CONSENT_RULES}, so a `null` here degrades to "fewer rules", not "no blocking".
 */
export async function resolveDefaultFilterList(
  options: ResolveDefaultListOptions,
): Promise<ResolvedDefaultList | null> {
  const cached = readCache(options.cachePath);
  if (cached !== null && isCacheFresh(cached.mtimeMs, options.now)) {
    return { text: cached.text, origin: 'cache' };
  }

  let downloaded: string;
  try {
    downloaded = await options.download(options.listUrl, options.timeoutMs);
  } catch (err) {
    if (cached !== null) {
      options.warnings.push(
        `could not refresh the consent filter list from ${options.listUrl} (${describe(err)}); ` +
          'using the expired cached copy',
      );
      return { text: cached.text, origin: 'stale-cache' };
    }
    options.warnings.push(
      `could not download the consent filter list from ${options.listUrl} (${describe(err)}); ` +
        'falling back to the built-in generic consent rules',
    );
    return null;
  }

  // Caching is best-effort: a read-only home must not cost us the list we just fetched.
  try {
    fs.mkdirSync(path.dirname(options.cachePath), { recursive: true });
    fs.writeFileSync(options.cachePath, downloaded, 'utf8');
  } catch (err) {
    options.warnings.push(
      `could not cache the consent filter list at ${options.cachePath} (${describe(err)})`,
    );
  }
  return { text: downloaded, origin: 'download' };
}

export interface ResolveConsentFilterListOptions extends ResolveDefaultListOptions {
  /** `--filter-list <file>`; when set it REPLACES the whole default text — built-ins included. */
  filterListPath?: string;
}

/**
 * Resolve the filter-list text this run will parse, or `null` ⇒ `consentBlocking: "unavailable"`.
 *
 * `--filter-list` replaces everything: the user named an exact list, so neither the remote default
 * nor design-lens's built-in rules are silently mixed in (this is also what makes `--filter-list`
 * deterministic and offline for tests). An unreadable `--filter-list` therefore fails the stage
 * rather than quietly substituting a different list.
 *
 * Otherwise the text is the built-in generic ruleset (ADR-012) plus the remote default list when one
 * is obtainable, so a download failure costs coverage rather than the whole stage.
 */
export async function resolveConsentFilterList(
  options: ResolveConsentFilterListOptions,
): Promise<ResolvedFilterList | null> {
  if (options.filterListPath !== undefined) {
    try {
      return { text: fs.readFileSync(options.filterListPath, 'utf8'), origin: 'flag' };
    } catch (err) {
      options.warnings.push(
        `--filter-list ${options.filterListPath} could not be read (${describe(err)}); ` +
          'consent blocking is unavailable for this run',
      );
      return null;
    }
  }

  const remote = await resolveDefaultFilterList(options);
  if (remote === null) return { text: BUILTIN_CONSENT_RULES, origin: 'builtin' };
  return { text: `${BUILTIN_CONSENT_RULES}\n${remote.text}`, origin: `builtin+${remote.origin}` };
}

/** Parse filter-list text into a blocker. Throws on a list the engine cannot parse. */
export function createConsentBlocker(filterListText: string): ConsentBlocker {
  return loadAdblocker().PlaywrightBlocker.parse(filterListText);
}

/** Live consent-blocking state for one page. */
export interface ConsentBlockingHandle {
  /**
   * Every cosmetic-hide selector the engine has matched for this page so far. The caller feeds
   * these to `capture/stamp.ts`, which REMOVES the matches — the clone must not merely hide them.
   */
  cosmeticSelectors(): string[];
}

/**
 * Wire the blocker into the page: network filters block requests via `page.route`, while the
 * engine's cosmetic verdicts are intercepted (never injected) and accumulated for removal. Must be
 * called BEFORE `page.goto` so the first document's requests are already filtered.
 */
export async function applyConsentBlocking(
  page: Page,
  blocker: ConsentBlocker,
): Promise<ConsentBlockingHandle> {
  const collected = new Set<string>();

  blocker.injectStylesIntoFrame = (_frame: unknown, styles: string): Promise<void> => {
    for (const selector of extractCosmeticSelectors(styles)) collected.add(selector);
    return Promise.resolve();
  };
  // Scriptlets would execute third-party JS inside the capture and mutate the page we photograph.
  blocker.injectScriptletsIntoFrame = (): Promise<void> => Promise.resolve();

  await blocker.enableBlockingInPage(page);

  return { cosmeticSelectors: (): string[] => [...collected] };
}
