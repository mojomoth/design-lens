/** Selector-preserving support for the detached paragraph aliases emitted by the serializer. */
import * as csstree from 'css-tree';
import * as cheerio from 'cheerio';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export function isParagraphAlias(value: string | undefined): value is string {
  return value !== undefined && /^dl-static-p(?:-[2-9]\d*|-1\d+)?$/.test(value);
}

/** Rewrite full stylesheets only; declaration lists contain no selectors and need no conversion. */
export function normalizeParagraphSelectors(css: string, alias: string): string {
  if (!isParagraphAlias(alias)) throw new Error(`invalid paragraph alias: ${alias}`);
  const errors: string[] = [];
  const ast = csstree.parse(css, { onParseError: (error) => { errors.push(error.message); } });
  if (errors.length) throw new Error(`paragraph selector parsing failed: ${errors.join('; ')}`);
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
  const selectorNode = (selector: string): csstree.CssNode => {
    const parsed = csstree.parse(selector, { context: 'selector' });
    if (parsed.type !== 'Selector' || !parsed.children.first) throw new Error('paragraph selector could not be constructed');
    return parsed.children.first;
  };
  csstree.walk(ast, function (node, item) {
    if (node.type === 'PseudoClassSelector') {
      // Repeated localization/composition must not wrap a previously generated selector again.
      const generated = csstree.generate(node);
      if ([defined, anyParagraph, wildcardParagraph].includes(generated)) return this.skip;
      if (node.name.toLowerCase() === 'defined' && item) {
        item.data = selectorNode(defined);
        return this.skip;
      }
    }
    if (node.type !== 'TypeSelector' || !item) return undefined;
    const split = node.name.lastIndexOf('|');
    const prefix = split < 0 ? undefined : node.name.slice(0, split);
    const name = split < 0 ? node.name : node.name.slice(split + 1);
    if (name.toLowerCase() !== 'p') return undefined;
    if (prefix === '*') item.data = selectorNode(wildcardParagraph);
    else if (prefix === undefined && !namespaces.has('')) item.data = selectorNode(anyParagraph);
    else if (namespaces.get(prefix ?? '') === HTML_NAMESPACE) node.name = prefix ? `${prefix}|${alias}` : alias;
    return this.skip;
  });
  return csstree.generate(ast);
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
      $(element).text(normalizeParagraphSelectors($(element).text(), alias));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  });
  return { html: $.html(), warnings };
}
