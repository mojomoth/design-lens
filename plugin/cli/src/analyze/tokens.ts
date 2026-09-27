/**
 * Design-token extraction from a clone's captured CSS (PURE, no I/O).
 *
 * `tokens.json` is the quantitative evidence the reverse-design skill cites, so every number here
 * must be reproducible from the CSS alone — same bytes in, same bytes out, no clock, no network.
 *
 * Two parsers, because neither alone answers the whole question:
 *   - `@projectwallace/css-analyzer` runs ONCE over the concatenated CSS (spec 05 mandates the
 *     single `analyze()` call) and owns everything that is a bare value histogram: colors with
 *     their per-property context, font sizes, line heights, border radii, box shadows, animation
 *     durations/easings, `@font-face` descriptors, `@keyframes` names.
 *   - a `css-tree` walk owns the three facts the analyzer does not expose: which SELECTOR a
 *     font-family was declared on (heading vs body usage), the numeric font-weights, and the
 *     spacing values behind `margin*`/`padding*`/`gap`. The analyzer reports that a `font-weight`
 *     property exists and how many times, never which weights — hence the second pass.
 *
 * Spec: specs/05-element-inventory.md §tokens.
 */

import { analyze } from '@projectwallace/css-analyzer';
import * as csstree from 'css-tree';
import { converter, differenceEuclidean, formatHex, parse as parseColor } from 'culori';

/** CSS root font size; `rem`/`em` lengths are resolved against it (spec 05: "16 px root"). */
export const ROOT_FONT_SIZE_PX = 16;

/** Two colors merge when their OKLab Euclidean distance is below this (spec 05). */
export const CLUSTER_DELTA_E = 0.02;

/** A cluster is "neutral" (greyscale-ish) below this OKLCH chroma (spec 05 §palette). */
export const NEUTRAL_MAX_CHROMA = 0.03;

/** `border-radius` at or above either bound means "pill"; both collapse to one sentinel. */
export const RADIUS_PILL_SENTINEL = 9999;
const RADIUS_PILL_MIN_PX = 999;
const RADIUS_PILL_MIN_PERCENT = 50;

const MAX_ACCENTS = 6;
const MAX_SHADOWS = 8;
const MAX_EASINGS = 8;
const MAX_SPACING_STEPS = 12;

/**
 * Colors that parse but carry no design information. `transparent` is the trap: culori happily
 * resolves it to rgba(0,0,0,0), which `formatHex` then flattens to `#000000` — so a single
 * `color: transparent` would otherwise invent a pure-black brand color out of nothing.
 */
const DROPPED_COLOR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit']);

/**
 * Family names that describe a fallback category rather than a typeface. A stack made only of
 * these (`font-family: sans-serif`) contributes no family (spec 05).
 */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

const HEADING_SELECTORS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BODY_SELECTORS = new Set(['html', 'body', 'p']);

/** Where a color was used, normalized from the analyzer's per-property context (spec 05). */
export type ColorRole = 'text' | 'background' | 'border' | 'shadow' | 'fill' | 'other';

/** Canonical role order, so `roles[]` never depends on Object.keys() iteration order. */
const ROLE_ORDER: readonly ColorRole[] = ['text', 'background', 'border', 'shadow', 'fill', 'other'];

export interface ColorCluster {
  /** RGB channels of the representative. Read together with alpha, or use css directly. */
  hex: string;
  alpha: number;
  /** Alpha-preserving CSS color; opaque representatives retain their six-digit hex. */
  css: string;
  /** L whole percent, C 2 decimals, H whole degrees, with explicit alpha when translucent. */
  oklch: string;
  /** Summed occurrences of every cluster member. */
  count: number;
  roles: ColorRole[];
  /** Alpha-preserving member colors, count descending; always starts with css. */
  clusterOf: string[];
}

export interface Palette {
  primaryGuess: string | null;
  neutrals: string[];
  accents: string[];
}

export type FontUsage = 'body' | 'heading' | 'both' | 'unknown';

export interface FontFamilyToken {
  name: string;
  usage: FontUsage;
  /** `src` `url()` paths of matching `@font-face` rules, exactly as written in the localized CSS. */
  faces: string[];
}

