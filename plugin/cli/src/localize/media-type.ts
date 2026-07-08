/**
 * Classify a captured resource as CSS / font / image (PURE, no I/O).
 *
 * Four call sites need the same answer and must never disagree:
 *   - `localize.ts` decides whether to rewrite a body recursively (CSS) or store it verbatim, and
 *     rolls up `stats.{fonts,images,cssFiles}` for the manifest;
 *   - `fetch-missing.ts` decides whether a CSS-discovered reference is itself a stylesheet worth
 *     descending into for more references;
 *   - `clone.ts` decides which bodies to beautify before hashing, and builds the REPORT capture
 *     table rows (images / fonts / css / other).
 * These lived as three near-identical private predicate trios before; a drift between them would
 * silently mean "beautified but counted as a font", or a stylesheet whose `url()`s are never
 * discovered. One definition, imported everywhere.
 *
 * Each predicate takes the `content-type` header (which may carry a `; charset=…` parameter, and
 * which servers routinely get wrong or omit) AND a path-ish string — a local `assets/…` path or a
 * URL pathname. Either witness is sufficient: a font served as `application/octet-stream` is still
 * a font if it ends in `.woff2`, and a stylesheet at an extensionless URL is still a stylesheet if
 * the server said `text/css`.
 *
 * Spec: specs/02-clone-engine.md §6 (Localize); specs/03-clone-format.md §manifest.json (`stats`).
 */

/** Does this resource hold CSS text (⇒ rewrite its references recursively, never store verbatim)? */
export function isCssResource(contentType: string, pathname: string): boolean {
  return /text\/css/i.test(contentType) || pathname.endsWith('.css');
}

/** Does this resource hold a webfont face (⇒ `stats.fonts`, REPORT "fonts" row)? */
export function isFontResource(contentType: string, pathname: string): boolean {
  return /^font\//i.test(contentType) || /\.(?:woff2?|ttf|otf|eot)$/i.test(pathname);
}

/** Does this resource hold a raster/vector image (⇒ `stats.images`, REPORT "images" row)? */
export function isImageResource(contentType: string, pathname: string): boolean {
  return (
    /^image\//i.test(contentType) || /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp)$/i.test(pathname)
  );
}
