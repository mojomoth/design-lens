/// <reference lib="dom" />
/**
 * Serialize the live DOM to a self-contained HTML string. The primary engine is `@percy/dom`
 * (spec 02 §M2) — the only maintained OSS serializer that captures CSSOM `insertRule` output,
 * `adoptedStyleSheets`, live input state → attributes, `<canvas>` bitmaps → `data:` images, and
 * open shadow roots → declarative `<template shadowroot>`. Its browser bundle is injected via
 * `page.addScriptTag`, run with `PercyDOM.serialize()`, then reshaped into a standalone inert
 * fragment by {@link restorePercyDom} (percy's raw output is built for Percy's replay SaaS, not a
 * file mirror).
 *
 * The original hand-rolled CSSOM-walk serializer is KEPT as an automatic fallback: if percy throws
 * or returns empty output we warn and fall back, so a percy regression degrades fidelity instead of
 * failing the clone. Only BOTH engines failing is fatal (the caller's navigation error path).
 *
 * The `page.evaluate` callbacks run in Chromium (hence the DOM lib reference) and must be
 * self-contained (no closed-over Node values).
 *
 * Spec: specs/02-clone-engine.md §4 (Serialize) & §M2 (percy upgrade).
 */

import type { Frame, Page } from 'playwright';

import { PERCY_DOM_SRC } from './percy-dom-src.js';
import { restorePercyDom, type PercySerialized } from './percy-restore.js';

/** The serialized document plus counters for the manifest/report. */
export interface SerializeResult {
  /** `<!DOCTYPE html>` + the serialized document, self-contained and inert-ready. */
  html: string;
  /** Total readable CSS rules across the page's sheets (manifest `stats.styleRules`). */
  styleRules: number;
  /** Which engine produced {@link html} — `own` means percy was unavailable and we fell back. */
  serializer: 'percy' | 'own';
  /** `<canvas>` elements converted to `data:` images (REPORT fidelity; 0 on the fallback path). */
  canvasConverted: number;
  /** Declarative `<template shadowroot>` shadow roots emitted (REPORT fidelity; 0 on fallback). */
  shadowRootsSerialized: number;
  /** Non-fatal warnings (e.g. percy failed → fell back). Merged into the run's warning count. */
  warnings: string[];
}

/** Count readable CSS rules across `styleSheets` + `adoptedStyleSheets` (cross-origin sheets skip). */
function countStyleRules(page: Page | Frame): Promise<number> {
  return page.evaluate((): number => {
    let total = 0;
    const add = (sheet: CSSStyleSheet): void => {
      try {
        total += sheet.cssRules.length; // cross-origin sheets throw SecurityError here
      } catch {
        /* cross-origin sheet: not countable, not fatal */
      }
    };
    for (const sheet of Array.from(document.styleSheets)) add(sheet);
    for (const sheet of Array.from(document.adoptedStyleSheets ?? [])) add(sheet);
    return total;
  });
}

/**
 * Inject the @percy/dom bundle and run `PercyDOM.serialize()`. Returns the raw `{ html, resources }`
 * payload, or `null` if percy did not define its global or produced empty output (→ caller falls
 * back). Throwing propagates to the caller's try/catch, which also falls back.
 */
async function serializePercy(page: Page | Frame): Promise<PercySerialized | null> {
  await page.evaluate(() => {
    const roots: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < roots.length; index++) {
      for (const element of Array.from(roots[index].querySelectorAll('*'))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        if (element instanceof HTMLCanvasElement) {
          const computed = getComputedStyle(element);
          const style = Array.from(computed).map((property) => `${property}:${computed.getPropertyValue(property)};`).join('');
          element.setAttribute('data-dl-canvas-style', style);
        }
      }
    }
  });
  await page.addScriptTag({ content: PERCY_DOM_SRC });
  const raw = await page.evaluate((): { html: string; resources: unknown[]; warnings: string[] } | null => {
    const percy = (window as unknown as {
      PercyDOM?: { serialize: (options: object) => { html: string; resources: unknown[]; warnings?: string[] } };
    }).PercyDOM;
    if (!percy || typeof percy.serialize !== 'function') return null;
    const out = percy.serialize({ dom: document });
    return { html: out.html, resources: out.resources, warnings: out.warnings ?? [] };
  });
  if (!raw || typeof raw.html !== 'string' || raw.html.trim() === '') return null;
  return { html: raw.html, resources: raw.resources as PercySerialized['resources'], warnings: raw.warnings };
}

/**
 * The original ~50-line CSSOM-walk serializer, retained as the percy fallback. `outerHTML` alone
 * LOSES `insertRule`/`adoptedStyleSheets` CSS (CSS-in-JS serializes as empty `<style>` tags); this
 * walks `document.styleSheets`, folding each `<style>`-owned sheet's `cssRules` back into its text
 * and appending one `<style data-dl-adopted>` per adopted sheet. `<link>` sheets keep their element
 * (bodies come from the ResourceStore); cross-origin sheets throw `SecurityError` and are skipped.
 */
function serializeOwn(page: Page | Frame): Promise<{ html: string; styleRules: number }> {
  return page.evaluate((): { html: string; styleRules: number } => {
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

    for (const sheet of Array.from(document.adoptedStyleSheets ?? [])) {
      const serialized = serializeRules(sheet);
      if (serialized === null) continue;
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-dl-adopted', '');
      styleEl.textContent = serialized.text;
      document.head.appendChild(styleEl);
      styleRules += serialized.count;
    }

    return { html: `<!DOCTYPE html>${document.documentElement.outerHTML}`, styleRules };
  });
}

/**
 * Serialize the live DOM, preferring @percy/dom and falling back to the built-in walk. The returned
 * HTML is a full document ready for the sanitize → localize → beautify passes; `data-dl-id` stamps
 * and shadow roots are preserved by both engines.
 */
export async function serializeDom(page: Page | Frame): Promise<SerializeResult> {
  const warnings: string[] = [];
  try {
    const raw = await serializePercy(page);
    if (raw) {
      // Count rules from the live CSSOM before restore reshapes the markup (restore inlines
      // adopted sheets as <style>, but the count reflects what the page actually carried).
      const styleRules = await countStyleRules(page);
      const restored = restorePercyDom(raw);
      warnings.push(...restored.warnings);
      return {
        html: restored.html,
        styleRules,
        serializer: 'percy',
        canvasConverted: restored.canvasConverted,
        shadowRootsSerialized: restored.shadowRootsSerialized,
        warnings,
      };
    }
    warnings.push('@percy/dom serialize returned empty output; used the built-in serializer');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warnings.push(`@percy/dom serialize failed (${detail}); used the built-in serializer`);
  }

  const own = await serializeOwn(page);
  return {
    html: own.html,
    styleRules: own.styleRules,
    serializer: 'own',
    canvasConverted: 0,
    shadowRootsSerialized: 0,
    warnings,
  };
}
