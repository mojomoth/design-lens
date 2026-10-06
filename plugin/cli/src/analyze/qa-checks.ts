/**
 * Pure `qa` decisions over measured page facts: which links are stand-ins, which overlaps and
 * clipped boxes fail, which fonts drifted from the Build contract, and the run status. Thresholds
 * live here so unit tests pin them without a browser.
 */

import { evaluateSignatureCheck, normalizeFontFamily, type BuildContract, type SignatureCheck } from './build-contract.js';
import type { LightnessHistogram } from './pixels.js';
import type { ClippedFact, FontUse, HeadingFont, ImageFact, LinkFact, OverlapFact, PageRect, SignatureObservation } from './qa-probes.js';
import type { ToneProfile } from './tone.js';

export type QaSeverity = 'fail' | 'warn';
export type QaStatus = 'pass' | 'fail' | 'unverified';
export interface QaFinding {
  check: string;
  severity: QaSeverity;
  viewport: string;
  selector: string | null;
  text?: string;
  /** Document CSS px. */
  rect?: PageRect;
  detail: string;
}
export interface QaSkipped { check: string; viewport?: string; reason: string; affectsStatus: boolean }

export const OVERLAP_FAIL_RATIO = 0.15;
/** Below this share, coverage by a bar pinned to the viewport top (a sticky header over a tall card) is not reported. */
export const OVERLAP_TOP_SLIVER_RATIO = 0.05;
export const CLIP_SPILL_RATIO = 0.15;
export const CLIP_DISPLAY_FONT_PX = 48;
export const ICON_RENDERED_MODAL = 0.98;
export const ICON_SOURCE_MODAL = 0.9;
export const STAND_IN_GLYPHS = /[↗↘⤴⤓]|📥/u;
const SELF_ANCHOR_EXEMPT = /^(top|main|content)$/i;
/** A fragment that is a client-side route (`#/about`, `#!/work`), not an element id. */
export const HASH_ROUTE = /^!?\//;

function normalizedLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface LinkSummary { total: number; inPage: number; standIn: number }

/**
 * `reachable` holds the indices of links whose shadow-root target a click demonstrably scrolled into
 * view (a script makes them work); every other shadow-root target is unreachable by fragment
 * navigation. Hash routes are destinations, not element ids.
 */
