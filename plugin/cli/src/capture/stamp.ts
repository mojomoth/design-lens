/// <reference lib="dom" />
/**
 * Pre-serialize DOM mutations run in the page context: remove unwanted nodes, then stamp a unique
 * `data-dl-id` on every element under `<body>` — INCLUDING elements inside open shadow roots
 * (spec 02 §3). These ids are the addressing system every agent edit anchors on, so they MUST be
 * unique and survive serialization/beautification byte-exact. `script`/`style` are skipped (they
 * are stripped or folded away and are not edit targets). No capture-time metadata file is written —
 * `inspect` measures the served clone live (ADR-002).
 *
 * The stamping callback runs in Chromium (hence the DOM lib reference); it is passed to
 * `page.evaluate`, so it must be self-contained (no closed-over Node values).
 *
 * Spec: specs/02-clone-engine.md §3 (Pre-serialize DOM mutations).
 */

import type { Page } from 'playwright';

/**
 * Remove every `removeSelectors` match, then stamp `data-dl-id="dl-N"` (N from 1, document order)
 * on every body element (descending into open shadow roots), skipping `script`/`style`. Returns the
 * number of elements stamped (for the manifest `stats.elementsStamped`).
 */
export function stampDom(page: Page, removeSelectors: string[]): Promise<number> {
  return page.evaluate((selectors: string[]): number => {
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => node.remove());
      } catch {
        // An invalid selector is ignored rather than aborting the whole capture.
      }
    }

    let counter = 0;
    const stamp = (element: Element): void => {
      const tag = element.tagName.toLowerCase();
      if (tag !== 'script' && tag !== 'style') {
        counter += 1;
        element.setAttribute('data-dl-id', `dl-${counter}`);
      }
      const shadow = element.shadowRoot; // non-null only for OPEN shadow roots
      if (shadow) {
        for (const child of Array.from(shadow.children)) stamp(child);
      }
      for (const child of Array.from(element.children)) stamp(child);
    };

    if (document.body) {
      for (const child of Array.from(document.body.children)) stamp(child);
    }
    return counter;
  }, removeSelectors);
}
