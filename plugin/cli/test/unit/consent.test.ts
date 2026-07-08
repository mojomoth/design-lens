/**
 * Unit tests for consent/cookie-banner blocking (`capture/consent.ts`, T15).
 *
 * WHY these exist: consent blocking is the one clone stage whose failure is SILENT — a run with a
 * broken blocker still exits 0 and still writes a clone, just with the banner baked in. Nothing
 * downstream notices. These tests pin the four things the stage is made of, none of which need a
 * browser:
 *   1. network filters actually block (`/tracker.js$script` matches) and non-targets do not;
 *   2. an `@@` exception actually rescues a request a blocking rule would otherwise kill — the
 *      third rule in the banner fixture's filter list exists only to prove this, and it is
 *      unobservable unless a blocking rule for the same URL is present;
 *   3. cosmetic verdicts are turned back into SELECTORS (`extractCosmeticSelectors`), because the
 *      clone must REMOVE banners, not hide them — if this regressed we would silently ship the
 *      engine's `display:none` blob into `clone/index.html` and keep the banner element;
 *   4. the filter-list resolution ladder (flag → fresh cache → download → stale cache → nothing)
 *      picks the right branch, since a wrong branch means either a live-web hit in tests or a
 *      never-expiring cache.
 *
 * The downloader is injected everywhere, so these tests never touch the live web (guardrails).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { BUILTIN_CONSENT_RULES } from '../../src/capture/consent-rules.js';
import {
  createConsentBlocker,
  defaultFilterListCachePath,
  extractCosmeticSelectors,
  isCacheFresh,
  loadAdblocker,
  resolveConsentFilterList,
  resolveDefaultFilterList,
  DEFAULT_FILTER_LIST_FILENAME,
  FILTER_LIST_TTL_MS,
  type CosmeticsQuery,
  type FilterListDownloader,
} from '../../src/capture/consent.js';

/** The banner fixture's list: `###cookie-banner`, `/tracker.js$script`, `@@/hero.png$image`. */
const FIXTURE_LIST = fs.readFileSync(
  new URL('../fixtures/sites/banner/filter-list.txt', import.meta.url),
  'utf8',
);

const PAGE_URL = 'http://127.0.0.1:9999/index.html';

/** Build the adblocker `Request` the engine's `match()` consumes. */
function request(type: string, url: string): { url: string } {
  return loadAdblocker().Request.fromRawDetails({ type, url, sourceUrl: PAGE_URL });
}

/** A downloader that always fails — proves the cache/degradation branches without a network. */
const failingDownload: FilterListDownloader = () => Promise.reject(new Error('offline'));

/**
 * Run the exact cosmetic query `applyConsentBlocking` triggers via `enableBlockingInPage`, for a
 * page whose DOM exposes `ids`/`classes`, and return the selectors we would REMOVE. Generic
 * (`###id` / `##.class`) rules only surface when the matching DOM hint is supplied.
 */
function cosmeticSelectorsFor(
  filterText: string,
  hints: { ids?: string[]; classes?: string[] },
): string[] {
  const query: CosmeticsQuery = {
    url: PAGE_URL,
    hostname: '127.0.0.1',
    domain: '127.0.0.1',
    getBaseRules: true,
    getInjectionRules: false,
    getExtendedRules: false,
    getRulesFromDOM: true,
    getRulesFromHostname: true,
    ids: hints.ids ?? [],
    classes: hints.classes ?? [],
    hrefs: [],
  };
  return extractCosmeticSelectors(createConsentBlocker(filterText).getCosmeticsFilters(query).styles);
}

/** Make a temp dir; each test that touches the filesystem gets its own. */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dl-consent-'));
}

