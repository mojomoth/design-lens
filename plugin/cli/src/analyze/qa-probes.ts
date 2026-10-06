/// <reference lib="dom" />
/**
 * In-page halves of `qa`. Every exported function is passed to `page.evaluate`, so it must not
 * reference module scope: the minified bundle renames module bindings. Shared traversal lives in
 * {@link installQaHelpers}, which stores its helpers on `window` once per document; the other probes
 * read them from there and contain everything else inline. Decisions (severity, sourcing, grouping)
 * are made in Node by `qa-checks.ts`, so these functions only measure.
 *
 * Every probe walks the light DOM plus every open shadow root and skips hidden responsive host
 * variants (`[data-dl-generated="host"]` with `display:none`), matching `analyze/inspect.ts`.
 */

export interface PageRect { x: number; y: number; width: number; height: number }

export interface QaPageHelpers {
  /** Deep pre-order walk under `<body>`; hidden host variants are skipped unless `includeHidden`. */
  elements(includeHidden: boolean): Element[];
  /** `document` plus every open shadow root reached by {@link QaPageHelpers.elements}. */
  roots(includeHidden: boolean): Array<Document | ShadowRoot>;
  visible(element: Element): boolean;
  path(element: Element): string;
  /** Composed containment: walks `parentNode`, crossing shadow roots through their host. */
  contains(container: Node, node: Node): boolean;
  /** Flat-tree parent element (slot, light parent, or shadow host). */
  parent(element: Element): Element | null;
  /** Deep hit test that descends through `shadowRoot.elementFromPoint`. */
  hit(x: number, y: number): Element | null;
  /** Document CSS px, one decimal. */
  rect(element: Element): PageRect;
  label(element: Element): string;
}

export interface QaWindow {
  __designLensQa?: QaPageHelpers;
  __designLensQaMutations?: { count: number; observers: MutationObserver[]; stop?: () => void };
}

