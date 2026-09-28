/// <reference lib="dom" />
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Browser } from 'playwright';

import { observePage } from '../../src/analyze/observations.js';
import type { PlaywrightModule } from '../../src/capture/browser.js';
import { stabilize } from '../../src/capture/stabilize.js';
import { loadRuntimeDep } from '../../src/lib/runtime-deps.js';

let browser: Browser;

beforeAll(async () => {
  browser = await loadRuntimeDep<PlaywrightModule>('playwright').chromium.launch({ headless: true });
});
afterAll(async () => { await browser.close(); });

function variant(capture: string, firstId: number, hidden: boolean, content: string): string {
  return `<dl-variant data-dl-generated="host" data-dl-source-capture="${capture}" data-dl-id="dl-${firstId}"
    style="display:${hidden ? 'none' : 'contents'}"><template shadowrootmode="open">
    <style>dl-root,dl-body{display:block}</style>
    <dl-root data-dl-generated="root" data-dl-id="dl-${firstId + 1}">
      <dl-body data-dl-generated="body" data-dl-id="dl-${firstId + 2}">${content}</dl-body>
    </dl-root></template></dl-variant>`;
}

// A hidden earlier capture must not consume the active capture's measurement budget. Explicit
// full inventory retains its bounded behavior and can still address inactive sampled elements.
it('measures the active last variant within a small limit and keeps explicit inactive inventory bounded', async () => {
  const page = await browser.newPage();
  try {
    const paragraphs = (capture: string, start: number): string => [0, 1].map((offset) =>
      `<p data-dl-id="dl-${start + offset}" data-dl-source-capture="${capture}" data-dl-source-id="dl-${offset + 1}">Paragraph ${offset}</p>`).join('');
    await page.setContent(`<!doctype html><body>${variant('hidden', 1, true, paragraphs('hidden', 4))}
      ${variant('active', 6, false, paragraphs('active', 9))}</body>`);
    const active = await observePage(page, { maxElements: 8 });
    expect(active.complete, active.warnings.join('\n')).toBe(true);
    expect(active.activeCaptureId).toBe('active');
    expect(active.elements.filter((element) => element.source).map((element) => element.dlId)).toEqual(['dl-9', 'dl-10']);
    expect(active.elements.filter((element) => element.source).every((element) => element.visible)).toBe(true);

    const limited = await observePage(page, { maxElements: 8, includeInactiveVariants: true });
    expect(limited.complete).toBe(false);
    expect(limited.warnings).toContain('observation element limit reached (8)');
    const all = await observePage(page, { maxElements: 50, includeDocumentElements: true, includeInactiveVariants: true });
    expect(all.complete, all.warnings.join('\n')).toBe(true);
    const inactive = all.elements.filter((element) => element.source?.captureId === 'hidden');
    expect(inactive.map((element) => element.dlId)).toEqual(['dl-4', 'dl-5']);
    expect(inactive.every((element) => !element.visible)).toBe(true);
    expect(all.elements.filter((element) => element.source?.captureId === 'active')).toHaveLength(2);
  } finally { await page.close(); }
});

// Each source capture may fit its own 20k limit while their composed DOM exceeds that limit.
// Stabilization for fidelity must use the active tree; ordinary source stabilization keeps its cap.
it('stabilizes the active tree despite an oversized hidden variant while retaining the legacy limit', async () => {
  const page = await browser.newPage();
  try {
    const hidden = '<span>Inactive content</span>'.repeat(21_000);
    await page.setContent(`<!doctype html><body>${variant('hidden', 1, true, hidden)}
      ${variant('active', 4, false, '<p data-dl-id="dl-7">Active content</p>')}</body>`);
    const active = await stabilize(page, Date.now() + 10_000, { activeResponsiveOnly: true });
    expect(active.complete, active.warnings.join('\n')).toBe(true);
    const all = await stabilize(page, Date.now() + 10_000);
    expect(all.complete).toBe(false);
    expect(all.warnings).toContain('stabilization element limit or deadline reached');
  } finally { await page.close(); }
});
