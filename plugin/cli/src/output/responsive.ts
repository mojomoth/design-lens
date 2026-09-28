/** Compose immutable viewport captures into one editable, script-free document (ADR-028). */
import fs from 'node:fs/promises';
import path from 'node:path';

import * as cheerio from 'cheerio';
import * as csstree from 'css-tree';

import { resolveEvidencePath, sha256, type SourceCapture } from '../capture/evidence.js';
import { rewriteCss } from '../localize/css-rewrite.js';
import { rewriteDocumentReferences } from '../localize/document-references.js';
import { beautifyHtml } from './beautify.js';
import { manifestJson, resourceEntry, type Manifest, type ManifestResource, type ResponsiveComposition } from './manifest.js';

const LOCAL_ORIGIN = 'https://design-lens.invalid';
const OVERRIDES = 'assets/dl-overrides.css';
type Document = ReturnType<typeof cheerio.load>;
type CapturedResource = { entry: ManifestResource; bytes: Buffer; sourcePath: string; targetPath: string };

export interface ResponsiveRange {
  captureId: string;
  viewport: { width: number; height: number };
  media: string;
}

/** Ties select the larger sample; equal-width groups use the same rule on height. */
export function responsiveRanges(captures: readonly Pick<SourceCapture, 'id' | 'viewport'>[]): ResponsiveRange[] {
  const widths = [...new Set(captures.map((capture) => capture.viewport.width))].sort((a, b) => a - b);
  const interval = (values: number[], index: number, axis: string): string[] => [
    ...(index === 0 ? [] : [`(${axis} >= ${(values[index - 1] + values[index]) / 2}px)`]),
    ...(index === values.length - 1 ? [] : [`(${axis} < ${(values[index] + values[index + 1]) / 2}px)`]),
  ];
  return captures.map((capture) => {
    const heights = captures.filter((other) => other.viewport.width === capture.viewport.width)
      .map((other) => other.viewport.height).sort((a, b) => a - b);
    if (new Set(heights).size !== heights.length) throw new Error('responsive captures contain duplicate viewport dimensions');
    const conditions = [...interval(widths, widths.indexOf(capture.viewport.width), 'width'),
      ...interval(heights, heights.indexOf(capture.viewport.height), 'height')];
    return { captureId: capture.id, viewport: capture.viewport, media: conditions.join(' and ') || 'all' };
  });
}

/** Type aliases retain type specificity; the attribute alias retains :root specificity. */
export function responsiveSelectors(css: string, ids: ReadonlyMap<string, string> = new Map()): string {
  const ast = csstree.parse(css, { parseCustomProperty: true });
  csstree.walk(ast, (node, item, list) => {
    if (node.type === 'TypeSelector') {
      const root = /^(.*\|)?(html|body)$/i.exec(node.name);
      if (root) node.name = (root[1] ?? '') + (root[2].toLowerCase() === 'html' ? 'dl-root' : 'dl-body');
    }
    if (node.type === 'PseudoClassSelector' && node.name.toLowerCase() === 'root' && item && list) {
      const selector = csstree.parse('[data-dl-root]', { context: 'selector' }) as csstree.Selector;
      list.replace(item, list.createItem(selector.children.first!));
    }
    if (node.type === 'PseudoClassSelector' && node.name.toLowerCase() === 'defined' && item && list) {
      const selector = csstree.parse(':is(:defined,dl-root,dl-body)', { context: 'selector' }) as csstree.Selector;
      list.replace(item, list.createItem(selector.children.first!));
    }
    if (node.type === 'AttributeSelector' && node.name.name === 'data-dl-id' && node.value) {
      const value = node.value.type === 'String' ? node.value.value : node.value.name;
      const mapped = ids.get(value);
      if (mapped) {
        if (node.value.type === 'String') node.value.value = mapped;
        else node.value.name = mapped;
      }
    }
  });
  return csstree.generate(ast);
}