describe('consent blocker — network filters', () => {
  it('blocks a request the list targets (`/tracker.js$script`)', () => {
    // The decoy tracker in the banner fixture. If this stopped matching, the clone would fetch and
    // record third-party scripts we promised never to execute or retain.
    const blocker = createConsentBlocker(FIXTURE_LIST);
    expect(blocker.match(request('script', 'http://127.0.0.1:9999/tracker.js')).match).toBe(true);
  });

  it('leaves an untargeted request alone', () => {
    // Over-blocking is as bad as under-blocking: a blocked background image silently guts the clone.
    const blocker = createConsentBlocker(FIXTURE_LIST);
    expect(blocker.match(request('image', 'http://127.0.0.1:9999/img/bg.png')).match).toBe(false);
  });

  it('honors an `@@` exception that rescues a URL a blocking rule would kill', () => {
    // The fixture's `@@/hero.png$image` is invisible on its own (nothing blocks hero.png), so pair
    // it with a blocking rule to prove exceptions are parsed and win. Without exception support the
    // engine would happily block assets that a real filter list explicitly allowlists.
    const hero = (): { url: string } => request('image', 'http://127.0.0.1:9999/img/hero.png');
    expect(createConsentBlocker('/hero.png$image').match(hero()).match).toBe(true);
    expect(createConsentBlocker('/hero.png$image\n@@/hero.png$image').match(hero()).match).toBe(false);
  });
});

describe('consent blocker — cosmetic filters', () => {
  it('surfaces the fixture cosmetic rule as a removable selector for a page carrying that id', () => {
    // This is the exact path `applyConsentBlocking` runs: the engine returns a hide stylesheet for
    // the ids/classes observed in the DOM, and we turn it back into selectors to REMOVE.
    expect(cosmeticSelectorsFor(FIXTURE_LIST, { ids: ['cookie-banner'], classes: ['cookie-banner'] }))
      .toEqual(['#cookie-banner']);
  });

  it('yields no selectors for a page whose DOM the rules do not mention', () => {
    // Guards the removal path: a page without a banner must lose nothing.
    expect(cosmeticSelectorsFor(FIXTURE_LIST, { ids: ['hero'], classes: ['card'] })).toEqual([]);
  });
});

describe('built-in consent rules (ADR-012)', () => {
  it('removes a `.cookie-banner` container, which fanboy-cookiemonster only scopes per-domain', () => {
    // The reason this ruleset exists. The sealed fixture's banner is `class="cookie-banner"` and the
    // remote default list carries `.cookie-banner` ONLY as domain-scoped rules (ft.com###consent,
    // sellme.ee##.cookie-banner, …), which never match a loopback capture. Without a generic rule
    // here, sealed assertion A16 ("consent banner absent from the clone") cannot pass.
    expect(cosmeticSelectorsFor(BUILTIN_CONSENT_RULES, { classes: ['cookie-banner'] }))
      .toContain('.cookie-banner');
  });

  it('matches the common consent container ids and classes generically', () => {
    expect(cosmeticSelectorsFor(BUILTIN_CONSENT_RULES, { ids: ['cookie-consent'] })).toContain('#cookie-consent');
    expect(cosmeticSelectorsFor(BUILTIN_CONSENT_RULES, { classes: ['cc-window'] })).toContain('.cc-window');
    expect(cosmeticSelectorsFor(BUILTIN_CONSENT_RULES, { classes: ['gdpr-banner'] })).toContain('.gdpr-banner');
  });

  it('leaves ordinary page furniture alone', () => {
    // Over-removal silently guts a clone. Every built-in selector must name a consent UI and nothing
    // else — a `.banner` hero or a `#consent-form` field must survive.
    expect(cosmeticSelectorsFor(BUILTIN_CONSENT_RULES, {
      ids: ['hero', 'pricing', 'consent-form'],
      classes: ['banner', 'card', 'notice', 'cookie-recipe'],
    })).toEqual([]);
  });

  it('parses as valid adblock syntax carrying no network rules', () => {
    // A typo'd cosmetic rule parses to nothing rather than throwing, so assert the engine actually
    // loaded them; and consent rules must never block requests (that is the remote list's job).
    const blocker = createConsentBlocker(BUILTIN_CONSENT_RULES);
    expect(blocker.match(request('script', 'http://127.0.0.1:9999/app.js')).match).toBe(false);
    expect(cosmeticSelectorsFor(BUILTIN_CONSENT_RULES, { ids: ['cookie-banner'] })).toEqual(['#cookie-banner']);
  });
});

