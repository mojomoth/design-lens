/// <reference lib="dom" />
/**
 * The own ~50-line CSSOM-walk serializer (M1 default; kept as the M2 percy fallback).
 *
 * `outerHTML` alone LOSES CSS injected via `insertRule` and every `adoptedStyleSheets` rule — a
 * CSS-in-JS page serializes as empty `<style>` tags (spec 02 §4, Verified facts). This walks
 * `document.styleSheets`: for each sheet whose rules are readable and whose owner is a `<style>`,
 * it replaces the element's text with the serialized `cssRules` (capturing `insertRule` output);
 * it appends one `<style data-dl-adopted>` per `document.adoptedStyleSheets` entry. `<link>`
 * stylesheets keep their element — their bodies are localized from the ResourceStore. Cross-origin
 * sheets throw `SecurityError` on `cssRules` and are left as their `<link>` (caught, not fatal).
 *
 * Runs in Chromium (hence the DOM lib reference); passed to `page.evaluate`, so self-contained.
 *
 * Spec: specs/02-clone-engine.md §4 (Serialize).
 */

import type { Page } from 'playwright';

/** The serialized document plus counters for the manifest/report. */
export interface SerializeResult {
  /** `<!DOCTYPE html>` + the live `documentElement.outerHTML`, with CSSOM rules folded in. */
  html: string;
  /** Total CSS rules folded from `<style>`-owned sheets (manifest `stats.styleRules`). */
  styleRules: number;
  /** Number of `adoptedStyleSheets` emitted as `<style data-dl-adopted>` elements. */
  adoptedSheets: number;
}

/** Serialize the live DOM with CSSOM rules folded into `<style>` elements. */
export function serializeDom(page: Page): Promise<SerializeResult> {
  return page.evaluate((): SerializeResult => {
    const serializeRules = (sheet: CSSStyleSheet): { text: string; count: number } | null => {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules; // cross-origin sheets throw SecurityError here
      } catch {
        return null;
      }
      const list = Array.from(rules);
      return { text: list.map((rule) => rule.cssText).join('\n'), count: list.length };
    };

    let styleRules = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode;
      if (!owner || owner.nodeName.toLowerCase() !== 'style') continue;
      const serialized = serializeRules(sheet);
      if (serialized === null) continue;
      (owner as HTMLStyleElement).textContent = serialized.text;
      styleRules += serialized.count;
    }

    let adoptedSheets = 0;
    for (const sheet of Array.from(document.adoptedStyleSheets ?? [])) {
      const serialized = serializeRules(sheet);
      if (serialized === null) continue;
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-dl-adopted', '');
      styleEl.textContent = serialized.text;
      document.head.appendChild(styleEl);
      styleRules += serialized.count;
      adoptedSheets += 1;
    }

    return {
      html: `<!DOCTYPE html>${document.documentElement.outerHTML}`,
      styleRules,
      adoptedSheets,
    };
  });
}
