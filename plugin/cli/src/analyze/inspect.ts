/// <reference lib="dom" />
/**
 * The two halves of `inspect`'s element inventory, both free of I/O:
 *
 *  1. {@link probeElements} — runs INSIDE Chromium (hence the DOM lib reference). It is the only
 *     code that may touch layout, and it makes no decisions: for every element under `<body>` it
 *     reports geometry, computed styles, and one boolean per {@link SELECTORS} entry. It is passed
 *     to `page.evaluate`, so it must stay self-contained — no closed-over module constants, or the
 *     bundled/minified copy that crosses into the page will throw `ReferenceError`.
 *
 *  2. {@link classify} — pure Node. It replays spec 05's ordered heuristics table over those
 *     probes: earlier roles claim elements before later ones, single-element roles pick their best
 *     pattern then document order, confidence falls 0.1 per pattern, caps and orderings apply.
 *
 * That seam is what makes the role logic testable without a browser: a unit test hands `classify`
 * synthetic probes and asserts the inventory, while only the e2e proves the probe reads a real
 * clone correctly. The alternative — deciding roles in the page — would be untestable and would put
 * `culori` (needed for the CTA contrast test) inside `page.evaluate`.
 *
 * Nothing here is ever written to disk: the inventory is stdout-only and ephemeral (ADR-002).
 *
 * Spec: specs/05-element-inventory.md §inspect.
 */

import { differenceEuclidean, parse as parseColor } from 'culori';

import {
  CTA_CANDIDATE_SELECTOR,
  CTA_MAX_WORDS,
  CTA_MIN_DELTA_E,
  ROLE_LIMITS,
  ROLE_PATTERNS,
  ROLES,
  SECTION_MIN_HEIGHT_PX,
  SINGLE_ELEMENT_ROLES,
  collapseText,
  confidenceForPattern,
  dlIdOrdinal,
  intersectsFirstViewport,
  isWithinNavBand,
  relativizeUrl,
  wordCount,
  type Rect,
  type Role,
  type RolePattern,
} from './heuristics.js';

// ---------------------------------------------------------------------------------------------
// The wire shape between the page and Node
// ---------------------------------------------------------------------------------------------

/** Computed styles spec 05 requires on every reported element. `background` is `background-color`. */
export interface ElementStyles {
  color: string;
  background: string;
  fontSize: string;
  fontFamily: string;
}

/** One measured element, exactly as {@link probeElements} returns it (JSON-serializable). */
export interface ElementProbe {
  /** `data-dl-id`, or null when the element was never stamped (spec 05: skip + warn). */
  dlId: string | null;
  tag: string;
  /** Raw `innerText` (or `textContent` for non-HTML elements); collapsed/truncated in Node. */
  rawText: string;
  /** True when a direct child text node holds non-whitespace — "having direct text" (spec 05). */
  hasDirectText: boolean;
  /** `img@src` as written, else the first `url()` of a non-`none` `background-image`, else null. */
  src: string | null;
  rect: Rect;
  styles: ElementStyles;
  /** `font-size` as a number, so "largest computed font-size" is a comparison and not a parse. */
  fontSizePx: number;
  visible: boolean;
  hasBackgroundImage: boolean;
  directChildOfBodyOrMain: boolean;
  /** Position in the `body` descendant walk — the deterministic "document order" tiebreak. */
  docIndex: number;
  /** `matches[i] === el.matches(SELECTORS[i])`. */
  matches: boolean[];
}

/** Everything one `page.evaluate` round-trip yields. */
export interface PageProbe {
  probes: ElementProbe[];
  /** `getComputedStyle(document.body).backgroundColor` — the CTA contrast reference. */
  bodyBackground: string;
}

/**
 * Measure every element under `<body>`. Runs in the page; `selectors` is passed in because a
 * serialized function cannot see this module's scope.
 *
 * Walk light DOM and open shadow trees. Generated responsive proxies are not role candidates;
 * the active proxy body supplies the same context as the original body. Hidden alternatives are
 * measured but cannot displace visible role candidates.
 */
