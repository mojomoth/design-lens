/**
 * Pretty-print the clone's HTML and CSS with js-beautify (PURE, no I/O).
 *
 * Pretty-printing is a HARD requirement, not cosmetics: the customize-clone skill edits the clone by
 * grepping for a `data-dl-id` and rewriting the stable line window around it, so the output must be
 * deterministically indented one-element-per-line (specs/02-clone-engine.md §7). js-beautify is
 * chosen over prettier because it tolerates the noncompliant markup a DOM serializer emits.
 *
 * `<pre>`, `<textarea>` and `<code>` are declared unformatted so their whitespace-significant
 * content survives byte-for-byte — reindenting a `<pre>` would corrupt captured code samples.
 *
 * Spec: specs/02-clone-engine.md §7 (Beautify); specs/03-clone-format.md §Directory tree.
 */

import * as beautify from 'js-beautify';

/** html-beautify options: 2-space indent, no line wrapping, content of `<pre>/<textarea>/<code>` kept verbatim. */
const HTML_OPTIONS: beautify.HTMLBeautifyOptions = {
  indent_size: 2,
  wrap_line_length: 0,
  preserve_newlines: true,
  unformatted: ['pre', 'textarea', 'code'],
  content_unformatted: ['pre', 'textarea'],
  end_with_newline: false,
};

/** css-beautify options: 2-space indent (localized stylesheets are agent-editable too). */
const CSS_OPTIONS: beautify.CSSBeautifyOptions = {
  indent_size: 2,
  end_with_newline: false,
};

/** Pretty-print a full HTML document. `<pre>`/`<textarea>`/`<code>` content is preserved exactly. */
export function beautifyHtml(html: string): string {
  return beautify.html(html, HTML_OPTIONS);
}

/** Pretty-print a stylesheet body (used for every localized `.css` asset). */
export function beautifyCss(css: string): string {
  return beautify.css(css, CSS_OPTIONS);
}
