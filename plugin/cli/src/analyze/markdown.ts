export interface MarkdownHeading {
  level: number;
  title: string;
  /** 1-based line of the heading itself. */
  line: number;
  /** 1-based last body line; equals `line` when the body is empty. */
  end: number;
  /** Lines after the heading up to the next heading of the same or a higher level (nested subsections included). */
  body: string;
}
export interface MarkdownTable { columns: string[]; rows: Array<{ cells: string[]; line: number }> }

function unformat(value: string): string {
  const trimmed = value.trim();
  const code = /^(`+)([\s\S]*?)\1$/.exec(trimmed);
  if (code) return code[2].trim();
  return trimmed.replace(/^\*\*([\s\S]*)\*\*$/, '$1');
}

/** Pipes inside code spans or escaped cells belong to the value, not the table structure. */
export function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && index + 1 < line.length && /[|\\]/.test(line[index + 1])) {
      cell += line[index + 1]; index += 1;
    } else if (character === '`') {
      let count = 1;
      while (line[index + count] === '`') count += 1;
      if (codeTicks === 0) codeTicks = count;
      else if (codeTicks === count) codeTicks = 0;
      cell += '`'.repeat(count); index += count - 1;
    } else if (character === '|' && codeTicks === 0) {
      cells.push(unformat(cell)); cell = '';
    } else cell += character;
  }
  cells.push(unformat(cell));
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** ATX headings only; headings inside fenced code blocks are examples, not structure. */
export function headings(markdown: string): MarkdownHeading[] {
  const lines = markdown.split(/\r?\n/);
  const found: Array<Omit<MarkdownHeading, 'body' | 'end'>> = [];
  let fence: { marker: string; count: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], count: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.count) fence = null;
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (match) found.push({ level: match[1].length, title: match[2], line: index + 1 });
  }
  return found.map((heading, index) => {
    const next = found.slice(index + 1).find((candidate) => candidate.level <= heading.level)?.line ?? lines.length + 1;
    return { ...heading, end: Math.max(heading.line, next - 1), body: lines.slice(heading.line, next - 1).join('\n') };
  });
}

/** Row lines are file lines when `lineOffset` is the line of the heading that owns `body`. */
export function tables(body: string, lineOffset: number): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const result: MarkdownTable[] = [];
  let fence: { marker: string; count: number } | null = null;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], count: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.count) fence = null;
      continue;
    }
    if (fence || !lines[index].includes('|')) continue;
    const columns = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (columns.length < 2 || separator.length !== columns.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const rows: MarkdownTable['rows'] = [];
    index += 2;
    while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
      rows.push({ cells: splitMarkdownRow(lines[index]), line: lineOffset + index + 1 });
      index += 1;
    }
    index -= 1;
    result.push({ columns, rows });
  }
  return result;
}

/** Headings of `level` that lie inside `parent`'s body. */
export function sectionChildren(all: readonly MarkdownHeading[], parent: MarkdownHeading, level: number): MarkdownHeading[] {
  return all.filter((heading) => heading.level === level && heading.line > parent.line && heading.line <= parent.end);
}

/** Tables whose header equals `columns` exactly, in order. */
export function exactTables(body: string, lineOffset: number, columns: readonly string[]): MarkdownTable[] {
  return tables(body, lineOffset).filter((table) => table.columns.length === columns.length
    && table.columns.every((column, index) => column === columns[index]));
}
