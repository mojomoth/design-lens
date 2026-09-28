/// <reference lib="dom" />

import type { Page } from 'playwright';
import type { FontReadiness } from '../capture/browser.js';
import type { Viewport } from '../lib/viewport.js';

export interface ObservationRect { x: number; y: number; width: number; height: number }
export interface PseudoObservation { content: string; styles: Record<string, string> }
export interface ElementObservation {
  dlId: string;
  /** Explicit correspondence emitted by responsive composition; IDs alone are capture-local. */
  source?: { captureId: string; dlId: string };
  /** Generated composition proxies remain inspectable but are not original source elements. */
  generated?: string;
  tag: string;
  text: string;
  semantic: string;
  /** Structural path, independent of capture-local IDs. Not proof of identity across captures. */
  domPath: string;
  /** IDs of open shadow hosts, outermost first. */
  rootPath: string[];
  parentDlId: string | null;
  childDlIds: string[];
  rect: ObservationRect;
  styles: Record<string, string>;
  visible: boolean;
  currentSrc: string | null;
  /** Attribute source is distinct from the browser-selected responsive image candidate. */
  src?: string | null;
  image?: { complete: boolean; naturalWidth: number; naturalHeight: number };
  pseudo: { before: PseudoObservation; after: PseudoObservation };
}

export interface ObservationDocument {
  viewport: Viewport;
  deviceScaleFactor: number;
  width: number;
  height: number;
  rootFontSize: string;
  /** Root canvas/scroll styles for responsive document proxies; absent in older evidence. */
  rootStyles?: Record<string, string>;
  activeCaptureId?: string;
  fonts: FontReadiness;
  fontFaces?: Array<{ family: string; status: string; style: string; weight: string; stretch: string }>;
  elements: ElementObservation[];
  /** Body is a measured document root, not a stamped editable inventory element. */
  body?: Omit<ElementObservation, 'dlId'>;
  complete: boolean;
  warnings: string[];
}

export interface ObservationOptions {
  maxElements?: number;
  deadline?: number;
  /** Explicit inspection may address stamped document roots and nonvisual nodes as well. */
  includeDocumentElements?: boolean;
  /** Explicit inventory can include hidden sampled alternatives; ordinary measurement skips them. */
  includeInactiveVariants?: boolean;
}