/** Preserve conditional ancestry while exposing only font definitions to the document. */
export function fontFaceCss(css: string): string {
  const ast = csstree.parse(css, { parseCustomProperty: true });
  const fonts = (nodes: csstree.List<csstree.CssNode>): string => nodes.toArray().map((node): string => {
    if (node.type !== 'Atrule') return '';
    if (node.name.toLowerCase() === 'font-face') return csstree.generate(node);
    if (!node.block || !['media', 'supports', 'layer', 'container', 'document'].includes(node.name.toLowerCase())) return '';
    const content = fonts(node.block.children);
    return content ? `@${node.name}${node.prelude ? ` ${csstree.generate(node.prelude)}` : ''}{${content}}` : '';
  }).join('');
  return ast.type === 'StyleSheet' ? fonts(ast.children) : '';
}

function localPath(url: string): { file: string; suffix: string } | null {
  const parsed = new URL(url);
  if (parsed.origin !== LOCAL_ORIGIN) return null;
  const file = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (!file.startsWith('assets/') || file.split('/').some((part) => part === '..')) return null;
  return { file, suffix: parsed.search + parsed.hash };
}

function safeDeclarations(values: Record<string, string | undefined>): string {
  return Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([property, value]) => `${property}:${value};`).join('');
}

function attributes($: Document, source: ReturnType<Document>, target: ReturnType<Document>): void {
  const node = source.get(0);
  if (node && 'attribs' in node) for (const [name, value] of Object.entries(node.attribs)) {
    if (name !== 'data-dl-id') target.attr(name, value);
  }
  // Keep this helper's signature independent of cheerio's internal node package.
  void $;
}

/** @import modifiers wrap the imported rules in the same cascade conditions. */
function importConditions(node: csstree.Atrule, content: string, warn: (message: string) => void): string {
  if (node.prelude?.type !== 'AtrulePrelude') { warn('unreadable CSS import conditions'); return content; }
  const rest = node.prelude.children.toArray().slice(1);
  for (const modifier of rest.reverse()) {
    if (modifier.type === 'MediaQueryList') content = `@media ${csstree.generate(modifier)}{${content}}`;
    else if (modifier.type === 'Identifier' && modifier.name === 'layer') content = `@layer{${content}}`;
    else if (modifier.type === 'Function' && modifier.name === 'layer') content = `@layer ${modifier.children.toArray().map((child) => csstree.generate(child)).join('')}{${content}}`;
    else if (modifier.type === 'Function' && modifier.name === 'supports') {
      const condition = modifier.children.toArray().map((child) => csstree.generate(child)).join('');
      content = `@supports (${condition}){${content}}`;
    } else { warn(`unsupported CSS import condition: ${csstree.generate(modifier)}`); }
  }
  return content;
}

function sourceAssetPrefix(snapshot: string): string { return path.posix.dirname(snapshot); }

async function capturedResources(root: string, capture: SourceCapture, manifest: Manifest): Promise<Map<string, CapturedResource>> {
  const prefix = sourceAssetPrefix(capture.snapshot);
  const namespace = sha256(JSON.stringify([capture.id, capture.files])).slice(0, 16);
  const result = new Map<string, CapturedResource>();
  for (const entry of manifest.resources) {
    if (!entry.localPath.startsWith('clone/assets/')) throw new Error(`capture asset is outside clone/assets: ${entry.localPath}`);
    const sourcePath = entry.localPath.slice('clone/'.length);
    const relative = `${prefix}/${sourcePath}`;
    const protectedFile = capture.files.find((file) => file.path === relative);
    if (!protectedFile) throw new Error(`capture asset is not integrity protected: ${relative}`);
    const bytes = await fs.readFile(await resolveEvidencePath(root, relative));
    if (sha256(bytes) !== protectedFile.sha256) throw new Error(`capture asset hash differs: ${relative}`);
    result.set(sourcePath, { entry, bytes, sourcePath, targetPath: `assets/dl-captures/${namespace}/${sourcePath.slice('assets/'.length)}` });
  }
  return result;
}

