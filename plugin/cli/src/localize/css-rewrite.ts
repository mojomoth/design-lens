/**
 * Rewrite the asset references inside one stylesheet body (PURE module, no I/O).
 *
 * A clone must localise every `url()` target, every `@import`ed stylesheet, and every
 * `@font-face src` a stylesheet pulls in. Doing this with a regex is unsafe: CSS lets `url()`
 * values carry backslash-escaped parens/spaces and lets `@import` take either a bare string or a
 * `url()` token, optionally trailed by `layer`/`supports`/media queries. So we parse with css-tree,
 * walk the `Url` nodes and `@import` atrule preludes, and let css-tree re-serialise (it re-escapes
 * mutated values correctly — the whole reason for the dependency, per specs/02-clone-engine.md §6).
 *
 * The module is deliberately decoupled from the ResourceStore: the caller passes a `resolve`
 * callback that turns an ABSOLUTE reference URL into the local path to substitute, or returns
 * `null` to leave the reference remote (M1: refs not captured during render stay remote and are
 * recorded in `manifest.remote[]`). References that are never localisable — `data:` payloads and
 * same-document fragments like `url(#gradient)` — are left untouched without ever calling `resolve`.
 *
 * Spec: specs/02-clone-engine.md §6 (Localize) and §urlmap.
 */

import * as csstree from 'css-tree';

/** Which construct a reference came from: an `@import` (another stylesheet, recurse) or a leaf. */
export type CssRefKind = 'import' | 'url';

/** One reference that was localised, in document order. */
export interface CssRef {
  /** The absolute URL the reference resolved to, against the stylesheet's own URL. */
  url: string;
  /** `import` ⇒ points at another stylesheet the pipeline must fetch and rewrite recursively. */
  kind: CssRefKind;
  /** The path substituted into the CSS (exactly what `resolve` returned). */
  localPath: string;
}

/**
 * Decide the local path to substitute for an absolute reference URL, or `null` to leave the
 * reference remote (unchanged). The pipeline supplies this: it consults the ResourceStore,
 * computes the on-disk target via `localize/urlmap`, and relativises it against the owning
 * stylesheet's own local path.
 */
export type CssResolver = (url: string, kind: CssRefKind) => string | null;

/** The rewritten stylesheet text plus every reference that was localised. */
export interface RewriteCssResult {
  css: string;
  refs: CssRef[];
}

/** Parse context: a full stylesheet (default) or the declaration list of an inline `style=""`. */
export interface RewriteCssOptions {
  /** `'declarationList'` parses a bare `prop: url(x)` run (inline `style`); default `'stylesheet'`. */
  context?: 'stylesheet' | 'declarationList';
}

/** A `url()` value that can never be localised: an inline payload or a same-document fragment. */
function isInlineOrFragment(value: string): boolean {
  return /^data:/i.test(value) || value.startsWith('#');
}

/**
 * Rewrite every localisable `url()`/`@import`/`@font-face src` reference in `css`.
 *
 * `baseUrl` is the stylesheet's OWN absolute URL: relative references (`url(../a.png)`,
 * `@import "b.css"`) resolve against it, exactly as a browser would. Unresolvable, `data:`, and
 * fragment references are left byte-for-byte untouched; every other reference is handed to
 * `resolve`, and only a non-null return rewrites it.
 */
export function rewriteCss(
  css: string,
  baseUrl: string,
  resolve: CssResolver,
  options: RewriteCssOptions = {},
): RewriteCssResult {
  const ast = csstree.parse(css, {
    context: options.context ?? 'stylesheet',
    parseCustomProperty: true,
  });
  const refs: CssRef[] = [];

  // Rewrite the target of one Url/String node in place; record it if `resolve` localises it.
  const handleNode = (node: csstree.Url | csstree.StringNode, kind: CssRefKind): void => {
    const raw = node.value;
    if (isInlineOrFragment(raw)) return;

    let absolute: string;
    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      absolute = url.href;
    } catch {
      return; // an unresolvable reference (e.g. malformed) is left exactly as authored
    }

    const localPath = resolve(absolute, kind);
    if (localPath === null) return; // not captured ⇒ stays remote (recorded upstream)

    node.value = localPath;
    refs.push({ url: absolute, kind, localPath });
  };

  csstree.walk(ast, function (node) {
    // `@import` preludes carry the target as either a String (`@import "x"`) or a Url
    // (`@import url(x)`), possibly followed by layer/supports/media tokens we must not touch.
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
      const target = node.prelude?.type === 'AtrulePrelude'
        ? node.prelude.children.toArray().find((c) => c.type === 'Url' || c.type === 'String')
        : undefined;
      if (target) handleNode(target as csstree.Url | csstree.StringNode, 'import');
      // Skip the subtree so the @import's own Url node is not re-processed as a leaf `url()`.
      return this.skip;
    }

    if (node.type === 'Url') {
      handleNode(node, 'url');
    }
    // Only image-set's direct strings are URLs; type("image/avif") and ordinary CSS strings are not.
    if (node.type === 'String' && /^(?:-webkit-)?image-set$/i.test(this.function?.name ?? '')) {
      handleNode(node, 'url');
    }
    return undefined;
  });

  return { css: csstree.generate(ast), refs };
}
