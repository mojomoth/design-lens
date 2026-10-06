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

import type { Frame, Page } from 'playwright';

/**
 * Remove every `removeSelectors` match, then stamp `data-dl-id="dl-N"` (N from 1, document order)
 * on every body element (descending into open shadow roots), skipping `script`/`style`. Returns the
 * number of elements stamped (for the manifest `stats.elementsStamped`).
 */
export function stampDom(page: Page | Frame, removeSelectors: string[]): Promise<number> {
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

/** Elements that scripts inserted after {@link stampDom}, now stamped with fresh unique IDs. */
export interface LateStamp {
  ids: string[];
  /** Count per tag name, for the disclosure line. */
  tags: Record<string, number>;
}

/**
 * Stamp body elements (including open shadow roots) that appeared after the first stamping, e.g.
 * tracking pixels injected by scripts. New IDs continue after the largest existing `dl-N`, so IDs
 * stay unique and every serialized element remains addressable and measurable. `removeSelectors`
 * matches are removed first, exactly as {@link stampDom} does: a banner the page re-inserts after
 * stamping must not reach the clone under the recorded removal policy.
 */
export function stampLate(page: Page | Frame, removeSelectors: string[] = []): Promise<LateStamp> {
  return page.evaluate((selectors: string[]): LateStamp => {
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => node.remove());
      } catch {
        // An invalid selector is ignored rather than aborting the whole capture, as in stampDom.
      }
    }
    const elements: Element[] = [];
    const visit = (element: Element): void => {
      elements.push(element);
      if (element.shadowRoot) for (const child of Array.from(element.shadowRoot.children)) visit(child);
      for (const child of Array.from(element.children)) visit(child);
    };
    if (document.body) for (const child of Array.from(document.body.children)) visit(child);
    let max = 0;
    for (const element of elements) {
      const match = /^dl-(\d+)$/.exec(element.getAttribute('data-dl-id') ?? '');
      if (match) max = Math.max(max, Number(match[1]));
    }
    const result: LateStamp = { ids: [], tags: {} };
    for (const element of elements) {
      const tag = element.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || element.hasAttribute('data-dl-id')) continue;
      max += 1;
      const id = `dl-${max}`;
      element.setAttribute('data-dl-id', id);
      result.ids.push(id);
      result.tags[tag] = (result.tags[tag] ?? 0) + 1;
    }
    return result;
  }, removeSelectors);
}
