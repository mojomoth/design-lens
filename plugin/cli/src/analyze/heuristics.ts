/**
 * The deterministic layer of `inspect`: WHICH elements can hold a role, and WITH WHAT confidence
 * (PURE — no DOM, no I/O, no culori; every export here is unit-testable without a browser).
 *
 * Spec 05 states the role heuristics as a table of ordered candidate patterns. That table is the
 * single source of truth for two consumers that must never disagree:
 *   - the in-page probe (`analyze/inspect.ts#probeElements`) evaluates {@link SELECTORS} with
 *     `Element.matches()` and ships back one boolean per selector;
 *   - the pure classifier (`analyze/inspect.ts#classify`) replays {@link ROLE_PATTERNS} over those
 *     booleans plus the measured geometry.
 * Keeping the selectors in ONE array indexed by position is what lets the classifier be tested on
 * synthetic probes: a unit test can hand-build `matches[]` without ever opening Chromium.
 *
 * Not every pattern is a selector — "largest img by area", "largest computed font-size", "short
 * text on a contrasting background" and "tall direct child of body/main" are measurements, so a
 * pattern is a tagged union ({@link RolePattern}) rather than a bare string.
 *
 * Spec: specs/05-element-inventory.md §inspect (heuristics table).
 */

/** The seven roles, in the exact order spec 05's table lists them. Order is load-bearing twice: */
/** roles are matched in this order (earlier role wins an element), and output is grouped by it. */
export const ROLES = [
  'logo',
  'nav-link',
  'hero-heading',
  'hero-image',
  'cta',
  'footer',
  'section',
] as const;

export type Role = (typeof ROLES)[number];

/** True for a string that names one of the seven roles — the `--kind` validator (spec 05). */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Capture-parity viewport: `inspect` measures at the same 1440×900, dsf 1 the clone was captured at. */
export const VIEWPORT_WIDTH = 1440;
export const VIEWPORT_HEIGHT = 900;
export const DEVICE_SCALE_FACTOR = 1;

/** A `nav a` counts as a nav-link only if its rect top sits in the top quarter of the viewport. */
export const NAV_LINK_TOP_FRACTION = 0.25;

/** The fallback CTA test: at most this many words of text… */
export const CTA_MAX_WORDS = 4;
/** …AND a background at least this far (OKLab Euclidean) from the body background. */
export const CTA_MIN_DELTA_E = 0.15;

/** A direct child of `body`/`main` is a `section` only above this rendered height. */
export const SECTION_MIN_HEIGHT_PX = 200;

/** Per-role output caps (spec 05). Roles absent here are uncapped or single-element. */
export const ROLE_LIMITS: Readonly<Partial<Record<Role, number>>> = {
  cta: 8,
  section: 12,
};

/** Roles that yield AT MOST ONE element: best pattern first, then document order. */
export const SINGLE_ELEMENT_ROLES: ReadonlySet<Role> = new Set<Role>([
  'logo',
  'hero-heading',
  'hero-image',
]);

/** `text` is a preview, not a transcript — collapsed innerText is truncated to this many chars. */
export const MAX_TEXT_CHARS = 120;

const BASE_CONFIDENCE = 0.9;
const CONFIDENCE_STEP = 0.1;
const MIN_CONFIDENCE = 0.5;

/**
 * Confidence for a role's Nth candidate pattern: 0.9 for the first, −0.1 per subsequent, floor 0.5.
 *
 * Rounded on purpose: `0.9 - 2 * 0.1` is `0.7000000000000001` in IEEE-754, and this number is
 * serialized straight into the stdout contract, where a 17-digit float would be both ugly and
 * non-obviously unstable across engines.
 */
export function confidenceForPattern(patternIndex: number): number {
  const raw = BASE_CONFIDENCE - CONFIDENCE_STEP * patternIndex;
  return Math.max(MIN_CONFIDENCE, Math.round(raw * 10) / 10);
}

/**
 * Every CSS selector any pattern needs, deduplicated and FROZEN BY INDEX. The probe ships
 * `matches[i] = el.matches(SELECTORS[i])`; patterns refer to selectors by index only. Never
 * reorder or splice this array — insert at the end.
 */
export const SELECTORS = [
  /* 0 */ 'header img',
  /* 1 */ '[class*="logo" i]',
  /* 2 */ 'a[href="/"] img, a[href="/"] svg',
  /* 3 */ 'header svg, header img, [role="banner"] svg, [role="banner"] img',
  /* 4 */ 'nav a',
  /* 5 */ '[role="navigation"] a',
  /* 6 */ 'h1',
  /* 7 */ 'a[class*="btn" i], a[class*="cta" i], button[class*="btn" i], button[class*="cta" i]',
  /* 8 */ 'footer',
  /* 9 */ '[role="contentinfo"]',
  /* 10 */ 'a, button',
] as const;