/** Idempotent per document; re-run after every navigation. */
export function installQaHelpers(): void {
  const target = window as unknown as QaWindow;
  if (target.__designLensQa) return;
  const hiddenHost = (element: Element): boolean => element.getAttribute('data-dl-generated') === 'host'
    && element.shadowRoot !== null && getComputedStyle(element).display === 'none';
  const elements = (includeHidden: boolean): Element[] => {
    const result: Element[] = [];
    const start = document.body ?? document.documentElement;
    const stack: Element[] = Array.from(start.children).reverse();
    while (stack.length > 0) {
      const element = stack.pop()!;
      if (!includeHidden && hiddenHost(element)) continue;
      result.push(element);
      const children = Array.from(element.children);
      if (element.shadowRoot) children.push(...Array.from(element.shadowRoot.children));
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
    return result;
  };
  const roots = (includeHidden: boolean): Array<Document | ShadowRoot> => {
    const result: Array<Document | ShadowRoot> = [document];
    for (const element of elements(includeHidden)) if (element.shadowRoot) result.push(element.shadowRoot);
    return result;
  };
  const visible = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const check = (element as Element & { checkVisibility?: (options: Record<string, boolean>) => boolean }).checkVisibility;
    if (typeof check === 'function') {
      return check.call(element, { opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  const parent = (element: Element): Element | null => {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const node = element.parentNode;
    return node instanceof ShadowRoot ? node.host : null;
  };
  const contains = (container: Node, node: Node): boolean => {
    let current: Node | null = node;
    while (current) {
      if (current === container) return true;
      current = current instanceof ShadowRoot ? current.host : current.parentNode;
    }
    return false;
  };
  const hit = (x: number, y: number): Element | null => {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    return element;
  };
  const segment = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    if (element.id && /^[A-Za-z][\w-]*$/.test(element.id)) return `${tag}#${element.id}`;
    const classes = Array.from(element.classList).filter((name) => /^-?[A-Za-z_][\w-]*$/.test(name)).slice(0, 2);
    let text = tag + classes.map((name) => `.${name}`).join('');
    const container = element.parentNode as ParentNode | null;
    if (container && 'children' in container) {
      const same = Array.from(container.children).filter((sibling) => sibling.tagName === element.tagName);
      if (same.length > 1) text += `:nth-of-type(${same.indexOf(element) + 1})`;
    }
    return text;
  };
  const path = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; current && depth < 4; depth += 1) {
      parts.unshift(segment(current));
      if (current.id && /^[A-Za-z][\w-]*$/.test(current.id)) break;
      if (current.tagName === 'BODY') break;
      current = current.parentElement;
    }
    const root = element.getRootNode();
    const local = parts.join(' > ');
    return root instanceof ShadowRoot ? `${path(root.host)} >>> ${local}` : local;
  };
  const round = (value: number): number => Math.round(value * 10) / 10;
  const rect = (element: Element): PageRect => {
    const box = element.getBoundingClientRect();
    return { x: round(box.x + window.scrollX), y: round(box.y + window.scrollY), width: round(box.width), height: round(box.height) };
  };
  const label = (element: Element): string => {
    const text = ((element as HTMLElement).innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 80);
    const named = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.querySelector('img[alt]')?.getAttribute('alt') ?? '';
    return named.replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  Object.defineProperty(window, '__designLensQa', {
    value: { elements, roots, visible, path, contains, parent, hit, rect, label },
    configurable: true,
  });
}

export interface LinkFact {
  /** Deep index into `elements(false)`, for re-resolving the link. */
  index: number;
  selector: string;
  label: string;
  /** The raw attribute, or null when the anchor has no href. */
  href: string | null;
  resolved: string | null;
  inPage: boolean;
  targetId: string | null;
  targetExists: boolean;
  /** The target exists only in the link's own shadow root, where fragment navigation cannot reach it. */
  targetInShadow: boolean;
  selfAnchor: boolean;
  visible: boolean;
  rect: PageRect | null;
}
export interface ClippedFact { selector: string; text: string; rect: PageRect; overflow: number; width: number; fontSize: number }
export interface ImageFact { selector: string; rect: PageRect; complete: boolean; naturalWidth: number; src: string }
export interface IconFact { index: number; selector: string; rect: PageRect }
export interface FontUse { family: string; generic: boolean; elements: number; samples: string[] }
export interface HeadingFont {
  /** Deep index into `elements(false)`. */
  index: number;
  selector: string;
  tag: string;
  family: string;
  generic: boolean;
  /** The resolved family is a loaded web font (FontFace), so its glyph coverage can be measured. */
  loaded: boolean;
}
export interface TextAnchor { start: number; end: number; selector: string; rect: PageRect }
export interface SignatureObservation { count: number; value: string | null; error?: string }
export interface AttributeFact { name: string; value: string; selector: string }
export interface DirectTextFact { text: string; selector: string; rect: PageRect }
export interface PageFacts {
  url: string;
  title: string;
  document: { width: number; height: number; scrollWidth: number; innerWidth: number; innerHeight: number };
  links: LinkFact[];
  clipped: ClippedFact[];
  images: ImageFact[];
  icons: IconFact[];
  fonts: FontUse[];
  headings: HeadingFont[];
  stream: string;
  anchors: TextAnchor[];
  signatures: SignatureObservation[];
  attributes: AttributeFact[];
  directTexts: DirectTextFact[];
  dlIds: string[];
  /** `style[data-dl-captured-styles]` blocks (the clone's inlined reference CSS) in every root. */
  capturedStyles: number;
}

/** One pass over the settled page at scroll 0: every DOM fact the static checks need. */
export function probeQaPage(options: { checks: Array<{ selector: string; property: string }> }): PageFacts {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const all = qa.elements(false);
  const indexOf = new Map<Element, number>();
  all.forEach((element, index) => indexOf.set(element, index));
  const visibleCache = new Map<Element, boolean>();
  const shown = (element: Element): boolean => {
    let value = visibleCache.get(element);
    if (value === undefined) { value = qa.visible(element); visibleCache.set(element, value); }
    return value;
  };
  const vw = window.innerWidth;

  const links: LinkFact[] = [];
  const pageUrl = location.href.replace(/#.*$/, '');
  for (const element of all) {
    if (!(element instanceof HTMLAnchorElement)) continue;
    const raw = element.getAttribute('href');
    const isShown = shown(element);
    let resolved: string | null = null;
    let inPage = false;
    let targetId: string | null = null;
    let targetExists = false;
    let targetInShadow = false;
    let selfAnchor = false;
    if (raw !== null) {
      resolved = element.href || null;
      const trimmed = raw.trim();
      if (resolved && trimmed !== '' && !/^javascript:/i.test(trimmed)) {
        const hashAt = resolved.indexOf('#');
        if (hashAt >= 0 && resolved.slice(0, hashAt) === pageUrl) {
          inPage = true;
          const encoded = resolved.slice(hashAt + 1);
          // Browsers keep a malformed escape verbatim when matching the fragment.
          let id = encoded;
          try { id = decodeURIComponent(encoded); } catch (error) { if (!(error instanceof URIError)) throw error; }
          targetId = id;
          if (id !== '') {
            const target = document.getElementById(id) ?? document.querySelector(`a[name="${CSS.escape(id)}"]`);
            const root = element.getRootNode();
            const shadowTarget = target === null && root instanceof ShadowRoot ? root.getElementById(id) : null;
            targetExists = target !== null;
            targetInShadow = shadowTarget !== null;
            const found = target ?? shadowTarget;
            selfAnchor = found !== null && qa.contains(found, element);
          }
        }
      }
    }
    links.push({
      index: indexOf.get(element)!, selector: qa.path(element), label: qa.label(element), href: raw, resolved, inPage, targetId, targetExists, targetInShadow, selfAnchor,
      visible: isShown, rect: isShown ? qa.rect(element) : null,
    });
  }

  const clipped: ClippedFact[] = [];
  const flagged = new Set<Element>();
  const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED', 'INPUT', 'TEXTAREA', 'SELECT']);
  const alphaOf = (color: string): number => {
    const match = /rgba?\(([^)]*)\)/.exec(color);
    if (!match) return color === 'transparent' ? 0 : 1;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? Number(parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : parts[3]) : 1;
  };
  for (const element of all) {
    const box = element.getBoundingClientRect();
    if (!(box.right > vw + 1 || box.left < -1)) continue;
    if (!(box.right > 1 && box.left < vw - 1)) continue;
    if (!shown(element)) continue;
    let clips = false;
    let excluded = false;
    let ancestorFlagged = false;
    let clipLeft = -Infinity;
    let clipRight = Infinity;
    for (let node: Element | null = element; node; node = qa.parent(node)) {
      if (node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') { excluded = true; break; }
      if (node === element) continue;
      if (flagged.has(node)) { ancestorFlagged = true; break; }
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') { excluded = true; break; }
      if (overflowX === 'hidden' || overflowX === 'clip') {
        clips = true;
        if (node !== document.documentElement && node !== document.body) {
          const frame = node.getBoundingClientRect();
          clipLeft = Math.max(clipLeft, frame.left);
          clipRight = Math.min(clipRight, frame.right);
        }
      }
    }
    if (excluded || ancestorFlagged || !clips) continue;
    // Only content cut at the viewport edge counts; a box that clips it inside the page is a bleed by design.
    if (box.right > vw + 1 && clipRight < vw - 1) continue;
    if (box.left < -1 && box.right <= vw + 1 && clipLeft > 1) continue;
    const style = getComputedStyle(element);
    const text = ((element as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
    const borderPaints = ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
      const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
      return width > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none'
        && alphaOf(style.getPropertyValue(`border-${side.toLowerCase()}-color`)) > 0;
    });
    const paints = text !== '' || REPLACED.has(element.tagName.toUpperCase()) || alphaOf(style.backgroundColor) > 0
      || (style.backgroundImage !== 'none' && style.backgroundImage !== '') || borderPaints || (style.boxShadow !== 'none' && style.boxShadow !== '');
    if (!paints) continue;
    flagged.add(element);
    clipped.push({
      selector: qa.path(element), text: text.slice(0, 60), rect: qa.rect(element),
      overflow: Math.round(Math.max(box.right - vw, -box.left) * 10) / 10, width: Math.round(box.width * 10) / 10,
      fontSize: parseFloat(style.fontSize) || 0,
    });
  }

  const images: ImageFact[] = [];
  const icons: IconFact[] = [];
  for (const element of all) {
    if (!(element instanceof HTMLImageElement) || !shown(element)) continue;
    const box = element.getBoundingClientRect();
    images.push({ selector: qa.path(element), rect: qa.rect(element), complete: element.complete, naturalWidth: element.naturalWidth, src: (element.currentSrc || element.getAttribute('src') || '').slice(0, 200) });
    if (element.complete && element.naturalWidth > 0 && box.width >= 8 && box.width <= 160 && box.height >= 8 && box.height <= 160) {
      icons.push({ index: indexOf.get(element)!, selector: qa.path(element), rect: qa.rect(element) });
    }
  }

  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
  const normalize = (family: string): string => family.trim().replace(/^(["'])(.*)\1$/, '$2').trim().replace(/\s+/g, ' ').toLowerCase();
  const loaded = new Set<string>();
  document.fonts?.forEach((face) => { if (face.status === 'loaded') loaded.add(normalize(face.family)); });
  const TEXT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'A', 'BUTTON', 'LABEL', 'TD', 'TH', 'FIGCAPTION', 'BLOCKQUOTE']);
  const fontUses = new Map<string, FontUse>();
  const headings: HeadingFont[] = [];
  const directTexts: DirectTextFact[] = [];
  for (const element of all) {
    const tag = element.tagName.toUpperCase();
    const direct = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.nodeValue ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (!TEXT_TAGS.has(tag) && direct === '') continue;
    if (!shown(element)) continue;
    if (direct.length >= 24) directTexts.push({ text: direct.slice(0, 500), selector: qa.path(element), rect: qa.rect(element) });
    const stack = getComputedStyle(element).fontFamily.split(',').map((family) => family.trim().replace(/^(["'])(.*)\1$/, '$2').trim()).filter(Boolean);
    if (stack.length === 0) continue;
    const resolved = stack.find((family) => loaded.has(normalize(family)) || GENERIC.has(normalize(family))) ?? stack[0];
    const generic = GENERIC.has(normalize(resolved));
    const key = normalize(resolved);
    const use = fontUses.get(key) ?? { family: resolved, generic, elements: 0, samples: [] };
    use.elements += 1;
    if (use.samples.length < 3) use.samples.push(qa.path(element));
    fontUses.set(key, use);
    if (tag === 'H1' || tag === 'H2') headings.push({ index: indexOf.get(element)!, selector: qa.path(element), tag: tag.toLowerCase(), family: resolved, generic, loaded: loaded.has(key) });
  }

  let stream = '';
  const anchors: TextAnchor[] = [];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK']);
  const visit = (node: Node, hidden: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (hidden) return;
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ');
      if (text.trim() === '') { stream += ' '; return; }
      const start = stream.length;
      stream += text;
      if (/\d/.test(text)) {
        const owner = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentElement;
        if (owner) anchors.push({ start, end: stream.length, selector: qa.path(owner), rect: qa.rect(owner) });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (SKIP.has(element.tagName.toUpperCase())) return;
    if (element.getAttribute('data-dl-generated') === 'host' && element.shadowRoot && getComputedStyle(element).display === 'none') return;
    const style = getComputedStyle(element);
    if (style.display === 'none') return;
    if (element.tagName.toUpperCase() === 'BR') { stream += ' '; return; }
    const block = style.display !== 'inline' && style.display !== 'contents';
    const childHidden = style.visibility === 'hidden' || style.visibility === 'collapse';
    stream += block ? '\n' : ' ';
    let children: Node[];
    if (element.shadowRoot) children = Array.from(element.shadowRoot.childNodes);
    else if (element instanceof HTMLSlotElement) {
      const assigned = element.assignedNodes();
      children = assigned.length > 0 ? assigned : Array.from(element.childNodes);
    } else children = Array.from(element.childNodes);
    for (const child of children) visit(child, childHidden);
    stream += block ? '\n' : ' ';
  };
  if (document.body) visit(document.body, false);

  const signatures: SignatureObservation[] = options.checks.map((check) => {
    const matches: Element[] = [];
    const seen = new Set<Element>();
    for (const root of qa.roots(false)) {
      let found: NodeListOf<Element>;
      try { found = root.querySelectorAll(check.selector); } catch (error) {
        return { count: 0, value: null, error: error instanceof Error ? error.message : String(error) };
      }
      for (const element of Array.from(found)) {
        if (seen.has(element)) continue;
        seen.add(element);
        if (shown(element)) matches.push(element);
      }
    }
    const value = check.property === 'count' || matches.length === 0 ? null : getComputedStyle(matches[0]).getPropertyValue(check.property).trim();
    return { count: matches.length, value };
  });

  const attributes: AttributeFact[] = [];
  for (const element of all) {
    for (const name of ['alt', 'title', 'aria-label', 'href', 'src']) {
      const value = element.getAttribute(name);
      if (value && attributes.length < 20_000) attributes.push({ name, value: value.slice(0, 500), selector: qa.path(element) });
    }
  }

  const dlIds = new Set<string>();
  for (const element of qa.elements(true)) {
    const id = element.getAttribute('data-dl-id');
    if (id) dlIds.add(id);
  }

  let capturedStyles = 0;
  for (const root of qa.roots(true)) capturedStyles += root.querySelectorAll('style[data-dl-captured-styles]').length;

  const scrolling = document.scrollingElement ?? document.documentElement;
  return {
    url: location.href,
    title: document.title,
    document: {
      width: Math.max(scrolling.scrollWidth, document.documentElement.scrollWidth), height: Math.max(scrolling.scrollHeight, document.documentElement.scrollHeight),
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    },
    links, clipped, images, icons, fonts: [...fontUses.values()], headings, stream, anchors, signatures, attributes, directTexts,
    dlIds: [...dlIds], capturedStyles,
  };
}

/**
 * Clicks nothing itself: reports, for the link at `index` (whose fragment target lives in its own
 * shadow root), the scroll offset and the target's viewport top. qa compares this before and after a
 * real click to learn whether a script makes the link work.
 */
export function shadowLinkState(input: { index: number; id: string }): { scrollY: number; targetTop: number | null } {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const link = qa.elements(false)[input.index];
  const root = link?.getRootNode();
  const target = root instanceof ShadowRoot ? root.getElementById(input.id) : null;
  return { scrollY: window.scrollY, targetTop: target ? Math.round(target.getBoundingClientRect().top) : null };
}

export interface ControlCandidate {
  index: number;
  /** Tab-like group id; null for a standalone control. */
  group: number | null;
  container: number | null;
  selector: string;
  text: string;
  rect: PageRect;
  focusable: boolean;
  /** `aria-controls`, `popovertarget` or `commandfor` id when that element exists in the candidate's root. */
  controls: string | null;
}

/** Tab-like groups first (≤ `perGroup` members each), then other buttons and pointer elements. */
export function collectControlCandidates(perGroup: number): ControlCandidate[] {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const all = qa.elements(false);
  const indexOf = new Map<Element, number>();
  all.forEach((element, index) => indexOf.set(element, index));
  const ACTIVE = /^(is-)?(active|selected|current|on)$/i;
  const isActive = (element: Element): boolean => Array.from(element.classList).some((name) => ACTIVE.test(name))
    || element.getAttribute('aria-selected') === 'true'
    || (element.hasAttribute('aria-current') && element.getAttribute('aria-current') !== 'false')
    || element.getAttribute('aria-pressed') === 'true';
  const inside = (element: Element, test: (node: Element) => boolean): boolean => {
    for (let node = qa.parent(element); node; node = qa.parent(node)) if (test(node)) return true;
    return false;
  };
  const excluded = (element: Element): boolean => {
    if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) return true;
    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return true;
    if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === 'submit' && element.form) return true;
    return inside(element, (node) => (node instanceof HTMLAnchorElement && node.hasAttribute('href')) || node.tagName === 'LABEL');
  };
  const shortText = (element: Element): boolean => {
    const text = (element.textContent ?? '').trim();
    return text.length > 0 && text.length <= 24;
  };
  const childrenOf = (element: Element): Element[] => {
    const children = Array.from(element.children);
    if (element.shadowRoot) children.push(...Array.from(element.shadowRoot.children));
    return children;
  };
  const groups = new Map<Element, Set<Element>>();
  const add = (container: Element, member: Element): void => {
    const set = groups.get(container) ?? new Set<Element>();
    set.add(member);
    groups.set(container, set);
  };
  for (const element of all) {
    const parent = qa.parent(element);
    if (!parent) continue;
    if (element.matches('[role=tab], [aria-selected]') || parent.getAttribute('role') === 'tablist') add(parent, element);
  }
  for (const container of [document.body, ...all]) {
    if (!container) continue;
    const kids = childrenOf(container).filter((kid) => shortText(kid) && qa.visible(kid));
    if (kids.length < 2) continue;
    const byKey = new Map<string, Element[]>();
    for (const kid of kids) {
      const key = `${kid.tagName}|${Array.from(kid.classList).filter((name) => !ACTIVE.test(name)).sort().join('.')}`;
      byKey.set(key, [...(byKey.get(key) ?? []), kid]);
    }
    for (const members of byKey.values()) {
      if (members.length >= 2 && members.filter(isActive).length === 1) for (const member of members) add(container, member);
    }
  }
  const focusable = (element: Element): boolean => (element as HTMLElement).tabIndex >= 0 && !element.matches(':disabled');
  const controlsOf = (element: Element): string | null => {
    const root = element.getRootNode() as Document | ShadowRoot;
    for (const name of ['aria-controls', 'popovertarget', 'commandfor']) {
      const id = element.getAttribute(name)?.trim().split(/\s+/)[0];
      if (id && root.getElementById(id)) return id;
    }
    return null;
  };
  const result: ControlCandidate[] = [];
  const taken = new Set<Element>();
  for (const members of groups.values()) for (const member of members) if (isActive(member)) taken.add(member);
  let groupId = 0;
  for (const [container, members] of groups) {
    const usable = [...members].filter((member) => !isActive(member) && !excluded(member) && qa.visible(member))
      .sort((left, right) => indexOf.get(left)! - indexOf.get(right)!).slice(0, perGroup);
    if (usable.length === 0) continue;
    for (const member of usable) {
      taken.add(member);
      result.push({
        index: indexOf.get(member)!, group: groupId, container: indexOf.get(container) ?? null, selector: qa.path(member),
        text: qa.label(member).slice(0, 40), rect: qa.rect(member), focusable: focusable(member), controls: controlsOf(member),
      });
    }
    groupId += 1;
  }
  const NEVER = new Set(['A', 'LABEL', 'SUMMARY', 'SELECT', 'OPTION', 'TEXTAREA', 'DETAILS', 'HTML', 'BODY', 'IFRAME', 'VIDEO', 'AUDIO']);
  const area = window.innerWidth * window.innerHeight;
  for (const element of all) {
    if (taken.has(element)) continue;
    const tag = element.tagName.toUpperCase();
    if (NEVER.has(tag)) continue;
    const isInput = element instanceof HTMLInputElement;
    if (isInput && !/^(button|submit|reset|image)$/i.test(element.type)) continue;
    const button = tag === 'BUTTON' || element.getAttribute('role') === 'button' || isInput;
    let pointer = false;
    if (!button) {
      if (getComputedStyle(element).cursor !== 'pointer') continue;
      const parent = qa.parent(element);
      pointer = !parent || getComputedStyle(parent).cursor !== 'pointer';
      if (!pointer) continue;
    }
    if (excluded(element) || !qa.visible(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width * box.height > area) continue;
    result.push({
      index: indexOf.get(element)!, group: null, container: null, selector: qa.path(element),
      text: qa.label(element).slice(0, 40), rect: qa.rect(element), focusable: focusable(element), controls: controlsOf(element),
    });
  }
  return result;
}

/** Viewport-relative clip of a candidate ∪ its group container ∪ its controlled (aria-controls, popover, command) target. */
export function candidateClip(input: { index: number; container: number | null; controls: string | null }): { x: number; y: number; width: number; height: number; scrollY: number } | null {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const all = qa.elements(false);
  const element = all[input.index];
  if (!element) return null;
  const boxes = [element.getBoundingClientRect()];
  if (input.container !== null && all[input.container]) boxes.push(all[input.container].getBoundingClientRect());
  if (input.controls) {
    const target = (element.getRootNode() as Document | ShadowRoot).getElementById(input.controls);
    // A closed popover or collapsed panel has an empty box at 0,0; it must not stretch the clip.
    const box = target?.getBoundingClientRect();
    if (box && box.width > 0 && box.height > 0) boxes.push(box);
  }
  const left = Math.max(0, Math.min(...boxes.map((box) => box.left)));
  const top = Math.max(0, Math.min(...boxes.map((box) => box.top)));
  const right = Math.min(window.innerWidth, Math.max(...boxes.map((box) => box.right)));
  const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((box) => box.bottom)));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - Math.floor(left)), height: Math.ceil(bottom - Math.floor(top)), scrollY: window.scrollY };
}

/**
 * Counts mutation records plus scroll and toggle events (a carousel button that only scrolls its
 * track, a popover or details toggle mutates no DOM) on `document` and every open shadow root until
 * {@link stopMutationCount}.
 */
export function startMutationCount(): void {
  const target = window as unknown as QaWindow;
  target.__designLensQaMutations?.observers.forEach((observer) => observer.disconnect());
  target.__designLensQaMutations?.stop?.();
  const state: { count: number; observers: MutationObserver[]; stop?: () => void } = { count: 0, observers: [] };
  const roots: Node[] = [document];
  const stack: Element[] = document.documentElement ? [document.documentElement] : [];
  while (stack.length > 0) {
    const element = stack.pop()!;
    if (element.shadowRoot) { roots.push(element.shadowRoot); stack.push(...Array.from(element.shadowRoot.children)); }
    stack.push(...Array.from(element.children));
  }
  const onEvent = (): void => { state.count += 1; };
  const listened: Array<{ root: Node; type: string }> = [];
  for (const root of roots) {
    const observer = new MutationObserver((records) => { state.count += records.length; });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    state.observers.push(observer);
    // Scroll and toggle events do not bubble; capture-phase listeners on each root still see them.
    for (const type of ['scroll', 'toggle', 'beforetoggle']) {
      root.addEventListener(type, onEvent, { capture: true });
      listened.push({ root, type });
    }
  }
  state.stop = () => { for (const { root, type } of listened) root.removeEventListener(type, onEvent, { capture: true }); };
  Object.defineProperty(window, '__designLensQaMutations', { value: state, configurable: true, writable: true });
}

export function stopMutationCount(): number {
  const state = (window as unknown as QaWindow).__designLensQaMutations;
  if (!state) return 0;
  for (const observer of state.observers) state.count += observer.takeRecords().length;
  state.observers.forEach((observer) => observer.disconnect());
  state.observers = [];
  state.stop?.();
  state.stop = undefined;
  return state.count;
}

export interface OverlapPlan { positions: Array<{ y: number; controls: number[] }>; controls: number; capped: boolean }

/** Assigns every visible control (≤ 400) to the scroll position where it is evaluated. */
export function planFixedOverlap(): OverlapPlan {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const all = qa.elements(false);
  const controls: number[] = [];
  all.forEach((element, index) => {
    if (controls.length >= 400) return;
    if (!element.matches('a[href], button, input, select, textarea, summary, [role=button], [tabindex]')) return;
    if (element instanceof HTMLInputElement && element.type === 'hidden') return;
    if (qa.visible(element)) controls.push(index);
  });
  const vh = window.innerHeight;
  const step = vh / 2;
  const scrolling = document.scrollingElement ?? document.documentElement;
  const maxScroll = Math.max(0, scrolling.scrollHeight - vh);
  const byY = new Map<number, number[]>();
  for (const index of controls) {
    const box = all[index].getBoundingClientRect();
    const top = box.top + window.scrollY;
    const bottom = box.bottom + window.scrollY;
    let y = 0;
    if (!(top >= 0 && bottom <= vh)) {
      const target = Math.min(maxScroll, Math.max(0, (top + bottom) / 2 - vh / 2));
      // Quantizing moves a control by ≤ vh/4, which keeps it inside the viewport only when it is ≤ vh/2 tall.
      y = Math.round(bottom - top <= step ? Math.min(maxScroll, Math.round(target / step) * step) : target);
    }
    byY.set(y, [...(byY.get(y) ?? []), index]);
  }
  let ys = [...byY.keys()].sort((a, b) => a - b);
  let capped = false;
  if (ys.length > 40) {
    capped = true;
    const kept = Array.from({ length: 40 }, (_, slot) => ys[Math.round((slot * (ys.length - 1)) / 39)]);
    const merged = new Map<number, number[]>(kept.map((y) => [y, []]));
    for (const [y, members] of byY) {
      const nearest = kept.reduce((best, candidate) => (Math.abs(candidate - y) < Math.abs(best - y) ? candidate : best), kept[0]);
      merged.get(nearest)!.push(...members);
    }
    byY.clear();
    for (const [y, members] of merged) byY.set(y, members);
    ys = kept;
  }
  return { positions: ys.map((y) => ({ y, controls: byY.get(y) ?? [] })), controls: controls.length, capped };
}

export interface OverlapFact {
  selector: string; text: string; rect: PageRect; cover: string; ratio: number; centre: boolean; scrollY: number;
  /** The covering element is pinned to the viewport top (a sticky or fixed header). */
  coverAtTop?: boolean;
}

/** Scrolls, lets scroll listeners run (2 rAF + 100 ms), then measures fixed/sticky coverage. */
export async function measureFixedOverlap(input: { y: number; controls: number[] }): Promise<OverlapFact[]> {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  window.scrollTo(0, input.y);
  window.dispatchEvent(new Event('scroll'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  const all = qa.elements(false);
  const covering = all.filter((element) => {
    const position = getComputedStyle(element).position;
    return (position === 'fixed' || position === 'sticky') && qa.visible(element);
  });
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const result: OverlapFact[] = [];
  for (const index of input.controls) {
    const control = all[index];
    if (!control) continue;
    const box = control.getBoundingClientRect();
    const area = box.width * box.height;
    if (area <= 0) continue;
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const centreHit = cx >= 0 && cx < vw && cy >= 0 && cy < vh ? qa.hit(cx, cy) : null;
    let best: { cover: Element; ratio: number; centre: boolean; top: boolean } | null = null;
    for (const cover of covering) {
      if (qa.contains(cover, control) || qa.contains(control, cover)) continue;
      const frame = cover.getBoundingClientRect();
      const x0 = Math.max(box.left, frame.left, 0);
      const x1 = Math.min(box.right, frame.right, vw);
      const y0 = Math.max(box.top, frame.top, 0);
      const y1 = Math.min(box.bottom, frame.bottom, vh);
      if (x1 <= x0 || y1 <= y0) continue;
      const top = qa.hit((x0 + x1) / 2, (y0 + y1) / 2);
      const confirmed = top !== null && qa.contains(cover, top);
      const centre = centreHit !== null && qa.contains(cover, centreHit) && !qa.contains(control, centreHit);
      if (!confirmed && !centre) continue;
      const ratio = confirmed ? ((x1 - x0) * (y1 - y0)) / area : 0;
      if (!best || (centre && !best.centre) || (centre === best.centre && ratio > best.ratio)) best = { cover, ratio, centre, top: frame.top <= 1 };
    }
    if (best) {
      result.push({
        selector: qa.path(control), text: qa.label(control).slice(0, 40), rect: qa.rect(control), cover: qa.path(best.cover),
        ratio: Math.round(best.ratio * 1000) / 1000, centre: best.centre, scrollY: Math.round(window.scrollY), coverAtTop: best.top,
      });
    }
  }
  return result;
}

/**
 * Centres the icon in the viewport, then deep-hit-tests its centre and 15%-inset corners. Returns
 * the selector of an element painted over it (a fixed cookie bar, a sticky footer), or null when
 * the icon itself (or an ancestor, for pointer-events:none images) is on top at every point.
 */
export async function iconCover(index: number): Promise<string | null> {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const element = qa.elements(false)[index];
  if (!element) return null;
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const box = element.getBoundingClientRect();
  const inset = { x: box.width * 0.15, y: box.height * 0.15 };
  const points = [
    [box.left + box.width / 2, box.top + box.height / 2],
    [box.left + inset.x, box.top + inset.y], [box.right - inset.x, box.top + inset.y],
    [box.left + inset.x, box.bottom - inset.y], [box.right - inset.x, box.bottom - inset.y],
  ];
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
    const top = qa.hit(x, y);
    if (!top || qa.contains(element, top) || qa.contains(top, element)) continue;
    return qa.path(top);
  }
  return null;
}

export type IconSource =
  | { status: 'ok'; width: number; height: number; data: string; background: [number, number, number] }
  | { status: 'tainted' | 'unavailable'; reason: string };

/** The image's own pixels (≤ 256 px on the longest side) and the background it is painted on. */
export function readIconSource(index: number): IconSource {
  const qa = (window as unknown as QaWindow).__designLensQa;
  if (!qa) throw new Error('qa page helpers are not installed');
  const element = qa.elements(false)[index];
  if (!(element instanceof HTMLImageElement) || !element.complete || element.naturalWidth === 0) return { status: 'unavailable', reason: 'image is not decoded' };
  const scale = Math.min(1, 256 / Math.max(element.naturalWidth, element.naturalHeight || 1));
  const width = Math.max(1, Math.round(element.naturalWidth * scale));
  const height = Math.max(1, Math.round((element.naturalHeight || element.naturalWidth) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return { status: 'unavailable', reason: 'no 2d canvas' };
  context.drawImage(element, 0, 0, width, height);
  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, width, height).data;
  } catch (error) {
    return { status: 'tainted', reason: error instanceof Error ? error.message : String(error) };
  }
  let binary = '';
  for (let offset = 0; offset < pixels.length; offset += 0x8000) binary += String.fromCharCode(...pixels.subarray(offset, offset + 0x8000));
  let background: [number, number, number] = [255, 255, 255];
  for (let node: Element | null = element; node; node = qa.parent(node)) {
    const match = /rgba?\(([^)]*)\)/.exec(getComputedStyle(node).backgroundColor);
    if (!match) continue;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if ((parts.length > 3 ? parts[3] : 1) > 0) { background = [parts[0], parts[1], parts[2]]; break; }
  }
  return { status: 'ok', width, height, data: btoa(binary), background };
}

export interface SkeletonToken { columns: number; height: number }

/** Self-contained (also runs in the CSP-locked clone render): section skeleton of the active body. */
export function probeSkeleton(): SkeletonToken[] {
  const activeHost = Array.from(document.querySelectorAll('[data-dl-generated="host"]'))
    .find((host) => host.shadowRoot && getComputedStyle(host).display !== 'none');
  let node: Element = activeHost?.shadowRoot?.querySelector('[data-dl-generated="body"]') ?? document.body;
  if (!node) return [];
  const kids = (element: Element): Element[] => Array.from(element.shadowRoot ? element.shadowRoot.children : element.children);
  const shown = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const vh = window.innerHeight;
  for (let depth = 0; depth < 50; depth += 1) {
    const height = node.getBoundingClientRect().height;
    if (height <= 0) break;
    const tall = kids(node).filter((kid) => shown(kid) && kid.getBoundingClientRect().height >= 0.9 * height);
    if (tall.length !== 1) break;
    node = tall[0];
  }
  const tokens: SkeletonToken[] = [];
  for (const block of kids(node)) {
    if (!shown(block)) continue;
    const box = block.getBoundingClientRect();
    if (box.height < 0.15 * vh) continue;
    const lefts = new Set<number>();
    let frontier = [block];
    for (let depth = 0; depth < 3; depth += 1) {
      const next: Element[] = [];
      for (const element of frontier) {
        for (const kid of kids(element)) {
          if (!shown(kid)) continue;
          const kidBox = kid.getBoundingClientRect();
          if (kidBox.width >= 0.15 * box.width) lefts.add(Math.round((kidBox.left - box.left) / 8) * 8);
          next.push(kid);
        }
      }
      frontier = next;
    }
    tokens.push({ columns: Math.min(6, lefts.size), height: Math.round(box.height) });
  }
  return tokens;
}