export function probeElements(selectors: readonly string[]): PageProbe {
  const activeHost = Array.from(document.querySelectorAll('[data-dl-generated="host"]'))
    .find((host) => host.shadowRoot && getComputedStyle(host).display !== 'none');
  const activeBody = activeHost?.shadowRoot?.querySelector('[data-dl-generated="body"]') ?? document.body;
  const bodyStyle = getComputedStyle(activeBody);
  const probes: ElementProbe[] = [];
  const elements: Element[] = [];
  const stack = Array.from(document.body.children).reverse();
  while (stack.length > 0) {
    const element = stack.pop()!;
    if (element.getAttribute('data-dl-generated') === 'host' && element.shadowRoot
        && getComputedStyle(element).display === 'none') continue;
    elements.push(element);
    stack.push(...Array.from(element.children).reverse());
    if (element.shadowRoot) stack.push(...Array.from(element.shadowRoot.children).reverse());
  }

  for (let docIndex = 0; docIndex < elements.length; docIndex += 1) {
    const element = elements[docIndex];
    if (element.hasAttribute('data-dl-generated') || ['style', 'link', 'template'].includes(element.tagName.toLowerCase())) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const rect = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };

    const backgroundImage = style.backgroundImage;
    const hasBackgroundImage = backgroundImage !== '' && backgroundImage !== 'none';

    let src: string | null = null;
    if (element.tagName.toLowerCase() === 'img') {
      src = element.getAttribute('src');
    } else if (hasBackgroundImage) {
      // Chromium always quotes the url() it echoes back from getComputedStyle.
      const urlMatch = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(backgroundImage);
      src = urlMatch ? (urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? null) : null;
    }

    let hasDirectText = false;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3 && (node.textContent ?? '').trim() !== '') {
        hasDirectText = true;
        break;
      }
    }

    // SVG elements have no `innerText`; textContent is the honest fallback.
    const maybeInnerText = (element as HTMLElement).innerText;
    const rawText = typeof maybeInnerText === 'string' ? maybeInnerText : (element.textContent ?? '');

    const matches: boolean[] = [];
    for (const selector of selectors) {
      let matched = false;
      try {
        matched = element.matches(selector);
      } catch {
        // An engine that cannot parse one selector must not sink the whole inventory.
        matched = false;
      }
      matches.push(matched);
    }

    const parent = element.parentElement;
    const parentTag = parent?.getAttribute('data-dl-generated') === 'body' ? 'body' : parent ? parent.tagName.toLowerCase() : '';
    const physicalTag = element.tagName.toLowerCase();
    const tag = physicalTag.includes('-') && element.getAttribute('data-dl-original-tag') === 'p' ? 'p' : physicalTag;

    probes.push({
      dlId: element.getAttribute('data-dl-id'),
      tag,
      rawText,
      hasDirectText,
      src,
      rect,
      styles: {
        color: style.color,
        background: style.backgroundColor,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      },
      fontSizePx: Number.parseFloat(style.fontSize) || 0,
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      hasBackgroundImage,
      directChildOfBodyOrMain: parentTag === 'body' || parentTag === 'main',
      docIndex,
      matches,
    });
  }

  return { probes, bodyBackground: bodyStyle.backgroundColor };
}

// ---------------------------------------------------------------------------------------------
// The stdout document
// ---------------------------------------------------------------------------------------------

/** One inventory entry (spec 05 §`inspect` stdout schema — key order IS the schema's). */
export interface InspectElement {
  dlId: string;
  role: Role;
  confidence: number;
  tag: string;
  /** Always exactly `[data-dl-id="<dlId>"]`, the addressing contract every skill edits through. */
  selector: string;
  text: string | null;
  src: string | null;
  rect: Rect;
  styles: ElementStyles;
}

export interface InspectDocument {
  elements: InspectElement[];
  /** A pointer, not data: color analysis is `tokens.json`'s job, never duplicated here (spec 05). */
  colors: 'see tokens.json';
}

/** Directly addressed containers need no invented semantic role. */
export interface UnclassifiedInspectElement extends Omit<InspectElement, 'role' | 'confidence'> {
  role: null;
  confidence: null;
}

export interface ClassifyContext {
  /** The ephemeral server origin, stripped back out of computed `background-image` urls. */
  origin: string;
  viewportHeight: number;
}