/** Index into {@link SELECTORS} — named so the pattern table reads like spec 05's own table. */
const SEL = {
  headerImg: 0,
  logoClass: 1,
  homeLinkMedia: 2,
  bannerMedia: 3,
  navAnchor: 4,
  navRoleAnchor: 5,
  h1: 6,
  btnOrCtaClass: 7,
  footer: 8,
  contentinfo: 9,
  anchorOrButton: 10,
} as const;

/**
 * One row of spec 05's "Candidate patterns (evaluated in order)" column.
 *
 * `fallback: true` encodes the table's literal word "else": the pattern contributes ONLY when every
 * earlier pattern of the same role produced nothing. (For single-element roles that is implied by
 * "best pattern, then document order"; for `cta`, which yields many elements, it must be explicit —
 * otherwise a page with a `.btn` would also report every short dark-backgrounded link as a CTA.)
 */
export type RolePattern =
  /** `el.matches(SELECTORS[selector])`. */
  | { readonly kind: 'selector'; readonly selector: number; readonly fallback?: boolean }
  /** Visible, has direct text, intersects the first viewport → the largest computed font-size wins. */
  | { readonly kind: 'largest-text'; readonly fallback?: boolean }
  /** An `img` or a non-`none` `background-image`, intersecting the first viewport → largest rect area wins. */
  | { readonly kind: 'largest-media'; readonly fallback?: boolean }
  /** An `a`/`button` with ≤ {@link CTA_MAX_WORDS} words whose background contrasts with the body's. */
  | { readonly kind: 'contrasting-cta'; readonly fallback?: boolean }
  /** A direct child of `body`/`main` taller than {@link SECTION_MIN_HEIGHT_PX}. */
  | { readonly kind: 'body-or-main-child'; readonly fallback?: boolean };

/** Spec 05's heuristics table, verbatim, in evaluation order. */
export const ROLE_PATTERNS: Readonly<Record<Role, readonly RolePattern[]>> = {
  logo: [
    { kind: 'selector', selector: SEL.headerImg },
    { kind: 'selector', selector: SEL.logoClass },
    { kind: 'selector', selector: SEL.homeLinkMedia },
    { kind: 'selector', selector: SEL.bannerMedia },
  ],
  'nav-link': [
    { kind: 'selector', selector: SEL.navAnchor },
    { kind: 'selector', selector: SEL.navRoleAnchor },
  ],
  'hero-heading': [{ kind: 'selector', selector: SEL.h1 }, { kind: 'largest-text', fallback: true }],
  'hero-image': [{ kind: 'largest-media' }],
  cta: [
    { kind: 'selector', selector: SEL.btnOrCtaClass },
    { kind: 'contrasting-cta', fallback: true },
  ],
  footer: [
    { kind: 'selector', selector: SEL.footer },
    { kind: 'selector', selector: SEL.contentinfo },
  ],
  section: [{ kind: 'body-or-main-child' }],
};

/** The selector index whose matches seed the fallback-CTA candidate set. */
export const CTA_CANDIDATE_SELECTOR = SEL.anchorOrButton;

/** A `getBoundingClientRect` in CSS px, rounded to integers (spec 05 §Field semantics). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Collapse runs of whitespace, trim, cap at {@link MAX_TEXT_CHARS}; `null` when nothing is left.
 * Newlines in `innerText` are whitespace here — `text` is a one-line label for an agent to read.
 */
export function collapseText(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return collapsed.slice(0, MAX_TEXT_CHARS);
}

/** Words of visible text, counted BEFORE truncation — a 4-word CTA never becomes 5 by clipping. */
export function wordCount(raw: string): number {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? 0 : collapsed.split(' ').length;
}

/** Spec 05: "rect top is within the top 25% of the viewport" — inclusive of the boundary. */
export function isWithinNavBand(rect: Rect, viewportHeight: number): boolean {
  return rect.y >= 0 && rect.y <= viewportHeight * NAV_LINK_TOP_FRACTION;
}

/**
 * Vertical intersection with the first viewport. The page is never scrolled, so rect `y` is already
 * the distance from the top of the document; a zero-area rect (display:none, empty) intersects
 * nothing.
 */
export function intersectsFirstViewport(rect: Rect, viewportHeight: number): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.y < viewportHeight && rect.y + rect.height > 0;
}

/**
 * Make a URL the probe read out of `getComputedStyle` clone-relative again.
 *
 * `background-image` is only ever readable as the ABSOLUTE url Chromium resolved it to, which for
 * `inspect` embeds the ephemeral loopback port (`http://127.0.0.1:53124/assets/…`). Emitting that
 * would make the stdout contract non-deterministic across runs and useless as a path into the clone
 * directory, so the served origin is stripped back off. Anything else (a `data:` URI, an asset left
 * remote) is returned untouched.
 */
export function relativizeUrl(url: string, origin: string): string {
  if (url === origin) return '';
  return url.startsWith(`${origin}/`) ? url.slice(origin.length + 1) : url;
}

/** The `data-dl-id` suffix as a number, for ordering. Unparseable ids sort last, never crash. */
export function dlIdOrdinal(dlId: string): number {
  const match = /^dl-(\d+)$/.exec(dlId);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}
