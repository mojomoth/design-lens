/** Selector-preserving support for the detached paragraph aliases emitted by the serializer. */
import * as csstree from 'css-tree';
import * as cheerio from 'cheerio';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export function isParagraphAlias(value: string | undefined): value is string {
  return value !== undefined && /^dl-static-p(?:-[2-9]\d*|-1\d+)?$/.test(value);
}

/**
 * Rewrite only parsed selector ranges, preserving every other source byte. Supplying warnings
 * permits safe partial conversion when another selector cannot be parsed; strict callers throw.
 */
export function normalizeParagraphSelectors(css: string, alias: string, warnings?: string[]): string {
  if (!isParagraphAlias(alias)) throw new Error(`invalid paragraph alias: ${alias}`);
  const errors: string[] = [];
  // Declaration values do not contain matching selectors. New browser syntax and vendor values
  // must remain opaque rather than preventing unrelated paragraph rules from being preserved.
  const ast = csstree.parse(css, { parseValue: false, positions: true,
    onParseError: (error) => { errors.push(error.message); } });
  const namespaces = new Map<string, string>();
  csstree.walk(ast, (node) => {
    if (node.type !== 'Atrule' || node.name.toLowerCase() !== 'namespace' || node.prelude?.type !== 'AtrulePrelude') return;
    const children = node.prelude.children.toArray();
    const name = children.find((child) => child.type === 'Identifier');
    const url = children.find((child) => child.type === 'Url' || child.type === 'String');
    if (url?.type === 'Url' || url?.type === 'String') namespaces.set(name?.type === 'Identifier' ? name.name : '', url.value);
  });
  const defined = `:is(:defined,:where(*|${alias}))`;
  const anyParagraph = `:is(p,*|${alias})`;
  const wildcardParagraph = `:is(*|p,*|${alias})`;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const replace = (node: csstree.CssNode, text: string): void => {
    if (!node.loc) throw new Error('paragraph selector location is unavailable');
    replacements.push({ start: node.loc.start.offset, end: node.loc.end.offset, text });
  };
  csstree.walk(ast, function (node) {
    if (node.type === 'PseudoClassSelector') {
      // Repeated localization/composition must not wrap a previously generated selector again.
      const generated = csstree.generate(node);
      if ([defined, anyParagraph, wildcardParagraph].includes(generated)) return this.skip;
      if (node.name.toLowerCase() === 'defined') {
        replace(node, defined);
        return this.skip;
      }
    }
    if (node.type !== 'TypeSelector') return undefined;
    const split = node.name.lastIndexOf('|');
    const prefix = split < 0 ? undefined : node.name.slice(0, split);
    const name = split < 0 ? node.name : node.name.slice(split + 1);
    if (name.toLowerCase() !== 'p') return undefined;
    if (prefix === '*') replace(node, wildcardParagraph);
    else if (prefix === undefined && !namespaces.has('')) replace(node, anyParagraph);
    else if (namespaces.get(prefix ?? '') === HTML_NAMESPACE) replace(node, prefix ? `${prefix}|${alias}` : alias);
    return this.skip;
  });
  if (errors.length) {
    const warning = `paragraph selector parsing failed: ${[...new Set(errors)].join('; ')}`;
    if (!warnings) throw new Error(warning);
    warnings.push(warning);
  }
  let normalized = css;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    normalized = normalized.slice(0, replacement.start) + replacement.text + normalized.slice(replacement.end);
  }
  return normalized;
}

/** Inline/adopted sheets are available immediately after Percy restoration, before localization. */
export function normalizeParagraphStyles(html: string): { html: string; warnings: string[] } {
  const $ = cheerio.load(html);
  const alias = $('html').attr('data-dl-paragraph-alias');
  if (!isParagraphAlias(alias)) return { html, warnings: [] };
  const warnings: string[] = [];
  $('style').each((_, element) => {
    if ($(element).attr('data-dl-paragraph-defaults')) return;
    try {
      $(element).text(normalizeParagraphSelectors($(element).text(), alias, warnings));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  });
  return { html: $.html(), warnings };
}