describe('extractCosmeticSelectors', () => {
  it('splits a multi-selector hide block on comma-newline, not on every comma', () => {
    // Load-bearing: the engine emits one selector per line, and a single selector may contain
    // commas inside a quoted attribute value. A naive `,` split would shatter it into fragments
    // that `querySelectorAll` throws on, so the whole batch of removals would be skipped.
    const styles = '#a,\n.b,\ndiv[style*="rgb(1, 2, 3)"] { display: none !important; }';
    expect(extractCosmeticSelectors(styles)).toEqual(['#a', '.b', 'div[style*="rgb(1, 2, 3)"]']);
  });

  it('collects selectors from every block when the engine emits several stylesheets', () => {
    // `getCosmeticsFilters` is called repeatedly as the DOM monitor observes new ids/classes, and
    // the generic + hostname passes produce separate blocks. Dropping any block drops removals.
    const styles = '#first { display: none !important; }\n\n#second,\n.third { display: none !important; }';
    expect(extractCosmeticSelectors(styles)).toEqual(['#first', '#second', '.third']);
  });

  it('returns nothing for the empty stylesheet the engine emits when no rule matches', () => {
    expect(extractCosmeticSelectors('')).toEqual([]);
  });
});

describe('isCacheFresh', () => {
  const now = 1_700_000_000_000;

  it('accepts an entry inside the 7-day TTL', () => {
    expect(isCacheFresh(now - (FILTER_LIST_TTL_MS - 1), now)).toBe(true);
  });

  it('rejects an entry exactly at and beyond the TTL', () => {
    // Boundary: an entry aged exactly the TTL is expired, otherwise a 7-day-old list lingers forever.
    expect(isCacheFresh(now - FILTER_LIST_TTL_MS, now)).toBe(false);
    expect(isCacheFresh(now - FILTER_LIST_TTL_MS - 1, now)).toBe(false);
  });

  it('tolerates the few-ms future mtime a just-written file reports', () => {
    // Filesystem timestamp granularity puts a fresh write slightly ahead of `Date.now()`. Calling
    // that stale would re-download the default list on every single clone.
    expect(isCacheFresh(now + 5, now)).toBe(true);
  });

  it('rejects an mtime far in the future instead of treating it as immortal', () => {
    // A wrong clock or a restored backup would otherwise pin a stale list in place permanently:
    // `now` would have to catch up to the mtime before the TTL could ever elapse.
    expect(isCacheFresh(now + 24 * 60 * 60 * 1000, now)).toBe(false);
  });
});

describe('defaultFilterListCachePath', () => {
  it('lives under the DESIGN_LENS_HOME override so a relocated home moves the cache', () => {
    // bootstrap.sh and the launcher honor DESIGN_LENS_HOME; if the cache ignored it, an installed
    // plugin with a relocated home would write outside it (and the e2e suite could not go offline).
    const previous = process.env.DESIGN_LENS_HOME;
    process.env.DESIGN_LENS_HOME = path.join(os.tmpdir(), 'dl-home-probe');
    try {
      expect(defaultFilterListCachePath()).toBe(
        path.join(os.tmpdir(), 'dl-home-probe', 'cache', 'filterlists', DEFAULT_FILTER_LIST_FILENAME),
      );
    } finally {
      if (previous === undefined) delete process.env.DESIGN_LENS_HOME;
      else process.env.DESIGN_LENS_HOME = previous;
    }
  });
});

const LIST_URL = 'https://example.invalid/list.txt';