export interface Classification {
  document: InspectDocument;
  /** Candidates dropped for want of a `data-dl-id`; the caller prints these to stderr. */
  warnings: string[];
}

const oklabDistance = differenceEuclidean('oklab');

/** White: the CSS initial background, and what a fully transparent `body` actually paints against. */
const DEFAULT_BODY_BACKGROUND = '#ffffff';

/**
 * OKLab distance between two CSS colors, or `null` when either side carries no color.
 *
 * A fully transparent background is the trap here (it is the DEFAULT for `<a>` and `<button>`):
 * culori resolves `rgba(0, 0, 0, 0)` to black, which sits deltaE ≈ 1.0 from a white page — so every
 * unstyled link on earth would pass the CTA contrast test. Alpha 0 means "no background", so it is
 * dropped rather than measured.
 */
function backgroundDeltaE(color: string, reference: string): number | null {
  const left = parseColor(color);
  const right = parseColor(reference);
  if (!left || !right) return null;
  if (left.alpha === 0 || right.alpha === 0) return null;
  return oklabDistance(left, right);
}

/** The body background, falling back to white when the page leaves it transparent/unparseable. */
function resolveBodyBackground(raw: string): string {
  const parsed = parseColor(raw);
  if (!parsed || parsed.alpha === 0) return DEFAULT_BODY_BACKGROUND;
  return raw;
}

/** Every probe a single pattern considers, BEFORE dl-id filtering and before earlier-role removal. */
function candidatesForPattern(
  pattern: RolePattern,
  probes: ElementProbe[],
  context: ClassifyContext,
  bodyBackground: string,
): ElementProbe[] {
  switch (pattern.kind) {
    case 'selector':
      return probes.filter((probe) => probe.matches[pattern.selector] === true);
    case 'largest-text':
      return probes.filter(
        (probe) =>
          probe.visible &&
          probe.hasDirectText &&
          intersectsFirstViewport(probe.rect, context.viewportHeight),
      );
    case 'largest-media':
      return probes.filter(
        (probe) =>
          (probe.tag === 'img' || probe.hasBackgroundImage) &&
          intersectsFirstViewport(probe.rect, context.viewportHeight),
      );
    case 'contrasting-cta':
      return probes.filter((probe) => {
        if (probe.matches[CTA_CANDIDATE_SELECTOR] !== true) return false;
        const words = wordCount(probe.rawText);
        if (words === 0 || words > CTA_MAX_WORDS) return false;
        const delta = backgroundDeltaE(probe.styles.background, bodyBackground);
        return delta !== null && delta > CTA_MIN_DELTA_E;
      });
    case 'body-or-main-child':
      return probes.filter(
        (probe) => probe.directChildOfBodyOrMain && probe.rect.height > SECTION_MIN_HEIGHT_PX,
      );
  }
}

/** Role-wide filters that apply to every pattern of that role (spec 05's per-row qualifiers). */
function passesRoleFilter(role: Role, probe: ElementProbe, context: ClassifyContext): boolean {
  if (!probe.visible) return false;
  if (role === 'nav-link') return isWithinNavBand(probe.rect, context.viewportHeight);
  return true;
}

/**
 * A probe that survived the `data-dl-id` filter. Carrying `dlId` as a non-nullable field is what
 * lets the rest of the pipeline stay assertion-free: an un-addressable element is unrepresentable.
 */
interface Candidate {
  probe: ElementProbe;
  dlId: string;
}

/** The one element a single-element role keeps out of a pattern's matches. */
function pickBest(pattern: RolePattern, matches: Candidate[]): Candidate {
  const byDocOrder = [...matches].sort((a, b) => a.probe.docIndex - b.probe.docIndex);
  if (pattern.kind === 'largest-text') {
    return byDocOrder.reduce((best, c) => (c.probe.fontSizePx > best.probe.fontSizePx ? c : best));
  }
  if (pattern.kind === 'largest-media') {
    const area = (c: Candidate): number => c.probe.rect.width * c.probe.rect.height;
    return byDocOrder.reduce((best, c) => (area(c) > area(best) ? c : best));
  }
  // Selector patterns and the CTA fallback: first in document order.
  return byDocOrder[0];
}

