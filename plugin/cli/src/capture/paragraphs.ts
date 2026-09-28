/// <reference lib="dom" />
/** Preserve script-created paragraphs and remembered skipped-content sizes in detached snapshots. */
import type { PercySerialized } from './percy-restore.js';

/**
 * Runs entirely in the browser. Percy supplies a detached DOM, so changing its element names does
 * not change the live page used for source observations or screenshots. Normalize every paragraph
 * in an affected document: mixing native and aliased paragraphs changes the meaning of of-type.
 */
export function serializeWithParagraphNormalization(): (PercySerialized & { warnings: string[] }) | null {
  const percy = (window as unknown as {
    PercyDOM?: { serialize(options: object): PercySerialized & { warnings?: string[] } };
  }).PercyDOM;
  if (!percy) return null;
  const htmlNamespace = 'http://www.w3.org/1999/xhtml';
  const roots: Array<Document | ShadowRoot | DocumentFragment> = [document];
  const paragraphs: Element[] = [];
  type IntrinsicSize = { width?: string; height?: string };
  const autoVisibilityIds = new Map<string, IntrinsicSize>();
  const documentIntrinsicSizes = new Map<string, IntrinsicSize>();
  const warnings: string[] = [];
  for (let index = 0; index < roots.length; index++) {
    for (const element of Array.from(roots[index].querySelectorAll('*'))) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element instanceof HTMLTemplateElement) roots.push(element.content);
      if (element.localName === 'p' && element.namespaceURI === htmlNamespace) paragraphs.push(element);
      // A fresh renderer has no remembered size for offscreen auto content. Copy only its
      // fallback intrinsic content-box size; actual visible content still lays out and reflows.
      const style = getComputedStyle(element);
      if (style.contentVisibility === 'auto') {
        const intrinsic: IntrinsicSize = {};
        for (const axis of ['width', 'height'] as const) {
          const property = axis === 'width' ? 'containIntrinsicWidth' : 'containIntrinsicHeight';
          if (!style[property].startsWith('auto')) continue;
          const used = style[axis];
          if (!/^\d+(?:\.\d+)?px$/.test(used)) {
            warnings.push(`content-visibility:auto ${axis} is unavailable; intrinsic-size preservation is incomplete`);
            continue;
          }
          const sides = axis === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom'];
          const edges = style.boxSizing === 'border-box' ? sides.reduce((total, side) =>
            total + (parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0)
              + (parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0), 0) : 0;
          intrinsic[axis] = `auto ${Math.max(0, parseFloat(used) - edges)}px`;
        }
        if (Object.keys(intrinsic).length === 0) continue;
        const id = element.getAttribute('data-dl-id');
        if (id) autoVisibilityIds.set(id, intrinsic);
        else if (element === document.documentElement || element === document.body) documentIntrinsicSizes.set(element.localName, intrinsic);
        else warnings.push('content-visibility:auto element has no stable capture ID; intrinsic-size preservation is incomplete');
      }
    }
  }
  // These HTML start tags close an open paragraph even when scripts inserted them under an inline
  // descendant. The detached replacement keeps those children inside their original paragraph.
  const closingTags = new Set('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr listing main menu nav ol p pre search section summary table ul'.split(' '));
  const affected = paragraphs.some((paragraph) => Array.from(paragraph.querySelectorAll('*'))
    .some((child) => child.namespaceURI === htmlNamespace && closingTags.has(child.localName)));
  let alias = 'dl-static-p';
  if (affected) {
    let suffix = 1;
    while (customElements.get(alias) || roots.some((root) => root.querySelector(alias))) alias = `dl-static-p-${++suffix}`;
    const checkedSheets = new Set<CSSStyleSheet>();
    const checkSheet = (sheet: CSSStyleSheet): void => {
      if (checkedSheets.has(sheet)) return;
      checkedSheets.add(sheet);
      const checkRules = (rules: CSSRuleList): void => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && Array.from(rule.style)
            .some((property) => /\brevert(?:-layer)?\b/.test(rule.style.getPropertyValue(property)))) {
            try {
              if (paragraphs.some((paragraph) => paragraph.matches(rule.selectorText))) {
                warnings.push(`paragraph normalization cannot reproduce native UA reversion: ${rule.selectorText}`);
              }
            } catch { warnings.push('paragraph normalization could not inspect a native UA reversion selector'); }
          }
          if (rule instanceof CSSImportRule && rule.styleSheet) checkSheet(rule.styleSheet);
          else if ('cssRules' in rule) checkRules((rule as CSSGroupingRule).cssRules);
        }
      };
      try { checkRules(sheet.cssRules); } catch { warnings.push('paragraph normalization could not inspect stylesheet rules'); }
    };
    for (const scope of roots) {
      if ('styleSheets' in scope) for (const sheet of Array.from(scope.styleSheets)) checkSheet(sheet);
      if ('adoptedStyleSheets' in scope) for (const sheet of scope.adoptedStyleSheets) checkSheet(sheet);
    }
    if (paragraphs.some((paragraph) => /\brevert(?:-layer)?\b/.test(paragraph.getAttribute('style') ?? ''))) {
      warnings.push('paragraph normalization cannot reproduce inline native UA reversion');
    }
  }
  const out = percy.serialize({
    dom: document,
    ...(affected || autoVisibilityIds.size > 0 || documentIntrinsicSizes.size > 0 ? { domTransformation(root: Element): void {
      if (affected) root.setAttribute('data-dl-paragraph-alias', alias);
      const scopes: Array<Element | ShadowRoot | DocumentFragment> = [root];
      for (let index = 0; index < scopes.length; index++) {
        const scope = scopes[index];
        const elements = [...(scope === root ? [root] : []), ...Array.from(scope.querySelectorAll('*'))];
        for (const element of elements) {
          if (element.shadowRoot) scopes.push(element.shadowRoot);
          if (element instanceof HTMLTemplateElement) scopes.push(element.content);
          const id = element.getAttribute('data-dl-id');
          const intrinsic = (id ? autoVisibilityIds.get(id) : undefined)
            ?? ((element === root || element === root.querySelector('body')) ? documentIntrinsicSizes.get(element.localName) : undefined);
          if (intrinsic) {
            const style = (element as HTMLElement).style;
            if (style) {
              if (intrinsic.width) style.setProperty('contain-intrinsic-width', intrinsic.width, 'important');
              if (intrinsic.height) style.setProperty('contain-intrinsic-height', intrinsic.height, 'important');
              element.setAttribute('data-dl-content-visibility', 'auto');
            } else warnings.push('content-visibility:auto element cannot carry a static style; intrinsic-size preservation is incomplete');
          }
          if (!affected || element.localName !== 'p' || element.namespaceURI !== htmlNamespace) continue;
          const replacement = document.createElement(alias);
          for (const attribute of Array.from(element.attributes)) replacement.setAttribute(attribute.name, attribute.value);
          replacement.setAttribute('data-dl-original-tag', 'p');
          if (!replacement.hasAttribute('role')) replacement.setAttribute('role', 'paragraph');
          while (element.firstChild) replacement.append(element.firstChild);
          element.replaceWith(replacement);
        }
        if (!affected) continue;
        // Native paragraph defaults belong below all author layers, including zero-specificity
        // rules. An anonymous layer cannot merge with or reorder any named source layer.
        const sheet = document.createElement('style');
        sheet.setAttribute('data-dl-paragraph-defaults', alias);
        sheet.textContent = `@layer{:where(${alias}){display:block;margin-block:1em;margin-inline:0;unicode-bidi:isolate}}`;
        if (scope === root) (root.querySelector('head') ?? root).prepend(sheet);
        else scope.prepend(sheet);
      }
    } } : {}),
  });
  return { html: out.html, resources: out.resources, warnings: [...warnings, ...out.warnings ?? []] };
}