export interface TypographyTokens {
  families: FontFamilyToken[];
  sizesPx: number[];
  scaleRatioGuess: number | null;
  weights: number[];
  lineHeights: number[];
}

export interface SpacingTokens {
  base: number | null;
  scalePx: number[];
}

export interface MotionTokens {
  durationsMs: number[];
  easings: string[];
  keyframes: string[];
}

/** The exact `tokens.json` document (spec 05 §Interfaces & contracts). Key order is the schema's. */
export interface Tokens {
  schemaVersion: 2;
  colors: ColorCluster[];
  palette: Palette;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radii: number[];
  shadows: string[];
  motion: MotionTokens;
  provenance: TokenProvenance;
}

export interface TokenSource {
  path: string;
  kind: 'stylesheet' | 'style-block' | 'style-attribute';
  sha256: string;
}

export interface UnresolvedToken {
  selector: string | null;
  property: string;
  value: string;
  reason: string;
}

export interface TokenProvenance {
  kind: 'css-declaration-census';
  source: 'clone';
  rendered: false;
  sources: TokenSource[];
  assumptions: string[];
  unresolved: UnresolvedToken[];
  warnings: string[];
}

export interface TokenExtractionOptions {
  sources?: TokenSource[];
  warnings?: string[];
}

export interface TokenExtraction {
  tokens: Tokens;
  /** CSS syntax errors css-tree recovered from. Surfaced, never swallowed (CONVENTIONS.md). */
  warnings: string[];
}

const toOklch = converter('oklch');
const oklabDistance = differenceEuclidean('oklab');

// ---------------------------------------------------------------------------------------------
// Small value parsers
// ---------------------------------------------------------------------------------------------

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const LENGTH_RE = new RegExp(`^(${NUMBER})(px|rem|em)$`, 'i');
const BARE_ZERO_RE = /^[+-]?0(?:\.0+)?$/;
const PERCENT_RE = new RegExp(`^(${NUMBER})%$`);
const DURATION_RE = new RegExp(`^(${NUMBER})(ms|s)$`, 'i');
const UNITLESS_RE = new RegExp(`^${NUMBER}$`);
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g;

/** A CSS length in px, resolving rem/em at the 16 px root. `%` and keywords are NOT lengths. */
function lengthToPx(raw: string): number | null {
  const trimmed = raw.trim();
  // A bare `0` is a valid length in any unit context (`border-radius: 0`, `margin: 0`).
  if (BARE_ZERO_RE.test(trimmed)) return 0;
  const match = LENGTH_RE.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toLowerCase() === 'px' ? value : value * ROOT_FONT_SIZE_PX;
}