/** Runs inside Chromium; all runtime values deliberately live inside the callback. */
export function probeObservations(options: ObservationOptions = {}): ObservationDocument {
  const warnings: string[] = [];
  const maxElements = Number.isFinite(options.maxElements) ? Math.min(20_000, Math.max(1, options.maxElements!)) : 20_000;
  const deadline = Number.isFinite(options.deadline) ? options.deadline! : Date.now() + 10_000;
  const properties = [
    'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
    'backgroundRepeat', 'backgroundAttachment', 'backgroundOrigin', 'backgroundClip', 'colorScheme', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
    'fontFeatureSettings', 'fontVariationSettings', 'lineHeight', 'letterSpacing', 'wordSpacing',
    'textAlign', 'textTransform', 'textDecoration', 'whiteSpace', 'wordBreak', 'writingMode',
    'display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'width', 'height',
    'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'boxSizing',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'boxShadow', 'textShadow', 'opacity', 'visibility', 'transform', 'transformOrigin',
    'filter', 'backdropFilter', 'mixBlendMode', 'clipPath', 'objectFit', 'objectPosition',
    'overflowX', 'overflowY', 'scrollBehavior', 'scrollbarGutter', 'overscrollBehaviorX', 'overscrollBehaviorY', 'rowGap', 'columnGap', 'gridTemplateColumns', 'gridTemplateRows',
    'gridAutoFlow', 'gridColumn', 'gridRow', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink',
    'flexBasis', 'alignItems', 'alignSelf', 'justifyContent', 'order', 'aspectRatio',
  ];
  function stylesOf(style: CSSStyleDeclaration): Record<string, string> {
    const result: Record<string, string> = {};
    for (const property of properties) result[property] = String(Reflect.get(style, property) ?? '');
    return result;
  }
  function pseudoOf(element: Element, selector: string): PseudoObservation {
    const style = getComputedStyle(element, selector);
    return { content: style.content, styles: stylesOf(style) };
  }
  function semanticOf(element: Element, style: CSSStyleDeclaration): string {
    const role = element.getAttribute('role');
    if (role) return role;
    const tag = tagOf(element);
    const roles: Record<string, string> = {
      body: 'body', header: 'header', nav: 'navigation', main: 'main', footer: 'footer', aside: 'complementary',
      h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
      p: 'paragraph', img: 'image', picture: 'picture', svg: 'graphic', canvas: 'graphic', video: 'video',
      form: 'form', input: 'input', button: 'button', select: 'select', textarea: 'textbox',
      label: 'label', table: 'table', th: 'columnheader', td: 'cell', tr: 'row',
      ul: 'list', ol: 'list', li: 'listitem', article: 'article', section: 'section', a: 'link',
    };
    if (roles[tag]) return roles[tag];
    if (/(^|[\s_-])card([\s_-]|$)/i.test(element.getAttribute('class') ?? '')) return 'card';
    if (style.display.includes('grid')) return 'grid';
    if (style.display.includes('flex')) return 'flex';
    return 'container';
  }
  const elements: ElementObservation[] = [];
  function tagOf(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const original = element.getAttribute('data-dl-original-tag');
    if (tag === 'img' && original === 'canvas') return 'canvas';
    if (tag.includes('-') && original === 'p') return 'p';
    if (element.getAttribute('data-dl-generated') === 'root' && original === 'html') return 'html';
    if (element.getAttribute('data-dl-generated') === 'body' && original === 'body') return 'body';
    return tag;
  }
  const activeHosts = Array.from(document.querySelectorAll('[data-dl-generated="host"]'))
    .filter((host) => host.shadowRoot && getComputedStyle(host).display !== 'none');
  if (activeHosts.length > 1) warnings.push('multiple responsive variants are active');
  const activeCaptureId = activeHosts[0]?.getAttribute('data-dl-source-capture') ?? undefined;
  const activeBody = activeHosts[0]?.shadowRoot?.querySelector('[data-dl-generated="body"]') ?? document.body;
  const seenIds = new Set<string>();
  let unstamped = 0;
  let visited = 0;
  type Entry = { element: Element; rootPath: string[]; domPath: string; parent: Element | null };
  const stack: Entry[] = [];
  function pushChildren(parent: Element | ShadowRoot, rootPath: string[], prefix: string, host: Element | null): void {
    const ordinals = new Map<string, number>();
    const children: Entry[] = [];
    for (const element of Array.from(parent.children)) {
      const tag = tagOf(element);
      const ordinal = (ordinals.get(tag) ?? 0) + 1;
      ordinals.set(tag, ordinal);
      children.push({ element, rootPath, domPath: tag === 'body' ? 'body' : `${prefix}>${tag}:nth-of-type(${ordinal})`, parent: host });
    }
    stack.push(...children.reverse());
  }
  if (options.includeDocumentElements) stack.push({ element: document.documentElement, rootPath: [], domPath: 'html', parent: null });
  else if (document.body) pushChildren(document.body, [], 'body', document.body);
  else warnings.push('document has no body');
  while (stack.length > 0) {
    if (visited >= maxElements) { warnings.push(`observation element limit reached (${maxElements})`); break; }
    if (Date.now() >= deadline) { warnings.push('observation deadline reached'); break; }
    const { element, rootPath, domPath, parent } = stack.pop()!;
    if (!options.includeInactiveVariants && element.getAttribute('data-dl-generated') === 'host'
        && element.shadowRoot && getComputedStyle(element).display === 'none') continue;
    visited += 1;
    const tag = tagOf(element);
    const dlId = element.getAttribute('data-dl-id');
    pushChildren(element, rootPath, domPath, element);
    if (element.shadowRoot) {
      pushChildren(element.shadowRoot, [...rootPath, dlId ?? domPath], `${domPath}::shadow`, element);
    }
    if (['script', 'style', 'link', 'template'].includes(tag) && (!options.includeDocumentElements || !dlId)) continue;
    if (!dlId) {
      if (!['html', 'head', 'body', 'meta', 'title', 'base'].includes(tag)) unstamped += 1;
      continue;
    }
    if (seenIds.has(dlId)) warnings.push(`duplicate observation ID: ${dlId}`);
    seenIds.add(dlId);
    elements.push({ dlId, ...measure(element, rootPath, domPath, parent) });
  }
  function measure(element: Element, rootPath: string[], domPath: string, parent: Element | null): Omit<ElementObservation, 'dlId'> {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const rect = { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height };
    const children = [...Array.from(element.children), ...Array.from(element.shadowRoot?.children ?? [])];
    const image = element instanceof HTMLImageElement ? element : undefined;
    return {
      tag: tagOf(element),
      ...(element.hasAttribute('data-dl-source-capture') && element.hasAttribute('data-dl-source-id')
        ? { source: { captureId: element.getAttribute('data-dl-source-capture')!, dlId: element.getAttribute('data-dl-source-id')! } } : {}),
      ...(element.hasAttribute('data-dl-generated') ? { generated: element.getAttribute('data-dl-generated')! } : {}),
      text: ((element as HTMLElement).innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
      semantic: semanticOf(element, style), domPath, rootPath,
      parentDlId: parent?.getAttribute('data-dl-id') ?? null,
      childDlIds: children.map((child) => child.getAttribute('data-dl-id')).filter((id): id is string => id !== null),
      rect, styles: stylesOf(style),
      visible: box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      currentSrc: image ? image.currentSrc || null : null,
      src: image ? image.getAttribute('src') : /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(style.backgroundImage)?.slice(1).find((value) => value !== undefined) ?? null,
      ...(image ? { image: { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } } : {}),
      pseudo: { before: pseudoOf(element, '::before'), after: pseudoOf(element, '::after') },
    };
  }
  if (unstamped > 0) warnings.push(`${unstamped} elements without data-dl-id were not measurable by ID`);
  const failed = new Set<string>();
  const fontFaces: NonNullable<ObservationDocument['fontFaces']> = [];
  document.fonts?.forEach((face) => {
    if (face.status === 'error') failed.add(face.family);
    fontFaces.push({ family: face.family, status: face.status, style: face.style, weight: face.weight, stretch: face.stretch });
  });
  fontFaces.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const fonts: FontReadiness = {
    status: document.fonts ? (document.fonts.status === 'loaded' ? 'ready' : 'timeout') : 'unavailable',
    failedFamilies: [...failed].sort(),
  };
  if (fonts.status !== 'ready') warnings.push(`font readiness ${fonts.status}`);
  if (failed.size > 0) warnings.push(`failed font families: ${[...failed].sort().join(', ')}`);
  const brokenImages = elements.filter((element) => (!activeCaptureId || !element.source || element.source.captureId === activeCaptureId)
    && element.image && element.currentSrc && (!element.image.complete || element.image.naturalWidth === 0));
  if (brokenImages.length > 0) warnings.push(`unready or failed images: ${brokenImages.map((element) => element.dlId).join(', ')}`);
  const width = Math.max(window.innerWidth, document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
  const height = Math.max(window.innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
  if (width * height * window.devicePixelRatio ** 2 > 40_000_000) warnings.push('full screenshot exceeds 40000000 pixel limit');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight }, deviceScaleFactor: window.devicePixelRatio,
    width, height, rootFontSize: getComputedStyle(document.documentElement).fontSize,
    // Only canvas/viewport bridge properties belong here. Element/body typography is measured
    // above; Chromium may resolve an unused root default-font alias during screenshot painting.
    rootStyles: Object.fromEntries([
      'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
      'backgroundAttachment', 'backgroundOrigin', 'backgroundClip', 'colorScheme', 'overflowX', 'overflowY',
      'scrollBehavior', 'scrollbarGutter', 'overscrollBehaviorX', 'overscrollBehaviorY',
    ].map((property) => [property, String(Reflect.get(getComputedStyle(document.documentElement), property) ?? '')])),
    ...(activeCaptureId ? { activeCaptureId } : {}),
    fonts, fontFaces, elements, ...(activeBody ? { body: measure(activeBody, [], 'body', activeBody.parentElement) } : {}), complete: warnings.length === 0, warnings,
  };
}

export async function observePage(page: Page, options: ObservationOptions = {}): Promise<ObservationDocument> {
  return page.evaluate(probeObservations, options);
}
