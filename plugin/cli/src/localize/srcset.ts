/**
 * Parse and rewrite the image candidates in an `srcset`/`imagesrcset` attribute (PURE, no I/O).
 *
 * `srcset` looks trivially comma-separated, but it is NOT: a candidate URL may itself contain
 * commas (a `data:` URI, or a CDN path like `.../w_100,h_50/img.png`). Splitting on bare commas —
 * kage's shipped bug (research/kage-clone.md §3/§4) — mangles exactly those URLs. The WHATWG
 * "parse a srcset attribute" algorithm avoids this by collecting the URL as a run of NON-whitespace
 * characters, then reading the (optional) `w`/`x` descriptor after the whitespace; a candidate ends
 * only at a top-level (non-parenthesised) comma. We implement that algorithm, preserving each
 * descriptor verbatim so a localised srcset round-trips byte-for-byte except for the URLs.
 *
 * Like `css-rewrite`, this module is decoupled from the ResourceStore: `rewriteSrcset` takes a
 * `resolve` callback that maps an ABSOLUTE URL to a local path, or returns `null` to leave the
 * candidate remote (an uncaptured/refetch-pending variant stays as authored and is recorded
 * upstream in `manifest.remote[]`). `data:` candidates are never resolved — they are already inline.
 *
 * Spec: specs/02-clone-engine.md §6 (Localize) and §srcset; specs/08-testing.md (unit surface).
 */

/** One image candidate: its URL and the raw descriptor (`''`, `'2x'`, `'640w'`, …). */
export interface SrcsetCandidate {
  /** The candidate URL exactly as authored (may contain commas, e.g. a `data:` URI). */
  url: string;
  /** The descriptor verbatim without surrounding whitespace; empty for a descriptorless candidate. */
  descriptor: string;
}

/** One candidate that `rewriteSrcset` localised, in document order. */
export interface SrcsetRef {
  /** The absolute URL the candidate resolved to, against the owning document's URL. */
  url: string;
  /** The path substituted into the srcset (exactly what `resolve` returned). */
  localPath: string;
}

/**
 * Decide the local path to substitute for an absolute candidate URL, or `null` to leave the
 * candidate remote (unchanged). The pipeline supplies this: it consults the ResourceStore,
 * computes the on-disk target via `localize/urlmap`, and relativises it against the owning page.
 */
export type SrcsetResolver = (url: string) => string | null;

/** The rewritten srcset string plus every candidate that was localised. */
export interface RewriteSrcsetResult {
  srcset: string;
  refs: SrcsetRef[];
}

/** ASCII whitespace per the WHATWG "parse a srcset attribute" algorithm (TAB LF FF CR SPACE). */
function isAsciiWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
}

/** A candidate URL that can never be localised: an inline `data:` payload. */
function isInline(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * Parse an `srcset` value into ordered candidates, tolerant of commas inside URLs.
 *
 * Empty input, or input holding only whitespace/commas, yields `[]`. Descriptors are captured
 * verbatim (minus surrounding whitespace); a candidate whose URL ends in commas is treated as
 * descriptorless (the trailing commas are stripped), matching browser behaviour.
 */
export function parseSrcset(input: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  const len = input.length;
  let pos = 0;

  while (pos < len) {
    // Splitting loop: skip any run of whitespace and separator commas before the next candidate.
    while (pos < len && (isAsciiWhitespace(input[pos]) || input[pos] === ',')) pos++;
    if (pos >= len) break;

    // Collect the URL as a run of non-whitespace characters — commas inside it are kept.
    const urlStart = pos;
    while (pos < len && !isAsciiWhitespace(input[pos])) pos++;
    let url = input.slice(urlStart, pos);
    let descriptor = '';

    if (url.endsWith(',')) {
      // A URL ending in comma(s) closes the candidate here with no descriptor (commas dropped).
      url = url.replace(/,+$/, '');
    } else {
      // Skip whitespace, then read the descriptor up to the next TOP-LEVEL comma or end of input.
      // Parenthesised commas do not terminate the candidate (the algorithm's paren tracking).
      while (pos < len && isAsciiWhitespace(input[pos])) pos++;
      const descStart = pos;
      let inParens = false;
      while (pos < len) {
        const c = input[pos];
        if (inParens) {
          if (c === ')') inParens = false;
        } else if (c === ',') {
          break; // leave `pos` on the comma so the splitting loop consumes it next round
        } else if (c === '(') {
          inParens = true;
        }
        pos++;
      }
      descriptor = input.slice(descStart, pos).trim();
    }

    if (url.length > 0) candidates.push({ url, descriptor });
  }

  return candidates;
}

/** Serialise candidates back to an `srcset` value (`url descriptor`, comma-space separated). */
export function stringifySrcset(candidates: SrcsetCandidate[]): string {
  return candidates
    .map((c) => (c.descriptor.length > 0 ? `${c.url} ${c.descriptor}` : c.url))
    .join(', ');
}

/**
 * Rewrite every localisable candidate URL in `srcset`, preserving descriptors and order.
 *
 * `baseUrl` is the owning document's absolute URL: relative candidate URLs resolve against it.
 * `data:` candidates and any URL `resolve` declines (`null`) or that fails to resolve are left as
 * authored; every other candidate's URL is replaced by `resolve`'s return value.
 */
export function rewriteSrcset(
  srcset: string,
  baseUrl: string,
  resolve: SrcsetResolver,
): RewriteSrcsetResult {
  const refs: SrcsetRef[] = [];

  const rewritten = parseSrcset(srcset).map((candidate) => {
    if (isInline(candidate.url)) return candidate; // inline payload — nothing to localise

    let absolute: string;
    try {
      absolute = new URL(candidate.url, baseUrl).href;
    } catch {
      return candidate; // malformed reference is left exactly as authored
    }

    const localPath = resolve(absolute);
    if (localPath === null) return candidate; // not captured ⇒ stays remote (recorded upstream)

    refs.push({ url: absolute, localPath });
    return { url: localPath, descriptor: candidate.descriptor };
  });

  return { srcset: stringifySrcset(rewritten), refs };
}
