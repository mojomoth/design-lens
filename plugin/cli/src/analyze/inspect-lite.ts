/// <reference lib="dom" />
/**
 * `inspect --lite`: a compact, target-only projection of the live clone.
 *
 * Two halves, split like `analyze/inspect.ts`:
 *
 *  1. {@link probeLite} runs INSIDE Chromium. It walks the light DOM and every open shadow root
 *     once to build an id → element map (no computed styles), resolves `--id`/`--selector`/`--all`
 *     targets, and reads computed styles for those targets only. It is passed to `page.evaluate`,
 *     so it must stay self-contained: the minified bundle renames module-scope bindings.
 *
 *  2. {@link projectLiteElement} is pure Node: it drops CSS-initial values, compacts four-sided
 *     values, rounds geometry and removes the ephemeral serving origin.
 *
 * Composed responsive clones keep every capture variant in its own `[data-dl-generated="host"]`
 * shadow tree, and data-dl-ids are variant-specific. Selectors are therefore evaluated in every
 * tree (active variant first) and an id that only exists in an inactive variant is reported with
 * `v: 0` rather than failing.
 */

import * as csstree from 'css-tree';

import type { FontReadiness } from '../capture/browser.js';
import type { Role } from './heuristics.js';
import type { Viewport } from '../lib/viewport.js';

/** Selector fan-out cap; an unbounded `div` on a composed clone would rebuild the 57 MB dump. */
export const LITE_MAX_PER_SELECTOR = 20;
/** Lite text is a recognition label, shorter than the 120-char role inventory preview. */
export const LITE_TEXT_CHARS = 60;

export interface LiteProbeRequest {
  ids: string[];
  selectors: string[];
  /** Every visible stamped element of the active variant. */
  all: boolean;
  maxPerSelector: number;
  maxTextChars: number;
  /** false resolves addresses and geometry only; no element styles are read. */
  measure: boolean;
}

type Sides = [string, string, string, string];

export interface LiteStylesRaw {
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  letterSpacing: string;
  textTransform: string;
  padding: Sides;
  margin: Sides;
  /** Corner order: top-left, top-right, bottom-right, bottom-left (the CSS shorthand order). */
  radius: Sides;
  borderWidth: Sides;
  borderStyle: Sides;
  borderColor: Sides;
  boxShadow: string;
  display: string;
  position: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  rowGap: string;
  columnGap: string;
  flexDirection: string;
  flexWrap: string;
  alignItems: string;
  justifyContent: string;
  backgroundImage: string;
  maskImage: string;
  transform: string;
  filter: string;
  opacity: string;
  mixBlendMode: string;
  clipPath: string;
}

export interface LitePseudoRaw {
  content: string;
  backgroundColor: string;
  backgroundImage: string;
  width: string;
  height: string;
}

export interface LiteRawElement {
  id: string | null;
  tag: string;
  text: string;
  /** Document CSS px: x, y, width, height. */
  rect: [number, number, number, number];
  visible: boolean;
  parent: string | null;
  /** Structural address, present only for unstamped matches. */
  path?: string;
  /** `<captureId>/<dl-N>` of the source element in a composed clone (data-dl-source-capture/-id). */
  src?: string;
  matched: string[];
  styles: LiteStylesRaw | null;
  before: LitePseudoRaw | null;
  after: LitePseudoRaw | null;
}

export interface LiteProbeResult {
  elements: LiteRawElement[];
  /** Selectors css-tree accepted but the browser engine rejected. */
  invalidSelectors: string[];
  /** Measurement qualifiers; any entry makes the page incomplete. */
  issues: string[];
  /** Selection notes (absent ids, truncation, unmatched selectors); completeness is unaffected. */
  notes: string[];
  rootFontSize: string;
  activeCaptureId?: string;
}

/**
 * Runs in the page. Light DOM plus open shadow roots are walked once without reading styles;
 * computed styles are read for resolved targets only.
 */
