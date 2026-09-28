/**
 * Sanitize a serialized page into an inert clone ("a photograph, not a program", ADR-001).
 *
 * The serializer hands us the live DOM's `outerHTML` with CSSOM rules folded in; that markup still
 * carries every executable and network-active hook the browser had. This pass strips all of them so
 * the written clone can NEVER run script or beacon out: `<script>` elements, `on*` event handlers,
 * `javascript:` URLs, `<meta http-equiv="refresh">` redirects, dead resource hints (preconnect /
 * dns-prefetch / modulepreload / script preload+prefetch), `<noscript>`, and IE conditional
 * comments (a classic script-smuggling channel — the smuggled `<script>` lives INSIDE a comment
 * node, so element removal alone misses it). It also guarantees a `<meta charset="utf-8">`.
 *
 * This is kage's shipped, verified sanitize list (research/kage-clone.md §2). Localization of the
 * surviving references (src/href/url()) is a SEPARATE pass (`localize/{urlmap,css-rewrite,srcset}`);
 * the provenance comment and beautification are added later by the writer (specs/02 §5–§8).
 *
 * Spec: specs/02-clone-engine.md §5 (Sanitize); inert-output contract in specs/03-clone-format.md.
 */

import * as cheerio from 'cheerio';

/** `rel` tokens whose whole purpose is a network/JS hint the inert clone must not carry. */
const DEAD_REL_TOKENS = new Set(['preconnect', 'dns-prefetch', 'modulepreload']);

/**
 * True when a URL attribute value resolves to the `javascript:` scheme. Browsers ignore ASCII
 * tab/newline/CR/FF ANYWHERE in the scheme and leading whitespace, so a value like
 * `"java\tscript:alert(1)"` still executes — we must detect it the same way, or the smuggled
 * scheme survives sanitization.
 */
function isJavascriptUrl(value: string): boolean {
  return value.replace(/[\t\n\r\f]/g, '').trimStart().toLowerCase().startsWith('javascript:');
}

/**
 * True for a comment that is (or reveals) an IE conditional comment. Both the downlevel-HIDDEN form
 * (`<!--[if IE]>…<![endif]-->`, one comment node whose data holds `[if …]…<![endif]`) and the
 * downlevel-REVEALED form (`<![if IE]>` / `<![endif]>`, each parsed by HTML5 as a bogus comment)
 * are matched.
 */
function isIeConditionalComment(data: string): boolean {
  return /\[\s*(?:if[\s(!]|endif\s*\])/i.test(data);
}

/**
 * Return `html` sanitized to an inert, network-passive document. Pure: parses, mutates a detached
 * DOM, and re-serializes — no I/O, no live-web access.
 */
export function sanitizeHtml(html: string, options: { xml?: boolean; depth?: number } = {}): string {
  const depth = options.depth ?? 0;
  if (depth > 16) throw new Error('embedded document depth exceeds 16');
  const $ = cheerio.load(html, options.xml ? { xml: true } : undefined);

  // 1. All <script> elements (inline + external) and their contents.
  $('script').remove();

  // 2. <noscript> entirely — its contents are a JS-disabled fallback we neither run nor need.
  $('noscript').remove();

  // 3. Per-element attribute scrub: drop every `on*` handler and neutralize `javascript:` URLs.
  $('*').each((_, el) => {
    // The universal selector widens to AnyNode; only tag-like nodes carry `attribs`.
    if (!('attribs' in el)) return;
    // Snapshot names first: we mutate `attribs` inside the loop.
    for (const name of Object.keys(el.attribs)) {
      const value = el.attribs[name];
      if (name.toLowerCase() === 'integrity') {
        $(el).removeAttr(name);
        continue;
      }
      if (/^on/i.test(name)) {
        $(el).removeAttr(name);
        continue;
      }
      if (isJavascriptUrl(value)) {
        // `href` degrades to an inert `#` anchor (keeps the element clickable-but-dead);
        // any other attribute carrying the scheme (src, action, formaction, …) is dropped.
        if (name.toLowerCase() === 'href') $(el).attr(name, '#');
        else $(el).removeAttr(name);
      }
    }
  });

  // srcdoc is a separate document: outer-DOM script removal cannot inspect its escaped markup.
  $('iframe[srcdoc]').each((_, el) => {
    $(el).attr('srcdoc', sanitizeHtml(el.attribs.srcdoc, { depth: depth + 1 }));
  });

  // 4. <meta http-equiv="refresh"> — a scriptless redirect that would pull the clone off-page.
  $('meta').each((_, el) => {
    const httpEquiv = el.attribs['http-equiv'];
    if (httpEquiv && ['refresh', 'content-security-policy', 'content-security-policy-report-only']
      .includes(httpEquiv.trim().toLowerCase())) $(el).remove();
  });

  // 5. Dead resource hints: preconnect/dns-prefetch/modulepreload always, and preload/prefetch
  //    only when they target a script (`as="script"`) — a style/font preload references an asset
  //    we DO localize, so it stays.
  $('link').each((_, el) => {
    const rel = (el.attribs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const as = (el.attribs.as ?? '').trim().toLowerCase();
    const isDeadHint = rel.some((token) => DEAD_REL_TOKENS.has(token));
    const isScriptHint = (rel.includes('preload') || rel.includes('prefetch')) && as === 'script';
    if (isDeadHint || isScriptHint) $(el).remove();
  });

  // 6. IE conditional comments — remove only these (a script-smuggling channel), never ordinary
  //    comments (the writer's provenance comment must survive).
  // Gathering every element's contents at once repeatedly concatenates the growing child list.
  // Walk each child once instead, including the document fragments inside native templates.
  const pending = $.root().contents().toArray();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'comment' && isIeConditionalComment(node.data)) $(node).remove();
    else if ('children' in node) for (const child of node.children) pending.push(child);
  }

  // 7. Guarantee a charset declaration so the written UTF-8 bytes render correctly.
  if (!options.xml && $('meta[charset]').length === 0) {
    const meta = '<meta charset="utf-8">';
    if ($('head').length) $('head').prepend(meta);
    else if ($('html').length) $('html').prepend(meta);
    else $.root().prepend(meta);
  }

  return $.html();
}