export function toElement(candidate: Candidate, role: Role, confidence: number, origin: string): InspectElement;
export function toElement(candidate: Candidate, role: null, confidence: null, origin: string): UnclassifiedInspectElement;
export function toElement(
  candidate: Candidate,
  role: Role | null,
  confidence: number | null,
  origin: string,
): Omit<InspectElement, 'role' | 'confidence'> & { role: Role | null; confidence: number | null } {
  const { probe, dlId } = candidate;
  return {
    dlId,
    role,
    confidence,
    tag: probe.tag,
    selector: `[data-dl-id="${dlId}"]`,
    text: collapseText(probe.rawText),
    src: probe.src === null ? null : relativizeUrl(probe.src, origin),
    rect: probe.rect,
    styles: probe.styles,
  };
}

/**
 * Replay spec 05's heuristics table over one page's probes.
 *
 * The three invariants that make the output an addressable inventory rather than a pile of guesses:
 *   - an element assigned by an earlier role is invisible to later ones (a `<nav>` link is never
 *     also a CTA), and only EMITTED elements are consumed — a match dropped by a `max` cap stays
 *     available to the roles below it;
 *   - a candidate without `data-dl-id` cannot be addressed, so it is warned about and skipped
 *     BEFORE it can occupy a single-element role's only slot;
 *   - within a role, output is ascending numeric `data-dl-id`, never match order.
 */
export function classify(page: PageProbe, context: ClassifyContext): Classification {
  const bodyBackground = resolveBodyBackground(page.bodyBackground);
  const warnings: string[] = [];
  const assigned = new Set<number>();
  const elements: InspectElement[] = [];

  for (const role of ROLES) {
    const patterns = ROLE_PATTERNS[role];
    const single = SINGLE_ELEMENT_ROLES.has(role);
    const warned = new Set<number>();
    const collected: { candidate: Candidate; confidence: number }[] = [];

    for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
      const pattern = patterns[patternIndex];
      // "else …" in spec 05's table: a fallback pattern runs only when the role is still empty.
      if (pattern.fallback === true && collected.length > 0) break;

      const matches: Candidate[] = [];
      for (const probe of candidatesForPattern(pattern, page.probes, context, bodyBackground)) {
        if (assigned.has(probe.docIndex)) continue;
        if (!passesRoleFilter(role, probe, context)) continue;
        if (probe.dlId === null || probe.dlId === '') {
          if (!warned.has(probe.docIndex)) {
            warned.add(probe.docIndex);
            warnings.push(`candidate without data-dl-id skipped: <${probe.tag}> (role ${role})`);
          }
          continue;
        }
        matches.push({ probe, dlId: probe.dlId });
      }

      if (matches.length === 0) continue;

      const confidence = confidenceForPattern(patternIndex);
      if (single) {
        collected.push({ candidate: pickBest(pattern, matches), confidence });
        break; // "best pattern, then document order" — later patterns never refine a hit.
      }
      for (const candidate of matches) {
        // An element matched by two patterns of one role keeps the EARLIER (higher) confidence.
        if (!collected.some((entry) => entry.candidate.probe.docIndex === candidate.probe.docIndex)) {
          collected.push({ candidate, confidence });
        }
      }
    }

    const limit = ROLE_LIMITS[role];
    const ordered = collected.sort((a, b) => {
      const byId = dlIdOrdinal(a.candidate.dlId) - dlIdOrdinal(b.candidate.dlId);
      return byId !== 0 ? byId : a.candidate.probe.docIndex - b.candidate.probe.docIndex;
    });
    const emitted = limit === undefined ? ordered : ordered.slice(0, limit);

    for (const entry of emitted) {
      assigned.add(entry.candidate.probe.docIndex);
      elements.push(toElement(entry.candidate, role, entry.confidence, context.origin));
    }
  }

  return { document: { elements, colors: 'see tokens.json' }, warnings };
}

/** Keep only one role's elements — the `--kind` projection. Empty is a valid answer (spec 05). */
export function filterByRole(document: InspectDocument, role: Role): InspectDocument {
  return { elements: document.elements.filter((element) => element.role === role), colors: document.colors };
}