describe('resolveDefaultFilterList', () => {
  it('uses a fresh cache entry without downloading', async () => {
    const cachePath = path.join(tmpDir(), 'cached.txt');
    fs.writeFileSync(cachePath, '###cached-rule', 'utf8');
    const warnings: string[] = [];

    const resolved = await resolveDefaultFilterList({
      cachePath,
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved).toEqual({ text: '###cached-rule', origin: 'cache' });
    expect(warnings).toEqual([]);
  });

  it('downloads and caches when no cache exists', async () => {
    const cachePath = path.join(tmpDir(), 'nested', 'filterlists', 'list.txt');
    const warnings: string[] = [];

    const resolved = await resolveDefaultFilterList({
      cachePath,
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: () => Promise.resolve('###downloaded-rule'),
      warnings,
    });

    expect(resolved).toEqual({ text: '###downloaded-rule', origin: 'download' });
    // The cache write (incl. mkdir -p) is what makes the 7-day TTL mean anything.
    expect(fs.readFileSync(cachePath, 'utf8')).toBe('###downloaded-rule');
    expect(warnings).toEqual([]);
  });

  it('falls back to an EXPIRED cache entry when the refresh download fails', async () => {
    // Offline with a stale list still beats losing the remote list's coverage; one warning is enough.
    const cachePath = path.join(tmpDir(), 'stale.txt');
    fs.writeFileSync(cachePath, '###stale-rule', 'utf8');
    const staleMtime = new Date(Date.now() - FILTER_LIST_TTL_MS - 60_000);
    fs.utimesSync(cachePath, staleMtime, staleMtime);
    const warnings: string[] = [];

    const resolved = await resolveDefaultFilterList({
      cachePath,
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved).toEqual({ text: '###stale-rule', origin: 'stale-cache' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not refresh the consent filter list/);
  });

  it('warns and yields null when there is neither a cache nor a reachable list', async () => {
    const warnings: string[] = [];
    const resolved = await resolveDefaultFilterList({
      cachePath: path.join(tmpDir(), 'absent.txt'),
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not download the consent filter list/);
  });
});

describe('resolveConsentFilterList', () => {
  it('reads --filter-list from disk, replacing the built-ins, and never downloads', async () => {
    // The flag's whole purpose is a deterministic, offline list the user chose (spec 02 §M2). If the
    // built-in consent rules leaked in, a `--filter-list` clone would remove elements the list does
    // not mention — and the e2e that proves `--filter-list` works would prove nothing.
    const dir = tmpDir();
    const listPath = path.join(dir, 'local.txt');
    fs.writeFileSync(listPath, '###local-rule', 'utf8');
    const warnings: string[] = [];

    const resolved = await resolveConsentFilterList({
      filterListPath: listPath,
      cachePath: path.join(dir, 'cache.txt'),
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved).toEqual({ text: '###local-rule', origin: 'flag' });
    expect(warnings).toEqual([]);
  });

  it('warns and yields null when --filter-list points at an unreadable file', async () => {
    // A typo'd path must not silently fall back to a different list: the user asked for THIS one.
    // This is the `consentBlocking: "unavailable"` path — it must degrade, never throw.
    const warnings: string[] = [];
    const resolved = await resolveConsentFilterList({
      filterListPath: path.join(tmpDir(), 'missing.txt'),
      cachePath: path.join(tmpDir(), 'cache.txt'),
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/--filter-list .*could not be read/);
  });

  it('prepends the built-in rules to the remote default list', async () => {
    const cachePath = path.join(tmpDir(), 'cached.txt');
    fs.writeFileSync(cachePath, '###remote-rule', 'utf8');
    const warnings: string[] = [];

    const resolved = await resolveConsentFilterList({
      cachePath,
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved?.origin).toBe('builtin+cache');
    expect(resolved?.text).toContain('##.cookie-banner');
    expect(resolved?.text).toContain('###remote-rule');
  });

  it('degrades to the built-in rules alone when the remote list is unreachable', async () => {
    // ADR-012: an offline machine loses the long tail, not consent blocking itself. If this returned
    // null the stage would report "unavailable" and every banner would survive an offline clone.
    const warnings: string[] = [];
    const resolved = await resolveConsentFilterList({
      cachePath: path.join(tmpDir(), 'absent.txt'),
      listUrl: LIST_URL,
      timeoutMs: 1_000,
      now: Date.now(),
      download: failingDownload,
      warnings,
    });

    expect(resolved).toEqual({ text: BUILTIN_CONSENT_RULES, origin: 'builtin' });
    expect(warnings[0]).toMatch(/falling back to the built-in generic consent rules/);
  });
});