/** Does not alter any evidence file. Intended only for newly captured multi-viewport projects. */
export async function composeResponsiveClone(
  projectDir: string, captures: readonly SourceCapture[],
): Promise<{ composition: ResponsiveComposition | undefined; warnings: string[] }> {
  if (captures.length < 2) return { composition: undefined, warnings: [] };
  const root = path.resolve(projectDir);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Manifest;
  if (manifest.composition) throw new Error('responsive composition already exists; do not overwrite an edited clone');
  const composition: ResponsiveComposition = { schemaVersion: 1, boundaryPolicy: 'nearest-width-then-height', variants: [], elements: [], warnings: [] };
  const overrides = await fs.readFile(path.join(root, 'clone', OVERRIDES), 'utf8');
  try {
    const overrideAst = csstree.parse(overrides, { parseCustomProperty: true });
    let rootSelector = false;
    csstree.walk(overrideAst, (node) => {
      if ((node.type === 'TypeSelector' && /^(html|body)$/i.test(node.name))
        || (node.type === 'PseudoClassSelector' && node.name.toLowerCase() === 'root')) rootSelector = true;
    });
    if (rootSelector) composition.warnings.push('root selectors in dl-overrides.css do not address generated proxies; target their data-dl-id values');
  } catch { composition.warnings.push('dl-overrides.css could not be parsed; override coverage is unverified'); }
  const available = captures.filter((capture) => capture.snapshot !== '');
  for (const capture of captures.filter((capture) => !capture.snapshot)) composition.warnings.push(`${capture.id}: source snapshot unavailable; no variant was fabricated`);
  if (available.length === 0) return { composition: undefined, warnings: composition.warnings };
  const ranges = responsiveRanges(available);
  const current = await fs.readFile(path.join(root, 'clone/index.html'), 'utf8');
  const provenance = current.split('\n')[0];
  // htmlparser2 keeps template children as normal nodes during construction. parse5's separate
  // template content document silently discards nodes appended through Cheerio's ordinary API.
  const $out = cheerio.load('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>', { xml: { xmlMode: false } });
  $out('head').append($out('<title></title>').text(manifest.source.title));
  const reset = $out('<style data-dl-composition></style>');
  reset.text('html,body{margin:0;padding:0;height:100%;}body{display:block;}dl-variant{display:none!important;}');
  $out('head').append(reset);
  let ordinal = 0;
  const id = (): string => `dl-${++ordinal}`;
  const resources = new Map(manifest.resources.map((entry) => [entry.localPath, entry]));
  const remote = new Map(manifest.remote.map((entry) => [JSON.stringify(entry), entry]));
  const pendingWrites = new Map<string, Buffer>();

  for (const capture of available) {
    const range = ranges.find((candidate) => candidate.captureId === capture.id)!;
    const warnings = new Set<string>();
    const warn = (message: string): void => { warnings.add(`${capture.id}: ${message}`); };
    const snapshotPath = await resolveEvidencePath(root, capture.snapshot);
    const snapshotBytes = await fs.readFile(snapshotPath);
    const recorded = capture.files.find((file) => file.path === capture.snapshot);
    if (!recorded || recorded.sha256 !== sha256(snapshotBytes)) throw new Error(`source snapshot is not integrity protected: ${capture.snapshot}`);
    const sourceManifestPath = `${path.posix.dirname(sourceAssetPrefix(capture.snapshot))}/manifest.json`;
    const sourceManifest = JSON.parse(await fs.readFile(await resolveEvidencePath(root, sourceManifestPath), 'utf8')) as Manifest;
    const assets = await capturedResources(root, capture, sourceManifest);
    for (const entry of sourceManifest.remote) remote.set(JSON.stringify(entry), entry);
    const resolve = (url: string, from = 'index.html'): string | null => {
      const local = localPath(url);
      if (!local) return null;
      if (local.file === OVERRIDES) return from === 'index.html' ? OVERRIDES : path.posix.relative(path.posix.dirname(from), OVERRIDES);
      const asset = assets.get(local.file);
      if (!asset) { warn(`local resource is absent from captured manifest: ${local.file}`); return null; }
      return (from === 'index.html' ? asset.targetPath : path.posix.relative(path.posix.dirname(from), asset.targetPath)) + local.suffix;
    };
    // Copy each capture's tree under a content-qualified namespace. Rewrite URLs in nested files
    // because root-absolute references otherwise escape the capture's namespace.
    for (const asset of assets.values()) {
      let bytes = asset.bytes;
      const base = `${LOCAL_ORIGIN}/${asset.sourcePath}`;
      if (/text\/css/i.test(asset.entry.contentType) || /\.css$/i.test(asset.sourcePath)) {
        bytes = Buffer.from(rewriteCss(bytes.toString('utf8'), base, (url) => resolve(url, asset.targetPath)).css);
      } else if (/^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i.test(asset.entry.contentType)) {
        bytes = Buffer.from(rewriteDocumentReferences(bytes.toString('utf8'), base, (reference) => resolve(reference.url, asset.targetPath),
          { xml: /^image\/svg\+xml/i.test(asset.entry.contentType) }));
      }
      pendingWrites.set(asset.targetPath, bytes);
      const entry = resourceEntry(bytes, { assetPath: asset.targetPath, originalUrl: asset.entry.originalUrl,
        contentType: asset.entry.contentType, via: asset.entry.via });
      resources.set(entry.localPath, entry);
    }
    const $source = cheerio.load(snapshotBytes.toString('utf8'));
    if ($source('dl-root,dl-body,dl-variant').length > 0) warn('source uses reserved composition element names; selector correspondence is unverified');
    const sourceHtml = $source('html').first();
    const sourceBody = $source('body').first();
    const hostId = id();
    const templateId = id();
    const rootId = id();
    const bodyId = id();
    const ids = new Map<string, string>();
    $source('[data-dl-id]').each((_, element) => {
      const original = $source(element).attr('data-dl-id')!;
      if (element === sourceHtml.get(0) || element === sourceBody.get(0)) return;
      const canonical = id();
      if (ids.has(original)) warn(`duplicate source element ID: ${original}`);
      ids.set(original, canonical);
      composition.elements.push({ dlId: canonical, captureId: capture.id, sourceId: original });
      $source(element).attr({ 'data-dl-id': canonical, 'data-dl-source-capture': capture.id, 'data-dl-source-id': original });
    });
    const flatten = (css: string, owner: string, visited: readonly string[] = []): string => {
      if (visited.length > 16) { warn('CSS import depth exceeded'); return ''; }
      let ast: csstree.CssNode;
      try { ast = csstree.parse(css, { parseCustomProperty: true }); }
      catch { warn(`CSS could not be parsed: ${owner}`); return css; }
      if (ast.type !== 'StyleSheet') return css;
      return ast.children.toArray().map((node): string => {
        if (node.type === 'Atrule' && node.name.toLowerCase() === 'charset') return '';
        if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
          const first = node.prelude?.type === 'AtrulePrelude' ? node.prelude.children.first : null;
          if (!first || (first.type !== 'Url' && first.type !== 'String')) { warn(`CSS import could not be parsed: ${owner}`); return csstree.generate(node); }
          const url = new URL(first.value, `${LOCAL_ORIGIN}/${owner}`).href;
          const local = localPath(url);
          const imported = local ? assets.get(local.file) : undefined;
          if (!imported) { warn(`CSS import unavailable: ${first.value}`); return rewriteCss(csstree.generate(node), `${LOCAL_ORIGIN}/${owner}`, (reference) => resolve(reference)).css; }
          if (visited.includes(imported.sourcePath)) { warn(`CSS import cycle: ${imported.sourcePath}`); return ''; }
          return importConditions(node, flatten(imported.bytes.toString('utf8'), imported.sourcePath, [...visited, imported.sourcePath]), warn);
        }
        return rewriteCss(csstree.generate(node), `${LOCAL_ORIGIN}/${owner}`, (url) => resolve(url)).css;
      }).join('\n');
    };
    // Change stylesheet links to equivalent scoped text, preserving their original cascade order.
    $source('link[rel~="stylesheet"],style').each((_, element) => {
      const node = $source(element);
      if (element.tagName === 'link' && node.attr('href') === OVERRIDES) { node.remove(); return; }
      let css = node.text();
      let owner = 'index.html';
      if (element.tagName === 'link') {
        const href = node.attr('href');
        const local = href ? localPath(new URL(href, `${LOCAL_ORIGIN}/index.html`).href) : null;
        const sheet = local ? assets.get(local.file) : undefined;
        if (!sheet) { warn(`stylesheet unavailable: ${href ?? '(missing href)'}`); return; }
        css = sheet.bytes.toString('utf8');
        owner = sheet.sourcePath;
      }
      try {
        const flattened = flatten(css, owner, [owner]);
        const fonts = fontFaceCss(flattened);
        const documentOwned = node.parents('html').length > 0;
        if (fonts && documentOwned) {
          const fontStyle = $out('<style data-dl-composition-fonts></style>').attr('media', range.media);
          const media = node.attr('media');
          fontStyle.text(media ? `@media ${media}{${fonts}}` : fonts);
          $out('head').append(fontStyle);
        }
        const style = $source('<style></style>');
        const media = node.attr('media');
        if (media) style.attr('media', media);
        style.attr('data-dl-captured-styles', owner).text(responsiveSelectors(flattened, ids));
        node.replaceWith(style);
      } catch (error) { warn(`stylesheet transformation failed: ${owner}: ${error instanceof Error ? error.message : String(error)}`); }
    });
    // Source text and inline declarations keep their element identities; resource URLs move only.
    // Protect newly inlined stylesheet text while the resource walker parses the HTML again.
    // CSS strings may legally contain HTML end tags, unlike a source inline style element.
    const styleBodies: string[] = [];
    $source('style').each((index, element) => {
      const style = $source(element);
      styleBodies.push(style.text());
      style.attr('data-dl-composed-style', String(index)).text('');
    });
    const rewritten = rewriteDocumentReferences($source.html(), `${LOCAL_ORIGIN}/index.html`, (reference) => {
      // Already-flattened style rules use canonical URLs, not source-relative URLs.
      const local = localPath(reference.url);
      if (local?.file.startsWith('assets/dl-captures/')) return local.file + local.suffix;
      return resolve(reference.url);
    });
    const $variant = cheerio.load(rewritten);
    $variant('style[data-dl-composed-style]').each((_, element) => {
      const style = $variant(element);
      style.text(styleBodies[Number(style.attr('data-dl-composed-style'))].replace(/<\/style/gi, '<\\/style'));
      style.removeAttr('data-dl-composed-style');
    });
    const host = $out('<dl-variant></dl-variant>').attr({ 'data-dl-id': hostId, 'data-dl-generated': 'host', 'data-dl-source-capture': capture.id });
    const template = $out('<template shadowrootmode="open"></template>').attr('data-dl-id', templateId);
    const logicalRoot = $out('<dl-root data-dl-root></dl-root>');
    const logicalBody = $out('<dl-body></dl-body>');
    attributes($variant, $variant('html').first(), logicalRoot);
    attributes($variant, $variant('body').first(), logicalBody);
    logicalRoot.attr({ 'data-dl-id': rootId, 'data-dl-generated': 'root', 'data-dl-original-tag': 'html', 'data-dl-source-capture': capture.id });
    logicalBody.attr({ 'data-dl-id': bodyId, 'data-dl-generated': 'body', 'data-dl-original-tag': 'body', 'data-dl-source-capture': capture.id });
    // The first anonymous layer substitutes UA defaults without colliding with source layer names.
    // Later authored layers and unlayered rules (including *) must both take precedence.
    const baseStyle = $out('<style data-dl-composition></style>').text('@layer{:where(dl-root){display:block;}:where(dl-body){display:block;margin:8px;}}');
    template.append(baseStyle);
    // Metadata remains in the document; only rules and resource links belong in the shadow tree.
    $variant('head').children('style,link[rel~="stylesheet"]').each((_, element) => { template.append($variant(element).clone()); });
    logicalBody.append($variant('body').html() ?? '');
    logicalRoot.append(logicalBody);
    template.append(logicalRoot);
    template.append($out('<link rel="stylesheet">').attr({ href: OVERRIDES, 'data-dl-id': id() }));
    host.append(template);
    $out('body').append(host);
    const rootStyles = (capture.observations as typeof capture.observations & { rootStyles?: Record<string, string> }).rootStyles;
    const bodyStyles = capture.observations.body?.styles;
    const transparent = (color: string | undefined): boolean => !color || color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
    const canvasStyles = rootStyles && (!transparent(rootStyles.backgroundColor) || (rootStyles.backgroundImage && rootStyles.backgroundImage !== 'none')) ? rootStyles : bodyStyles;
    const scrollStyles = rootStyles?.overflowX === 'visible' && rootStyles?.overflowY === 'visible' ? bodyStyles : rootStyles;
    const bridgeDeclarations = safeDeclarations({ 'font-size': capture.observations.rootFontSize,
      'background-color': canvasStyles?.backgroundColor, 'background-image': canvasStyles?.backgroundImage,
      'background-size': canvasStyles?.backgroundSize, 'background-position': canvasStyles?.backgroundPosition,
      'background-repeat': canvasStyles?.backgroundRepeat, 'background-attachment': canvasStyles?.backgroundAttachment,
      'background-origin': canvasStyles?.backgroundOrigin, 'background-clip': canvasStyles?.backgroundClip,
      'overflow-x': scrollStyles?.overflowX, 'overflow-y': scrollStyles?.overflowY,
      'scrollbar-gutter': rootStyles?.scrollbarGutter, 'scroll-behavior': rootStyles?.scrollBehavior,
      'overscroll-behavior-x': rootStyles?.overscrollBehaviorX, 'overscroll-behavior-y': rootStyles?.overscrollBehaviorY,
      'color-scheme': rootStyles?.colorScheme ?? 'light' });
    const bridge = rewriteCss(bridgeDeclarations, capture.finalUrl, (url) => {
      const direct = resolve(url);
      if (direct) return direct;
      const absolute = new URL(url);
      const asset = [...assets.values()].find((candidate) => {
        const original = new URL(candidate.entry.originalUrl); original.hash = '';
        const requested = new URL(absolute); requested.hash = '';
        return original.href === requested.href;
      });
      if (asset) return asset.targetPath + absolute.hash;
      warn(`document background asset unavailable: ${url}`);
      return null;
    }, { context: 'declarationList' }).css;
    if (!rootStyles) warn('source root styles unavailable; document background and scroll bridge are approximate');
    if (canvasStyles?.backgroundImage && canvasStyles.backgroundImage !== 'none') warn('document background image coordinates across generated roots are approximate');
    const selection = $out('<style data-dl-composition></style>').attr('media', range.media);
    selection.text(`html{${bridge}}dl-variant[data-dl-id="${hostId}"]{display:contents!important;}`);
    $out('head').append(selection);
    composition.variants.push({ ...range, hostId, rootId, bodyId });
    composition.warnings.push(...warnings);
  }
  $out('head').append($out('<link rel="stylesheet">').attr('href', OVERRIDES));
  // External CSS can contain an HTML end tag inside a valid CSS string. Escaping the slash keeps
  // that string's CSS value while preventing inlined rules from terminating their style element.
  $out('style').each((_, element) => {
    const style = $out(element);
    style.text(style.text().replace(/<\/style/gi, '<\\/style'));
  });
  for (const [relative, bytes] of pendingWrites) {
    const file = path.join(root, 'clone', relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: 'wx' });
  }
  manifest.composition = composition;
  manifest.resources = [...resources.values()];
  manifest.remote = [...remote.values()];
  manifest.stats = { ...manifest.stats, elementsStamped: ordinal,
    fonts: manifest.resources.filter((entry) => /^font\//i.test(entry.contentType) || /\.(woff2?|ttf|otf|eot)$/i.test(entry.localPath)).length,
    images: manifest.resources.filter((entry) => /^image\//i.test(entry.contentType)).length,
    cssFiles: manifest.resources.filter((entry) => /text\/css/i.test(entry.contentType) || /\.css$/i.test(entry.localPath)).length,
    warnings: manifest.stats.warnings + composition.warnings.length };
  await fs.writeFile(path.join(root, 'clone/index.html'), `${provenance}\n${beautifyHtml($out.html())}\n`);
  await fs.writeFile(manifestPath, manifestJson(manifest));
  return { composition, warnings: composition.warnings };
}