export function linkFindings(links: readonly LinkFact[], viewport: string, reachable: ReadonlySet<number> = new Set()): { findings: QaFinding[]; summary: LinkSummary } {
  const findings: QaFinding[] = [];
  const standIn = new Set<LinkFact>();
  const exists = (link: LinkFact): boolean => link.targetExists || (link.targetInShadow && reachable.has(link.index));
  const route = (link: LinkFact): boolean => link.targetId !== null && HASH_ROUTE.test(link.targetId);
  for (const link of links) {
    const reasons: string[] = [];
    const href = link.href?.trim();
    if (link.href === null) { if (link.visible) reasons.push('visible link has no href'); }
    else if (href === '') reasons.push('href is empty');
    else if (href === '#') reasons.push('href="#" goes nowhere');
    else if (/^javascript:/i.test(href ?? '')) reasons.push('javascript: href is not a destination');
    else if (link.inPage && link.targetId !== null && !route(link)) {
      const id = link.targetId;
      if (id === '') reasons.push('empty fragment goes nowhere');
      else if (!exists(link) && link.targetInShadow) reasons.push(`in-page target #${id} is inside a shadow root; fragment navigation cannot reach it and clicking it did not scroll there (scroll it with a script or link to a real page)`);
      else if (!exists(link) && id.toLowerCase() !== 'top') reasons.push(`in-page target #${id} does not exist in the document`);
      if (link.selfAnchor && !SELF_ANCHOR_EXEMPT.test(id)) reasons.push(`points at #${id}, the section that contains the link`);
      if (STAND_IN_GLYPHS.test(link.label)) reasons.push(`label "${link.label}" promises an external page or download but links in-page to #${id}`);
    }
    if (reasons.length === 0) continue;
    standIn.add(link);
    findings.push({ check: 'stand-in-link', severity: 'fail', viewport, selector: link.selector, text: link.label || undefined, ...(link.rect ? { rect: link.rect } : {}), detail: `${reasons.join('; ')} (href ${link.href === null ? 'absent' : JSON.stringify(link.href)})` });
  }
  const byTarget = new Map<string, { labels: Set<string>; links: LinkFact[] }>();
  const byUrl = new Map<string, { labels: Set<string>; links: LinkFact[] }>();
  for (const link of links) {
    const label = normalizedLabel(link.label);
    if (!label) continue;
    if (link.inPage && link.targetId && link.targetId.toLowerCase() !== 'top' && exists(link) && !route(link)) {
      const entry = byTarget.get(link.targetId) ?? { labels: new Set<string>(), links: [] };
      entry.labels.add(label);
      entry.links.push(link);
      byTarget.set(link.targetId, entry);
    } else if (!link.inPage && link.resolved && /^https?:/i.test(link.resolved) && siteRoot(link.resolved)) {
      const url = link.resolved.replace(/#.*$/, '');
      const entry = byUrl.get(url) ?? { labels: new Set<string>(), links: [] };
      entry.labels.add(label);
      entry.links.push(link);
      byUrl.set(url, entry);
    }
  }
  for (const [id, entry] of byTarget) {
    if (entry.labels.size < 3) continue;
    const fail = entry.labels.size >= 5;
    if (fail) entry.links.forEach((link) => standIn.add(link));
    findings.push({
      check: 'stand-in-link', severity: fail ? 'fail' : 'warn', viewport, selector: `a[href="#${id}"]`,
      detail: `${entry.labels.size} distinct labels share the in-page target #${id}: ${[...entry.labels].map((label) => `"${label}"`).join(', ')}`,
    });
  }
  for (const [url, entry] of byUrl) {
    if (entry.labels.size < 5) continue;
    findings.push({
      check: 'stand-in-link', severity: 'warn', viewport, selector: null,
      detail: `${entry.labels.size} distinct labels share one site root ${url}: ${[...entry.labels].map((label) => `"${label}"`).join(', ')}`,
    });
  }
  return { findings, summary: { total: links.length, inPage: links.filter((link) => link.inPage).length, standIn: standIn.size } };
}

/** Card grids legitimately share a listing page; many labels sharing a bare site root look like stand-ins. */
function siteRoot(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.pathname === '/' || parsed.pathname === '') && parsed.search === '';
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

export function clippedFindings(clipped: readonly ClippedFact[], viewport: string): QaFinding[] {
  return clipped.map((fact) => {
    const share = fact.width > 0 ? fact.overflow / fact.width : 1;
    const spill = share <= CLIP_SPILL_RATIO && fact.fontSize < CLIP_DISPLAY_FONT_PX;
    return {
      check: 'clipped-content', severity: spill ? 'fail' as const : 'warn' as const, viewport, selector: fact.selector,
      ...(fact.text ? { text: fact.text } : {}), rect: fact.rect,
      detail: `extends ${fact.overflow}px (${Math.round(share * 1000) / 10}% of its ${fact.width}px width) past the viewport edge and is clipped by an overflow:hidden ancestor${spill ? '' : '; looks like an intentional bleed'}`,
    };
  });
}

export function overlapFindings(facts: readonly OverlapFact[], viewport: string): QaFinding[] {
  const worst = new Map<string, OverlapFact>();
  for (const fact of facts) {
    const known = worst.get(fact.selector);
    if (!known || (fact.centre && !known.centre) || (fact.centre === known.centre && fact.ratio > known.ratio)) worst.set(fact.selector, fact);
  }
  const findings: QaFinding[] = [];
  for (const fact of worst.values()) {
    if (!fact.centre && fact.ratio <= 0) continue;
    if (!fact.centre && fact.coverAtTop === true && fact.ratio < OVERLAP_TOP_SLIVER_RATIO) continue;
    const fail = fact.centre || fact.ratio >= OVERLAP_FAIL_RATIO;
    findings.push({
      check: 'fixed-overlap', severity: fail ? 'fail' : 'warn', viewport, selector: fact.selector, ...(fact.text ? { text: fact.text } : {}), rect: fact.rect,
      detail: `${fact.cover} covers ${Math.round(fact.ratio * 1000) / 10}% of this control (coveredRatio ${fact.ratio})${fact.centre ? ' including its centre' : ''} at scrollY ${fact.scrollY}`,
    });
  }
  return findings;
}

export function imageFindings(images: readonly ImageFact[], viewport: string): QaFinding[] {
  const findings: QaFinding[] = [];
  for (const image of images) {
    if (image.complete && image.naturalWidth === 0) findings.push({ check: 'broken-image', severity: 'fail', viewport, selector: image.selector, rect: image.rect, detail: `image did not decode: ${image.src || '(no src)'}` });
    else if (!image.complete) findings.push({ check: 'pending-image', severity: 'warn', viewport, selector: image.selector, rect: image.rect, detail: `image was still loading after the scroll sweep: ${image.src || '(no src)'}` });
  }
  return findings;
}

export function solidIcon(rendered: LightnessHistogram, source: LightnessHistogram): boolean {
  return rendered.modalShare >= ICON_RENDERED_MODAL && source.modalShare < ICON_SOURCE_MODAL;
}

export interface FontNetworkFacts {
  status: 'ready' | 'timeout' | 'unavailable';
  failedFamilies: string[];
  /** Font requests that failed without an HTTP status. */
  networkFailures: Array<{ url: string; crossOrigin: boolean }>;
  /** Font responses with HTTP status ≥ 400. */
  httpFailures: string[];
}

export function fontReadiness(facts: FontNetworkFacts, viewport: string): { finding?: QaFinding; skipped?: QaSkipped } {
  if (facts.status === 'ready' && facts.failedFamilies.length === 0) return {};
  const families = facts.failedFamilies.length > 0 ? `; failed families: ${facts.failedFamilies.join(', ')}` : '';
  const network = facts.networkFailures.length > 0 && facts.networkFailures.every((failure) => failure.crossOrigin) && facts.httpFailures.length === 0;
  if (network) {
    return { skipped: { check: 'font-readiness', viewport, affectsStatus: true, reason: `cross-origin font requests failed without an HTTP status (${facts.networkFailures.map((failure) => failure.url).slice(0, 3).join(', ')}); fonts ${facts.status}${families}` } };
  }
  return { finding: { check: 'font-readiness', severity: 'fail', viewport, selector: null, detail: `fonts ${facts.status}${families}${facts.httpFailures.length > 0 ? `; HTTP failures: ${facts.httpFailures.slice(0, 3).join(', ')}` : ''}` } };
}

export function fontDrift(fonts: readonly FontUse[], headings: readonly HeadingFont[], contract: BuildContract, viewport: string): QaFinding[] {
  const allowed = new Set(contract.fonts.map(normalizeFontFamily));
  const display = new Set(contract.displayFonts.map(normalizeFontFamily));
  const findings: QaFinding[] = [];
  for (const use of fonts) {
    if (use.generic || allowed.has(normalizeFontFamily(use.family))) continue;
    findings.push({
      check: 'font-drift', severity: 'fail', viewport, selector: use.samples[0] ?? null,
      detail: `"${use.family}" resolved from the computed stack on ${use.elements} text element(s) but is not in the Build contract fonts (${contract.fonts.join('; ')}); e.g. ${use.samples.join(', ')}`,
    });
  }
  const offDisplay = new Map<string, HeadingFont[]>();
  for (const heading of headings) {
    if (display.has(normalizeFontFamily(heading.family))) continue;
    offDisplay.set(heading.family, [...(offDisplay.get(heading.family) ?? []), heading]);
  }
  for (const [family, items] of offDisplay) {
    findings.push({
      check: 'font-drift', severity: 'fail', viewport, selector: items[0].selector,
      detail: `${items.length} h1/h2 heading(s) resolved from the computed stack to "${family}", which is not a Build contract display font (${contract.displayFonts.join('; ')}); e.g. ${items.slice(0, 3).map((item) => item.selector).join(', ')}`,
    });
  }
  const resolved = new Set(fonts.map((use) => normalizeFontFamily(use.family)));
  for (const family of contract.fonts) {
    if (resolved.has(normalizeFontFamily(family))) continue;
    findings.push({ check: 'font-drift', severity: 'warn', viewport, selector: null, detail: `Build contract font "${family}" is not resolved from the computed stack on any visible text element` });
  }
  return findings;
}

/** A platform font that rendered part of a heading (CDP `CSS.getPlatformFontsForNode`). */
export interface PlatformFontUse { familyName: string; isCustomFont: boolean; glyphCount: number }
export interface HeadingGlyphs { selector: string; family: string; fonts: PlatformFontUse[] }
/** Fallback glyphs at or above this share (and at least {@link GLYPH_FALLBACK_MIN} of them) fail. */
export const GLYPH_FALLBACK_SHARE = 0.2;
export const GLYPH_FALLBACK_MIN = 2;

/**
 * A display heading whose loaded web font lacks the glyphs of its text (Hangul under a Latin-only
 * face) renders them in a platform fallback, although the computed stack resolves to the display
 * family. Measured per heading from the fonts that actually painted its glyphs.
 */
export function glyphFallbackFindings(headings: readonly HeadingGlyphs[], viewport: string): QaFinding[] {
  const byFamily = new Map<string, { items: HeadingGlyphs[]; fallback: Set<string>; glyphs: number; total: number }>();
  for (const heading of headings) {
    const total = heading.fonts.reduce((sum, font) => sum + font.glyphCount, 0);
    const fallbackFonts = heading.fonts.filter((font) => !font.isCustomFont && font.glyphCount > 0);
    const fallback = fallbackFonts.reduce((sum, font) => sum + font.glyphCount, 0);
    if (total === 0 || fallback < GLYPH_FALLBACK_MIN || fallback / total < GLYPH_FALLBACK_SHARE) continue;
    const entry = byFamily.get(heading.family) ?? { items: [], fallback: new Set<string>(), glyphs: 0, total: 0 };
    entry.items.push(heading);
    fallbackFonts.forEach((font) => entry.fallback.add(font.familyName));
    entry.glyphs += fallback;
    entry.total += total;
    byFamily.set(heading.family, entry);
  }
  return [...byFamily].map(([family, entry]) => ({
    check: 'font-drift', severity: 'fail' as const, viewport, selector: entry.items[0].selector,
    detail: `${entry.glyphs} of ${entry.total} glyphs in ${entry.items.length} h1/h2 heading(s) resolved to display font "${family}" render in platform fallback font(s) ${[...entry.fallback].join(', ')}: the loaded face lacks this text's script; load a same-form substitute that covers it first in the stack; e.g. ${entry.items.slice(0, 3).map((item) => item.selector).join(', ')}`,
  }));
}

export function toneDrift(tone: ToneProfile, contract: BuildContract, viewport: string): QaFinding[] {
  const findings: QaFinding[] = [];
  if (tone.darkShare > contract.darkShareMax) findings.push({ check: 'tone-drift', severity: 'fail', viewport, selector: null, detail: `darkShare ${tone.darkShare} exceeds the Build contract dark-share-max ${contract.darkShareMax}` });
  if (tone.fullBleedDarkShare > contract.fullBleedDarkMax) findings.push({ check: 'tone-drift', severity: 'fail', viewport, selector: null, detail: `fullBleedDarkShare ${tone.fullBleedDarkShare} (${tone.darkBandCount} full-bleed dark band(s)) exceeds the Build contract full-bleed-dark-max ${contract.fullBleedDarkMax}` });
  return findings;
}

export interface SignatureCheckResult {
  rank: number;
  selector: string;
  property: string;
  op: SignatureCheck['op'];
  value: string;
  pass: boolean;
  observed: Record<string, string | number | null>;
}

/** Holds when it passes at ≥ 1 viewport that has a visible match; no match anywhere fails. */
export function evaluateSignatureChecks(checks: readonly SignatureCheck[], observations: ReadonlyArray<{ viewport: string; results: readonly SignatureObservation[] }>): SignatureCheckResult[] {
  return checks.map((check, index) => {
    const observed: Record<string, string | number | null> = {};
    let pass = false;
    for (const { viewport, results } of observations) {
      const result = results[index];
      if (!result || result.error || result.count === 0) { observed[viewport] = null; continue; }
      const value = check.property === 'count' ? result.count : result.value ?? '';
      observed[viewport] = value;
      if (evaluateSignatureCheck(check, value)) pass = true;
    }
    return { rank: check.rank, selector: check.selector, property: check.property, op: check.op, value: check.value, pass, observed };
  });
}

export function statusOf(findings: readonly QaFinding[], skipped: readonly QaSkipped[]): QaStatus {
  if (findings.some((finding) => finding.severity === 'fail')) return 'fail';
  if (skipped.some((entry) => entry.affectsStatus)) return 'unverified';
  return 'pass';
}

/** Matches a source CDN host that legitimately serves shared files. */
export const SHARED_ASSET_HOSTS = ['fonts.gstatic.com', 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

export type AssetKind = 'image' | 'font' | 'media' | 'stylesheet' | null;

export function assetKind(contentType: string, file: string): AssetKind {
  const type = contentType.toLowerCase();
  const extension = file.toLowerCase().replace(/[?#].*$/, '').split('.').pop() ?? '';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'].includes(extension)) return 'image';
  if (type.startsWith('font/') || type.includes('font') || ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(extension)) return 'font';
  if (type.startsWith('video/') || type.startsWith('audio/') || ['mp4', 'webm', 'mov', 'mp3', 'ogg', 'wav', 'm4a'].includes(extension)) return 'media';
  if (type.startsWith('text/css') || extension === 'css') return 'stylesheet';
  return null;
}

/** Severity of a byte-identical reference asset in the build. */
export function sourceAssetSeverity(kind: Exclude<AssetKind, null>, originalUrl: string, mode: 'derive' | 'clone-base', contractFonts: readonly string[]): { severity: QaSeverity; note: string } {
  let host = '';
  let pathname = '';
  try {
    const url = new URL(originalUrl);
    host = url.hostname.toLowerCase();
    pathname = decodeURIComponent(url.pathname + url.search).toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof URIError)) throw error;
  }
  if (SHARED_ASSET_HOSTS.includes(host)) {
    if (kind !== 'font') return { severity: 'warn', note: `shared from ${host}` };
    const family = contractFonts.find((name) => pathname.includes(normalizeFontFamily(name).replace(/[^a-z0-9]/g, '')));
    if (family) return { severity: 'warn', note: `shared ${host} font of contract family "${family}"` };
    return { severity: 'fail', note: `${host} font whose family is not in the Build contract fonts` };
  }
  if (kind === 'stylesheet') {
    return mode === 'clone-base'
      ? { severity: 'warn', note: 'reference stylesheet retained; rewrite it or confirm reuse rights before deploying' }
      : { severity: 'fail', note: 'reference stylesheet copied into a derived build' };
  }
  return { severity: 'fail', note: `reference ${kind} copied into the build` };
}
