/// <reference lib="dom" />
/** Preserve script-created paragraphs that HTML's tree builder would otherwise split apart. */
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
  for (let index = 0; index < roots.length; index++) {
    for (const element of Array.from(roots[index].querySelectorAll('*'))) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element instanceof HTMLTemplateElement) roots.push(element.content);
      if (element.localName === 'p' && element.namespaceURI === htmlNamespace) paragraphs.push(element);
    }
  }
  // These HTML start tags close an open paragraph even when scripts inserted them under an inline
  // descendant. The detached replacement keeps those children inside their original paragraph.
  const closingTags = new Set('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr listing main menu nav ol p pre search section summary table ul'.split(' '));
  const affected = paragraphs.some((paragraph) => Array.from(paragraph.querySelectorAll('*'))
    .some((child) => child.namespaceURI === htmlNamespace && closingTags.has(child.localName)));
  let alias = 'dl-static-p';
  const warnings: string[] = [];
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
    ...(affected ? { domTransformation(root: Element): void {
      root.setAttribute('data-dl-paragraph-alias', alias);
      const scopes: Array<Element | ShadowRoot | DocumentFragment> = [root];
      for (let index = 0; index < scopes.length; index++) {
        const scope = scopes[index];
        for (const element of Array.from(scope.querySelectorAll('*'))) {
          if (element.shadowRoot) scopes.push(element.shadowRoot);
          if (element instanceof HTMLTemplateElement) scopes.push(element.content);
          if (element.localName !== 'p' || element.namespaceURI !== htmlNamespace) continue;
          const replacement = document.createElement(alias);
          for (const attribute of Array.from(element.attributes)) replacement.setAttribute(attribute.name, attribute.value);
          replacement.setAttribute('data-dl-original-tag', 'p');
          if (!replacement.hasAttribute('role')) replacement.setAttribute('role', 'paragraph');
          while (element.firstChild) replacement.append(element.firstChild);
          element.replaceWith(replacement);
        }
        // Native paragraph defaults belong below all author layers, including zero-specificity
        // rules. A plain unlayered reset would incorrectly outrank layered source stylesheets.
        const sheet = document.createElement('style');
        sheet.setAttribute('data-dl-paragraph-defaults', alias);
        sheet.textContent = `@layer ${alias}-ua{:where(${alias}){display:block;margin-block:1em;margin-inline:0;unicode-bidi:isolate}}`;
        if (scope === root) (root.querySelector('head') ?? root).prepend(sheet);
        else scope.prepend(sheet);
      }
    } } : {}),
  });
  return { html: out.html, resources: out.resources, warnings: [...warnings, ...out.warnings ?? []] };
}
