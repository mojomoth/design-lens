/// <reference lib="dom" />
import * as cheerio from 'cheerio';
import type { Frame, Page } from 'playwright';

import { serializeDom } from './serialize.js';
import { stampDom } from './stamp.js';
import { stabilize } from './stabilize.js';

export interface FrameSnapshot {
  dlId: string;
  html: string;
  baseUrl: string;
}

/** Keep live frame measurements unchanged: substitute only in the serialized document. */
export function embedFrameSnapshots(html: string, frames: readonly FrameSnapshot[]): string {
  if (frames.length === 0) return html;
  const $ = cheerio.load(html);
  for (const snapshot of frames) {
    const frame = $(`iframe[data-dl-id="${snapshot.dlId}"]`);
    if (frame.length !== 1) throw new Error(`ambiguous frame identity: ${snapshot.dlId}`);
    const child = cheerio.load(snapshot.html);
    child('base').remove();
    child('head').prepend(child('<base>').attr('href', snapshot.baseUrl));
    frame.attr('srcdoc', child.html()).removeAttr('src').removeAttr('integrity');
  }
  return $.html();
}

/** Snapshot rendered frame DOM (including JS output) instead of replaying its original program. */
export async function captureFrames(page: Page, deadline: number): Promise<{ frames: FrameSnapshot[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (page.mainFrame().childFrames().length > 0) {
    // Whole-frame pixels can hide a tiny missing logo or a fallback font below the image budget.
    // Preserve the editable document while refusing a complete claim until its nodes are measured.
    warnings.push('embedded frame content is preserved, but frame-scoped element and font coverage is unverified');
  }
  async function children(parent: Frame, depth: number): Promise<FrameSnapshot[]> {
    const result: FrameSnapshot[] = [];
    for (const child of parent.childFrames()) {
      if (Date.now() >= deadline || depth > 8) {
        warnings.push('embedded frame capture limit reached; frame coverage is incomplete');
        break;
      }
      try {
        const host = await child.frameElement();
        const dlId = await host.getAttribute('data-dl-id');
        if (!dlId) { warnings.push('embedded frame has no addressable host'); continue; }
        const baseUrl = await child.evaluate(() => document.baseURI);
        await stampDom(child, []);
        const readiness = await stabilize(child, deadline);
        warnings.push(...readiness.warnings.map((warning) => `frame ${dlId}: ${warning}`));
        const nested = await children(child, depth + 1);
        const serialized = await serializeDom(child);
        warnings.push(...serialized.warnings.map((warning) => `frame ${dlId}: ${warning}`));
        result.push({ dlId, baseUrl, html: embedFrameSnapshots(serialized.html, nested) });
      } catch (error) {
        warnings.push(`embedded frame unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }
  return { frames: await children(page.mainFrame(), 0), warnings };
}