/** A CSS time as integer milliseconds. */
function durationToMs(raw: string): number | null {
  const match = DURATION_RE.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.round(match[2].toLowerCase() === 'ms' ? value : value * 1000);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.length >= 2 && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function ascendingUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Entries of a `{value: count}` histogram, count descending, insertion order breaking ties. */
function byCountDescending(histogram: Record<string, number>): string[] {
  return Object.keys(histogram).sort((a, b) => histogram[b] - histogram[a]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function extractUrls(declaration: string): string[] {
  const urls: string[] = [];
  for (const match of declaration.matchAll(URL_RE)) {
    const url = match[1] ?? match[2] ?? match[3];
    if (url) urls.push(url);
  }
  return urls;
}

// ---------------------------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------------------------

/** Map a declaration property onto the closed role vocabulary (spec 05 §roles). */
export function normalizeRole(property: string): ColorRole {
  const name = property.trim().toLowerCase();
  // Exact match first: `caret-color`/`accent-color` are NOT text color.
  if (name === 'color') return 'text';
  if (name.startsWith('background')) return 'background';
  if (name.startsWith('border') || name.startsWith('outline')) return 'border';
  if (name.endsWith('shadow')) return 'shadow';
  if (name === 'fill' || name === 'stroke') return 'fill';
  return 'other';
}

/** Preserve alpha before normalization; zero-alpha colors cannot be brand candidates. */
function normalizedColor(raw: string): { hex: string; alpha: number; css: string } | null {
  if (DROPPED_COLOR_KEYWORDS.has(raw.trim().toLowerCase())) return null;
  const parsed = parseColor(raw);
  if (!parsed) return null;
  const alpha = Math.min(1, Math.max(0, parsed.alpha ?? 1));
  if (alpha === 0) return null;
  const hex = formatHex(parsed)?.toLowerCase();
  if (!hex) return null;
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const css = alpha === 1 ? hex : `rgb(${channels.join(' ')} / ${alpha})`;
  return { hex, alpha, css };
}

interface ColorOccurrence {
  hex: string;
  alpha: number;
  css: string;
  count: number;
  roles: Set<ColorRole>;
  /** First-appearance index — the deterministic tiebreak when counts are equal. */
  order: number;
}

// `analyze` is overloaded on `useLocations`; ReturnType picks the wrong (locations) overload, so
// pin the shape to the no-options call we actually make.
const analyzeCss = (css: string) => analyze(css);
type Analyzed = ReturnType<typeof analyzeCss>;

function collectColorOccurrences(colors: Analyzed['values']['colors']): ColorOccurrence[] {
  const byHex = new Map<string, ColorOccurrence>();
  const seenRaw = new Set<string>();
  let order = 0;

  const add = (raw: string, count: number, role: ColorRole): void => {
    const color = normalizedColor(raw);
    if (!color) return;
    const existing = byHex.get(color.css);
    if (existing) {
      existing.count += count;
      existing.roles.add(role);
      return;
    }
    byHex.set(color.css, { ...color, count, roles: new Set([role]), order: order++ });
  };

  for (const [property, collection] of Object.entries(colors.itemsPerContext)) {
    const role = normalizeRole(property);
    for (const [raw, count] of Object.entries(collection.unique)) {
      seenRaw.add(raw);
      add(raw, count, role);
    }
  }

  // A color the analyzer counted globally but attributed to no property context would silently
  // vanish from the palette. Fold it in as `other` rather than dropping it on the floor.
  for (const [raw, count] of Object.entries(colors.unique)) {
    if (seenRaw.has(raw)) continue;
    add(raw, count, 'other');
  }

  return [...byHex.values()].sort((a, b) => b.count - a.count || a.order - b.order);
}

interface ScoredCluster extends ColorCluster {
  lightness: number;
  chroma: number;
}

function clusterColors(occurrences: ColorOccurrence[]): ScoredCluster[] {
  // Input is count-descending, so the first member of a cluster is always its highest-count
  // member — which is exactly the representative spec 05 asks for. No second pass needed.
  const clusters: { representative: ColorOccurrence; members: ColorOccurrence[] }[] = [];
  for (const occurrence of occurrences) {
    const home = clusters.find(
      (cluster) => occurrence.alpha === cluster.representative.alpha &&
        oklabDistance(occurrence.hex, cluster.representative.hex) < CLUSTER_DELTA_E,
    );
    if (home) home.members.push(occurrence);
    else clusters.push({ representative: occurrence, members: [occurrence] });
  }

  const scored = clusters.map(({ representative, members }): ScoredCluster => {
    const oklch = toOklch(representative.hex);
    const lightness = oklch?.l ?? 0;
    const chroma = oklch?.c ?? 0;
    // Achromatic colors have an undefined hue in OKLCH (NaN); pin it to 0 so the string is stable.
    const hue = Number.isFinite(oklch?.h) ? Math.round(oklch?.h ?? 0) : 0;
    return {
      hex: representative.hex,
      alpha: representative.alpha,
      css: representative.css,
      oklch: `oklch(${Math.round(lightness * 100)}% ${chroma.toFixed(2)} ${hue}${representative.alpha < 1 ? ` / ${representative.alpha}` : ''})`,
      count: members.reduce((sum, member) => sum + member.count, 0),
      roles: ROLE_ORDER.filter((role) => members.some((member) => member.roles.has(role))),
      clusterOf: members.map((member) => member.css),
      lightness,
      chroma,
    };
  });

  return scored.sort(
    (a, b) => b.lightness - a.lightness || b.count - a.count || a.css.localeCompare(b.css),
  );
}

function buildPalette(clusters: ScoredCluster[]): Palette {
  const neutrals = clusters.filter((cluster) => cluster.chroma < NEUTRAL_MAX_CHROMA);
  // Stable sort by count: equal counts keep the lightness-descending order they arrived in.
  const chromatic = clusters
    .filter((cluster) => cluster.chroma >= NEUTRAL_MAX_CHROMA)
    .map((cluster, index) => ({ cluster, index }))
    .sort((a, b) => b.cluster.count - a.cluster.count || a.index - b.index)
    .map((entry) => entry.cluster);

  return {
    primaryGuess: chromatic[0]?.css ?? null,
    neutrals: neutrals.map((cluster) => cluster.css),
    accents: chromatic.slice(1, 1 + MAX_ACCENTS).map((cluster) => cluster.css),
  };
}

// ---------------------------------------------------------------------------------------------
// The css-tree pass: selector-aware font usage, font weights, spacing values
// ---------------------------------------------------------------------------------------------

interface FamilyUse {
  name: string;
  count: number;
  heading: boolean;
  body: boolean;
  order: number;
}

interface CssTreeFacts {
  families: Map<string, FamilyUse>;
  weights: number[];
  spacingPx: number[];
  warnings: string[];
  assumptions: string[];
  unresolved: UnresolvedToken[];
}

function isSpacingProperty(property: string): boolean {
  return (
    property === 'gap' ||
    property === 'row-gap' ||
    property === 'column-gap' ||
    property === 'margin' ||
    property.startsWith('margin-') ||
    property === 'padding' ||
    property.startsWith('padding-')
  );
}

/** Split a `font-family` value into its comma-separated stack entries, as written. */
function familyStack(value: csstree.CssNode): string[] {
  if (value.type !== 'Value') return [];
  const stack: string[] = [];
  let current: string[] = [];
  let poisoned = false;
  const flush = (): void => {
    if (!poisoned && current.length > 0) stack.push(current.join(' '));
    current = [];
    poisoned = false;
  };
  value.children.forEach((child) => {
    if (child.type === 'Operator' && child.value === ',') {
      flush();
      return;
    }
    // `var(--font)` / `env(...)` name a family we cannot resolve statically — drop that entry
    // rather than emit a family literally called "var(--font)".
    if (child.type === 'Function' || child.type === 'Raw') poisoned = true;
    current.push(csstree.generate(child));
  });
  flush();
  return stack;
}

/** The stack's first real typeface, or null when the stack is generic-only (spec 05). */
export function primaryFamily(value: csstree.CssNode): string | null {
  if (value.type === 'Value') {
    for (const child of value.children.toArray()) {
      if (child.type === 'Operator' && child.value === ',') break;
      // An unresolved first stack entry may replace its fallback; do not report that fallback as chosen.
      if (child.type === 'Function' || child.type === 'Raw') return null;
    }
  }
  for (const entry of familyStack(value)) {
    const name = unquote(entry);
    if (name.length === 0) continue;
    if (GENERIC_FAMILIES.has(name.toLowerCase())) continue;
    return name;
  }
  return null;
}

function selectorTypeNames(rule: csstree.Rule | null): Set<string> {
  const names = new Set<string>();
  if (!rule || rule.prelude.type !== 'SelectorList') return names;
  const visit = (node: csstree.CssNode): void => {
    if (node.type === 'SelectorList') { node.children.forEach(visit); return; }
    if (node.type !== 'Selector') return;
    const children = node.children.toArray();
    const lastCombinator = children.map((child) => child.type).lastIndexOf('Combinator');
    for (const child of children.slice(lastCombinator + 1)) {
      if (child.type === 'TypeSelector') names.add(child.name.toLowerCase());
      else if (child.type === 'PseudoClassSelector' && /^(?:is|where)$/i.test(child.name)) {
        child.children?.forEach(visit);
      }
    }
  };
  visit(rule.prelude);
  return names;
}

function intersects(names: Set<string>, wanted: Set<string>): boolean {
  for (const name of names) if (wanted.has(name)) return true;
  return false;
}

function fontWeightsOf(value: csstree.CssNode): number[] {
  if (value.type !== 'Value') return [];
  return value.children.toArray().flatMap((node) => {
    if (node.type === 'Number') {
      const weight = Number(node.value);
      return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? [weight] : [];
    }
    if (node.type === 'Identifier') {
      if (node.name.toLowerCase() === 'normal') return [400];
      if (node.name.toLowerCase() === 'bold') return [700];
    }
    return [];
  });
}

function lengthsOf(value: csstree.CssNode): number[] {
  if (value.type !== 'Value') return [];
  return value.children.toArray().flatMap((node) => {
    if (node.type !== 'Dimension') return [];
    const px = lengthToPx(`${node.value}${node.unit}`);
    return px === null ? [] : [px];
  });
}

/** Runtime lexer traces are richer than css-tree's published declaration types. */
interface GrammarMatch {
  syntax?: { type: string; name?: string } | null;
  node?: csstree.CssNode;
  match?: GrammarMatch[];
}

function shorthandFont(value: csstree.CssNode): { family: csstree.CssNode; weights: number[] } | null {
  const result = csstree.lexer.matchProperty('font', value) as csstree.LexerMatchResult & { matched?: GrammarMatch | null };
  if (result.error || !result.matched) return null;
  const tokens = (match: GrammarMatch): string => match.node ? csstree.generate(match.node)
    : (match.match ?? []).map(tokens).join(' ');
  const properties = result.matched.match ?? [];
  const families = properties.filter((match) => match.syntax?.type === 'Property' && match.syntax.name === 'font-family');
  if (families.length === 0) return null;
  const weight = properties.find((match) => match.syntax?.type === 'Property' && match.syntax.name === 'font-weight');
  return {
    family: csstree.parse(families.map(tokens).join(','), { context: 'value' }),
    weights: weight ? fontWeightsOf(csstree.parse(tokens(weight), { context: 'value' })) : [400],
  };
}

function walkCss(css: string): CssTreeFacts {
  const warnings: string[] = [];
  const assumptions = new Set<string>();
  const unresolved: UnresolvedToken[] = [];
  const ast = csstree.parse(css, {
    positions: false,
    parseCustomProperty: true,
    // css-tree recovers from a bad rule by parking it in a Raw node. Record what it could not
    // understand instead of pretending the stylesheet was clean.
    onParseError(error: { message: string }) {
      warnings.push(`css parse: ${error.message}`);
    },
  });

  const families = new Map<string, FamilyUse>();
  const weights: number[] = [];
  const spacingPx: number[] = [];

  csstree.walk(ast, {
    visit: 'Declaration',
    enter(node) {
      const property = node.property.trim().toLowerCase();
      const value = csstree.generate(node.value);
      const selector = this.rule ? csstree.generate(this.rule.prelude) : null;
      const reasons = new Set<string>();
      csstree.walk(node.value, (child) => {
        if (child.type === 'Function' && /^(?:var|env|calc|min|max|clamp|color-mix|light-dark)$/i.test(child.name)) {
          reasons.add('function requires rendered measurements or variable resolution');
        }
      });
      const metric = isSpacingProperty(property) || ['font', 'font-size', 'line-height', 'border-radius'].includes(property);
      if (metric && node.value.type === 'Value') {
        for (const child of node.value.children.toArray()) {
          if (child.type === 'Dimension') {
            const unit = child.unit.toLowerCase();
            if (unit === 'em' || unit === 'rem') {
              assumptions.add(`${unit} lengths estimated using ${ROOT_FONT_SIZE_PX}px; actual root/element font size was not measured`);
            } else if (unit !== 'px' && unit !== 'deg') reasons.add('relative or unsupported unit requires rendered measurements');
          } else if (child.type === 'Percentage') reasons.add('percentage requires a rendered reference size');
        }
      }
      if ((property === 'font-size' || property === 'line-height' || property === 'font-weight') &&
        /^(?:normal|larger|smaller|xx-small|x-small|small|medium|large|x-large|x{2,3}-large|bolder|lighter|inherit|initial|unset)$/i.test(value) &&
        !(property === 'font-weight' && value.toLowerCase() === 'normal')) {
        reasons.add('keyword requires inherited or browser-resolved metrics');
      }
      for (const reason of reasons) unresolved.push({ selector, property, value, reason });
      if (property.startsWith('--')) return;

      if (property === 'font-weight') {
        weights.push(...fontWeightsOf(node.value));
        return;
      }

      if (isSpacingProperty(property)) {
        // Only positive lengths are spacing steps: `margin: 0 auto` centers, it does not space.
        spacingPx.push(...lengthsOf(node.value).filter((px) => px > 0));
        return;
      }

      if (property !== 'font-family' && property !== 'font') return;
      // Inside `@font-face`, `font-family` NAMES the face being defined; it is not a usage of it.
      // Counting it would make every declared-but-unused webfont look like a design decision.
      if (this.atrule?.name.toLowerCase() === 'font-face') return;

      const shorthand = property === 'font' ? shorthandFont(node.value) : null;
      if (property === 'font' && shorthand === null) {
        if (reasons.size === 0) unresolved.push({ selector, property, value, reason: 'font shorthand could not be resolved into family and weight' });
        return;
      }
      if (shorthand) weights.push(...shorthand.weights);
      const name = primaryFamily(shorthand?.family ?? node.value);
      if (!name) return;
      const selectors = selectorTypeNames(this.rule);
      const key = name.toLowerCase();
      const existing = families.get(key);
      const use: FamilyUse = existing ?? {
        name,
        count: 0,
        heading: false,
        body: false,
        order: families.size,
      };
      use.count += 1;
      use.heading ||= intersects(selectors, HEADING_SELECTORS);
      use.body ||= intersects(selectors, BODY_SELECTORS);
      families.set(key, use);
    },
  });

  return { families, weights, spacingPx, warnings, assumptions: [...assumptions].sort(), unresolved };
}

// ---------------------------------------------------------------------------------------------
// Typography / spacing / radii / shadows / motion
// ---------------------------------------------------------------------------------------------

function facesFor(familyName: string, fontfaces: Record<string, string>[]): string[] {
  const target = familyName.toLowerCase();
  const faces: string[] = [];
  for (const face of fontfaces) {
    // Descriptor keys arrive lowercased today; normalize so a change upstream cannot silently
    // empty every `faces[]`.
    const descriptors = new Map(
      Object.entries(face).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const declared = descriptors.get('font-family');
    if (!declared || unquote(declared).toLowerCase() !== target) continue;
    faces.push(...extractUrls(descriptors.get('src') ?? ''));
  }
  return [...new Set(faces)];
}

function buildTypography(analyzed: Analyzed, facts: CssTreeFacts): TypographyTokens {
  const uses = [...facts.families.values()].sort((a, b) => b.count - a.count || a.order - b.order);

  const families = uses.map((use): FontFamilyToken => {
    const usage: FontUsage = use.heading && use.body ? 'both' : use.heading ? 'heading' : use.body ? 'body' : 'unknown';
    return { name: use.name, usage, faces: facesFor(use.name, analyzed.atrules.fontface.unique) };
  });

  const sizesPx = ascendingUnique(
    Object.keys(analyzed.values.fontSizes.unique)
      .map(lengthToPx)
      .filter((px): px is number => px !== null && px >= 0)
      .map(Math.round),
  );

  const ratios: number[] = [];
  for (let index = 0; index + 1 < sizesPx.length; index += 1) {
    if (sizesPx[index] > 0) ratios.push(sizesPx[index + 1] / sizesPx[index]);
  }
  const scaleRatioGuess = sizesPx.length >= 3 && ratios.length > 0 ? round2(median(ratios)) : null;

  const lineHeights = ascendingUnique(
    Object.keys(analyzed.values.lineHeights.unique)
      .filter((raw) => UNITLESS_RE.test(raw.trim()))
      .map((raw) => round2(Number(raw))),
  );

  return {
    families,
    sizesPx,
    scaleRatioGuess,
    weights: ascendingUnique(facts.weights),
    lineHeights,
  };
}

function buildSpacing(spacingPx: number[]): SpacingTokens {
  // A grid requires alignment evidence, including for the finer 4px candidate.
  if (spacingPx.length === 0) return { base: null, scalePx: [] };
  const multiplesOfEight = spacingPx.filter((px) => px % 8 === 0).length;
  const multiplesOfFour = spacingPx.filter((px) => px % 4 === 0).length;
  const base = multiplesOfEight >= spacingPx.length / 2 ? 8
    : multiplesOfFour >= spacingPx.length / 2 ? 4 : null;

  const counts = new Map<number, number>();
  for (const px of spacingPx) {
    const snapped = base === null ? px : Math.round(px / base) * base;
    // Hairline-sized values do not establish a reusable spacing step, with or without a grid.
    if (snapped > 1) counts.set(snapped, (counts.get(snapped) ?? 0) + 1);
  }

  const scalePx = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([px]) => px)
    .sort((a, b) => a - b)
    .slice(0, MAX_SPACING_STEPS);

  return { base, scalePx };
}

function buildRadii(analyzed: Analyzed): number[] {
  const radii: number[] = [];
  for (const raw of Object.keys(analyzed.values.borderRadiuses.unique)) {
    // Only complete top-level terms are radii; calc/clamp operands are not resulting lengths.
    const value = csstree.parse(raw, { context: 'value' });
    if (value.type !== 'Value') continue;
    for (const child of value.children.toArray()) {
      if (child.type === 'Function') continue;
      const token = csstree.generate(child);
      const percent = PERCENT_RE.exec(token);
      if (percent) {
        if (Number(percent[1]) >= RADIUS_PILL_MIN_PERCENT) radii.push(RADIUS_PILL_SENTINEL);
        continue;
      }
      const px = lengthToPx(token);
      if (px === null || px < 0) continue;
      radii.push(px >= RADIUS_PILL_MIN_PX ? RADIUS_PILL_SENTINEL : Math.round(px));
    }
  }
  return ascendingUnique(radii);
}

function buildMotion(analyzed: Analyzed): MotionTokens {
  const { durations, timingFunctions } = analyzed.values.animations;
  return {
    durationsMs: ascendingUnique(
      Object.keys(durations.unique)
        .map(durationToMs)
        .filter((ms): ms is number => ms !== null),
    ),
    easings: byCountDescending(timingFunctions.unique).slice(0, MAX_EASINGS),
    keyframes: [...analyzed.atrules.keyframes.defined],
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Extract the `tokens.json` document from one concatenated CSS string.
 *
 * Deterministic: every list is sorted by an explicit key with an explicit tiebreak, so two runs
 * over the same bytes produce byte-identical JSON.
 */
export function extractTokens(css: string, options: TokenExtractionOptions = {}): TokenExtraction {
  const analyzed = analyzeCss(css);
  const facts = walkCss(css);
  const clusters = clusterColors(collectColorOccurrences(analyzed.values.colors));

  const tokens: Tokens = {
    schemaVersion: 2,
    colors: clusters.map(
      ({ hex, alpha, css, oklch, count, roles, clusterOf }): ColorCluster => ({
        hex,
        alpha,
        css,
        oklch,
        count,
        roles,
        clusterOf,
      }),
    ),
    palette: buildPalette(clusters),
    typography: buildTypography(analyzed, facts),
    spacing: buildSpacing(facts.spacingPx),
    radii: buildRadii(analyzed),
    shadows: byCountDescending(analyzed.values.boxShadows.unique).slice(0, MAX_SHADOWS),
    motion: buildMotion(analyzed),
    provenance: {
      kind: 'css-declaration-census', source: 'clone', rendered: false,
      sources: options.sources ?? [], assumptions: facts.assumptions, unresolved: facts.unresolved,
      warnings: [...(options.warnings ?? []), ...facts.warnings],
    },
  };

  return { tokens, warnings: facts.warnings };
}
