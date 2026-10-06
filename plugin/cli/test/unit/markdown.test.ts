import { describe, expect, it } from 'vitest';

import { exactTables, headings, sectionChildren, splitMarkdownRow, tables } from '../../src/analyze/markdown.js';
import { splitMarkdownRow as reexported } from '../../src/analyze/design-validation.js';

const DOC = `# Title
## 5. Typography
Intro
### Typeface forms
| Role | Form |
| --- | --- |
| Display | pixel |

### Other
text
## 6. Color System
### Typeface forms
\`\`\`md
## Not a heading
\`\`\`
`;

describe('markdown helpers', () => {
  // why: scoped table lookups (### inside a ## section) depend on each heading's last body line.
  it('reports 1-based heading and last-body lines, skipping fenced examples', () => {
    const found = headings(DOC);
    expect(found.map((heading) => [heading.level, heading.title, heading.line, heading.end])).toEqual([
      [1, 'Title', 1, 16], [2, '5. Typography', 2, 10], [3, 'Typeface forms', 4, 8], [3, 'Other', 9, 10],
      [2, '6. Color System', 11, 16], [3, 'Typeface forms', 12, 16],
    ]);
  });

  // why: a ### table that sits under the wrong ## section must not satisfy a section-scoped requirement.
  it('finds only the children inside a parent section', () => {
    const found = headings(DOC);
    const typography = found.find((heading) => heading.title === '5. Typography')!;
    expect(sectionChildren(found, typography, 3).map((heading) => heading.line)).toEqual([4, 9]);
  });

  // why: exact-column matching plus file line numbers is what row checks (`<area>:line-N`) report.
  it('matches exact table columns and keeps file line numbers', () => {
    const found = headings(DOC);
    const forms = found.find((heading) => heading.line === 4)!;
    expect(exactTables(forms.body, forms.line, ['Role', 'Form'])).toEqual([{ columns: ['Role', 'Form'], rows: [{ cells: ['Display', 'pixel'], line: 7 }] }]);
    expect(exactTables(forms.body, forms.line, ['Role'])).toEqual([]);
    expect(tables(forms.body, forms.line)).toHaveLength(1);
  });

  // why: design-validation keeps exporting the splitter that external callers already import.
  it('re-exports the row splitter from design-validation unchanged', () => {
    expect(reexported).toBe(splitMarkdownRow);
    expect(splitMarkdownRow('| **A** | `b|c` |')).toEqual(['A', 'b|c']);
  });
});