export function probeLite(request: LiteProbeRequest): LiteProbeResult {
  const issues: string[] = [];
  const notes: string[] = [];
  const invalidSelectors: string[] = [];
  const rootFontSize = getComputedStyle(document.documentElement).fontSize;
  for (const selector of request.selectors) {
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      invalidSelectors.push(selector);
    }
  }
  if (invalidSelectors.length > 0) return { elements: [], invalidSelectors, issues, notes, rootFontSize };

  const hosts = Array.from(document.querySelectorAll('[data-dl-generated="host"]')).filter((host) => host.shadowRoot !== null);
  const inactiveHosts = new Set(hosts.filter((host) => getComputedStyle(host).display === 'none'));
  const activeHosts = hosts.filter((host) => !inactiveHosts.has(host));
  if (activeHosts.length > 1) issues.push('multiple responsive variants are active');
  const activeCaptureId = activeHosts[0]?.getAttribute('data-dl-source-capture') ?? undefined;

  interface Located { element: Element; inactive: boolean }
  const byId = new Map<string, Located[]>();
  const roots: Array<{ root: Document | ShadowRoot; inactive: boolean }> = [{ root: document, inactive: false }];
  const activeStamped: Element[] = [];
  const stack: Located[] = [{ element: document.documentElement, inactive: false }];
  while (stack.length > 0) {
    const { element, inactive: inherited } = stack.pop()!;
    const inactive = inherited || inactiveHosts.has(element);
    const id = element.getAttribute('data-dl-id');
    if (id !== null) {
      const located = byId.get(id);
      if (located) located.push({ element, inactive });
      else byId.set(id, [{ element, inactive }]);
      if (request.all && !inactive) activeStamped.push(element);
    }
    for (let index = element.children.length - 1; index >= 0; index -= 1) stack.push({ element: element.children[index], inactive });
    const shadow = element.shadowRoot;
    if (shadow) {
      roots.push({ root: shadow, inactive });
      for (let index = shadow.children.length - 1; index >= 0; index -= 1) stack.push({ element: shadow.children[index], inactive });
    }
  }
  // Stable sort: tree order is kept within the active and the inactive group.
  roots.sort((left, right) => Number(left.inactive) - Number(right.inactive));

  interface Target { element: Element; inactive: boolean; matched: string[] }
  const targets: Target[] = [];
  const targetOf = new Map<Element, Target>();
  function add(element: Element, inactive: boolean, selector?: string): void {
    let target = targetOf.get(element);
    if (!target) {
      target = { element, inactive, matched: [] };
      targetOf.set(element, target);
      targets.push(target);
    }
    if (selector !== undefined && !target.matched.includes(selector)) target.matched.push(selector);
  }

  function hasBox(element: Element): boolean {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }

  for (const id of request.ids) {
    const located = byId.get(id) ?? [];
    if (located.length === 0) {
      notes.push(`no element found with data-dl-id "${id}" in the document or open shadow roots`);
      continue;
    }
    const chosen = located.find((entry) => !entry.inactive) ?? located[0];
    if (located.length > 1) notes.push(`multiple elements found with data-dl-id "${id}"; reported the first in the active variant`);
    add(chosen.element, chosen.inactive);
  }
  for (const selector of request.selectors) {
    let count = 0;
    let taken = 0;
    for (const { root, inactive } of roots) {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        count += 1;
        if (taken < request.maxPerSelector) {
          add(element, inactive, selector);
          taken += 1;
        }
      }
    }
    if (count === 0) notes.push(`--selector "${selector}" matched no element`);
    else if (count > taken) notes.push(`--selector "${selector}" matched ${count} elements; reported the first ${taken} (active variant first)`);
  }
  if (request.all) for (const element of activeStamped) if (hasBox(element)) add(element, false);

  function tagOf(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const original = element.getAttribute('data-dl-original-tag');
    if (tag === 'img' && original === 'canvas') return 'canvas';
    if (tag.includes('-') && original === 'p') return 'p';
    if (element.getAttribute('data-dl-generated') === 'root' && original === 'html') return 'html';
    if (element.getAttribute('data-dl-generated') === 'body' && original === 'body') return 'body';
    return tag;
  }
  function parentOf(element: Element): Element | null {
    if (element.parentElement) return element.parentElement;
    const container = element.parentNode;
    return container instanceof ShadowRoot ? container.host : null;
  }
  // Anchored at the nearest stamped ancestor; `::shadow` marks a crossing into a host's tree.
  function pathOf(element: Element): string {
    const parts: string[] = [];
    let current = element;
    let suffix = '';
    for (;;) {
      const anchor = current === element ? null : current.getAttribute('data-dl-id');
      if (anchor !== null) {
        parts.unshift(`[data-dl-id="${anchor}"]${suffix}`);
        break;
      }
      const container = current.parentNode;
      if (!(container instanceof Element) && !(container instanceof ShadowRoot)) {
        parts.unshift(`${current.localName}${suffix}`);
        break;
      }
      let ordinal = 0;
      for (const sibling of Array.from(container.children)) {
        if (sibling.localName === current.localName) ordinal += 1;
        if (sibling === current) break;
      }
      parts.unshift(`${current.localName}:nth-of-type(${ordinal})${suffix}`);
      if (container instanceof ShadowRoot) {
        current = container.host;
        suffix = '::shadow';
      } else {
        current = container;
        suffix = '';
      }
    }
    return parts.join(' > ');
  }
  function pseudoOf(element: Element, which: '::before' | '::after'): LitePseudoRaw | null {
    const style = getComputedStyle(element, which);
    if (style.content === 'none' || style.content === 'normal' || style.display === 'none') return null;
    return { content: style.content, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, width: style.width, height: style.height };
  }
  function stylesOf(element: Element): LiteStylesRaw {
    const style = getComputedStyle(element);
    return {
      color: style.color, backgroundColor: style.backgroundColor, fontFamily: style.fontFamily, fontSize: style.fontSize,
      lineHeight: style.lineHeight, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, textTransform: style.textTransform,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      borderWidth: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      borderStyle: [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle],
      borderColor: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
      boxShadow: style.boxShadow, display: style.display, position: style.position,
      gridTemplateColumns: style.gridTemplateColumns, gridTemplateRows: style.gridTemplateRows,
      rowGap: style.rowGap, columnGap: style.columnGap, flexDirection: style.flexDirection, flexWrap: style.flexWrap,
      alignItems: style.alignItems, justifyContent: style.justifyContent, backgroundImage: style.backgroundImage,
      maskImage: style.maskImage || style.getPropertyValue('-webkit-mask-image'),
      transform: style.transform, filter: style.filter, opacity: style.opacity, mixBlendMode: style.mixBlendMode, clipPath: style.clipPath,
    };
  }

  const pendingImages: string[] = [];
  const elements = targets.map(({ element, inactive, matched }): LiteRawElement => {
    const box = element.getBoundingClientRect();
    const id = element.getAttribute('data-dl-id');
    const innerText = (element as HTMLElement).innerText;
    const text = (typeof innerText === 'string' ? innerText : element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, request.maxTextChars);
    const visible = !inactive && box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    if (visible && element instanceof HTMLImageElement && element.currentSrc && (!element.complete || element.naturalWidth === 0)) {
      pendingImages.push(id ?? pathOf(element));
    }
    const parent = parentOf(element);
    const sourceCapture = element.getAttribute('data-dl-source-capture');
    const sourceId = element.getAttribute('data-dl-source-id');
    return {
      id, tag: tagOf(element), text,
      ...(sourceCapture && sourceId ? { src: `${sourceCapture}/${sourceId}` } : {}),
      rect: [box.x + window.scrollX, box.y + window.scrollY, box.width, box.height],
      visible,
      parent: parent?.getAttribute('data-dl-id') ?? null,
      ...(id === null ? { path: pathOf(element) } : {}),
      matched,
      styles: request.measure ? stylesOf(element) : null,
      before: request.measure ? pseudoOf(element, '::before') : null,
      after: request.measure ? pseudoOf(element, '::after') : null,
    };
  });
  if (pendingImages.length > 0) {
    const listed = pendingImages.slice(0, 10).join(', ');
    issues.push(`unready or failed images: ${listed}${pendingImages.length > 10 ? ` (+${pendingImages.length - 10} more)` : ''}`);
  }
  return { elements, invalidSelectors, issues, notes, rootFontSize, ...(activeCaptureId ? { activeCaptureId } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Pure projection
// ---------------------------------------------------------------------------------------------

export interface LiteBox { pad?: string; margin?: string; radius?: string; border?: string; shadow?: string }
export interface LiteLayout {
  display?: string; position?: string; cols?: string; rows?: string; gap?: string; flex?: string; align?: string; justify?: string;
}
export interface LiteFx {
  bgImage?: string; mask?: string; transform?: string; filter?: string; opacity?: string; blend?: string; clipPath?: string;
}
export interface LitePseudo { content: string; bg?: string; size?: string }

/** Key order is the documented schema order. Keys holding CSS-initial or empty values are omitted. */
export interface LiteElement {
  id: string | null;
  tag: string;
  role?: Role;
  text?: string;
  /** Document CSS px, one decimal: x, y, width, height. */
  r: [number, number, number, number];
  v: 0 | 1;
  /** `family|size/lineHeight|weight|letterSpacing|transform`. */
  font: string;
  color: string;
  bg?: string;
  box?: LiteBox;
  layout?: LiteLayout;
  fx?: LiteFx;
  before?: LitePseudo;
  after?: LitePseudo;
  parent: string | null;
  path?: string;
  /** Citable source address `<captureId>/<dl-N>` (composed clones), as DESIGN.md evidence uses it. */
  src?: string;
  matched?: string[];
}

export interface LitePage {
  /** Present on single-viewport output; multi-viewport entries carry it beside `page`. */
  viewport?: Viewport;
  rootFontSize: string;
  fonts: FontReadiness;
  activeCaptureId?: string;
  complete: boolean;
  warnings: string[];
  /** Milliseconds per phase of this viewport's measurement. */
  timings: Record<string, number>;
}

export interface LiteInspectDocument {
  colors: 'see tokens.json';
  page: LitePage;
  elements: LiteElement[];
}

export interface LiteViewportInspection {
  viewport: Viewport;
  page: LitePage;
  elements: LiteElement[];
}

export interface LiteViewportsInspectDocument {
  colors: 'see tokens.json';
  viewports: LiteViewportInspection[];
}

const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent']);

/** CSS four-side shorthand compaction (`a a a a` → `a`, `a b a b` → `a b`, `a b c b` → `a b c`). */
export function compactSides(sides: readonly [string, string, string, string]): string {
  const [top, right, bottom, left] = sides;
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

function zero(value: string): boolean {
  return value === '0px' || value === '0' || value === '';
}

function borderOf(styles: LiteStylesRaw): string | undefined {
  const sides = [0, 1, 2, 3].map((index) => {
    const style = styles.borderStyle[index];
    const width = styles.borderWidth[index];
    return style === 'none' || style === 'hidden' || zero(width) ? 'none' : `${width} ${style} ${styles.borderColor[index]}`;
  });
  if (sides.every((side) => side === 'none')) return undefined;
  return sides.every((side) => side === sides[0]) ? sides[0] : sides.join(' | ');
}

function stripOrigin(value: string, origin: string): string {
  return origin === '' ? value : value.split(origin).join('');
}

/** Assign only defined values so omitted keys never serialize as explicit `undefined` entries. */
function defined<T extends object>(entries: Array<[keyof T, string | undefined]>): T | undefined {
  const result: Partial<Record<keyof T, string>> = {};
  let any = false;
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    result[key] = value;
    any = true;
  }
  return any ? (result as T) : undefined;
}

function when(condition: boolean, value: string): string | undefined {
  return condition ? value : undefined;
}

function pseudoOf(raw: LitePseudoRaw | null, origin: string): LitePseudo | undefined {
  if (raw === null) return undefined;
  const bg = [
    TRANSPARENT.has(raw.backgroundColor) ? '' : raw.backgroundColor,
    raw.backgroundImage === 'none' ? '' : stripOrigin(raw.backgroundImage, origin),
  ].filter((part) => part !== '').join(' ');
  const size = raw.width === 'auto' && raw.height === 'auto' ? '' : `${raw.width} ${raw.height}`;
  // `content: url(…)` computes to an absolute URL on the ephemeral server, like background images.
  return { content: stripOrigin(raw.content, origin), ...(bg !== '' ? { bg } : {}), ...(size !== '' ? { size } : {}) };
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** Project one raw probe record into the compact lite element. `origin` is the ephemeral server. */
export function projectLiteElement(raw: LiteRawElement, origin: string, role?: Role): LiteElement {
  const styles = raw.styles;
  if (styles === null) throw new Error('lite projection requires measured styles');
  const display = styles.display;
  // Container-only properties are reported for flex and grid containers alone.
  const grid = display === 'grid' || display === 'inline-grid';
  const flex = display === 'flex' || display === 'inline-flex';
  const container = grid || flex;
  const gap = styles.rowGap === styles.columnGap ? styles.rowGap : `${styles.rowGap} ${styles.columnGap}`;
  const flow = `${styles.flexDirection} ${styles.flexWrap}`;

  const box = defined<LiteBox>([
    ['pad', when(!styles.padding.every(zero), compactSides(styles.padding))],
    ['margin', when(!styles.margin.every(zero), compactSides(styles.margin))],
    ['radius', when(!styles.radius.every(zero), compactSides(styles.radius))],
    ['border', borderOf(styles)],
    ['shadow', when(styles.boxShadow !== 'none' && styles.boxShadow !== '', styles.boxShadow)],
  ]);
  const layout = defined<LiteLayout>([
    ['display', when(display !== 'inline' && display !== '', display)],
    ['position', when(styles.position !== 'static' && styles.position !== '', styles.position)],
    ['cols', when(grid && styles.gridTemplateColumns !== 'none', styles.gridTemplateColumns)],
    ['rows', when(grid && styles.gridTemplateRows !== 'none', styles.gridTemplateRows)],
    ['gap', when(container && gap !== 'normal', gap)],
    ['flex', when(flex && flow !== 'row nowrap', flow)],
    ['align', when(container && styles.alignItems !== 'normal', styles.alignItems)],
    ['justify', when(container && styles.justifyContent !== 'normal', styles.justifyContent)],
  ]);
  const fx = defined<LiteFx>([
    ['bgImage', when(styles.backgroundImage !== 'none' && styles.backgroundImage !== '', stripOrigin(styles.backgroundImage, origin))],
    ['mask', when(styles.maskImage !== 'none' && styles.maskImage !== '', stripOrigin(styles.maskImage, origin))],
    ['transform', when(styles.transform !== 'none' && styles.transform !== '', styles.transform)],
    ['filter', when(styles.filter !== 'none' && styles.filter !== '', stripOrigin(styles.filter, origin))],
    ['opacity', when(styles.opacity !== '1' && styles.opacity !== '', styles.opacity)],
    ['blend', when(styles.mixBlendMode !== 'normal' && styles.mixBlendMode !== '', styles.mixBlendMode)],
    ['clipPath', when(styles.clipPath !== 'none' && styles.clipPath !== '', stripOrigin(styles.clipPath, origin))],
  ]);
  const before = pseudoOf(raw.before, origin);
  const after = pseudoOf(raw.after, origin);
  const [x, y, width, height] = raw.rect;

  return {
    id: raw.id,
    tag: raw.tag,
    ...(role !== undefined ? { role } : {}),
    ...(raw.text !== '' ? { text: raw.text } : {}),
    r: [round1(x), round1(y), round1(width), round1(height)],
    v: raw.visible ? 1 : 0,
    font: `${styles.fontFamily}|${styles.fontSize}/${styles.lineHeight}|${styles.fontWeight}|${styles.letterSpacing}|${styles.textTransform}`,
    color: styles.color,
    ...(TRANSPARENT.has(styles.backgroundColor) || styles.backgroundColor === '' ? {} : { bg: styles.backgroundColor }),
    ...(box ? { box } : {}),
    ...(layout ? { layout } : {}),
    ...(fx ? { fx } : {}),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    parent: raw.parent,
    ...(raw.path !== undefined ? { path: raw.path } : {}),
    ...(raw.src !== undefined ? { src: raw.src } : {}),
    ...(raw.matched.length > 0 ? { matched: raw.matched } : {}),
  };
}

/**
 * Reject a selector before any server or browser starts. css-tree is more permissive than the
 * engine: it drops a trailing comma and keeps a dangling combinator (`h1 >`, `> h1`) without an
 * error, so those are rejected here; unknown pseudo-classes still reach the in-browser check.
 */
export function validateSelectorSyntax(selector: string): void {
  if (selector.trim() === '') throw new Error('invalid --selector "": expected a CSS selector');
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(selector, {
      context: 'selectorList',
      onParseError: (error: { message: string }) => {
        throw new Error(error.message);
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid --selector "${selector}": ${detail}`);
  }
  // An escaped comma (`.a\,`) is part of a name, not a list separator.
  if (/(?:^|[^\\])(?:\\\\)*,\s*$/.test(selector)) throw new Error(`invalid --selector "${selector}": trailing comma`);
  const complex = ast.type === 'SelectorList' ? ast.children.toArray() : [ast];
  for (const node of complex) {
    if (node.type !== 'Selector') continue;
    if (node.children.first?.type === 'Combinator' || node.children.last?.type === 'Combinator') {
      throw new Error(`invalid --selector "${selector}": a selector cannot start or end with a combinator`);
    }
  }
}
