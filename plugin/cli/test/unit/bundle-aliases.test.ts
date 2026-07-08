import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const CHEERIO_ALIAS_TARGET = 'cheerio/dist/esm/load-parse.js';

function sourceFiles(): string[] {
  return fs
    .readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => path.join(SRC, entry));
}

/**
 * These tests defend an invariant that lives in `tsup.config.ts`, not in any source file — the kind
 * that no typechecker can see and that only breaks in the SHIPPED bundle.
 *
 * `tsup.config.ts` aliases the whole `cheerio` package to `dist/esm/load-parse.js` because
 * cheerio's real entry point drags in undici (512 KB) and iconv-lite (491 KB) for `fromURL`/
 * `loadBuffer` — a full HTTP client and every legacy text codec, in a CLI that only ever calls
 * `cheerio.load` on strings it already holds. esbuild cannot tree-shake them (undici has
 * import-time side effects), so that was 1.0 MB of the hard 2 MB `dist/design-lens.cjs` budget
 * (repo-hygiene gate B2c) spent on dead code.
 *
 * The catch: `load-parse.js` exports ONLY `load`. Unit tests import the real cheerio package and
 * would never notice a second export creeping in; typecheck resolves against cheerio's own types
 * and would not notice either. The failure would surface as `cheerio.loadBuffer is not a function`,
 * at run time, in the bundle, on whichever code path a user happened to take.
 */
describe('bundle aliases (tsup.config.ts)', () => {
  // why: if any src file starts using a second cheerio export, the aliased bundle breaks at run
  // time while every other check stays green. Delete this test and that regression ships.
  it('uses no cheerio export other than `load`', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bcheerio\.([A-Za-z_$][\w$]*)/g)) {
        if (match[1] !== 'load') offenders.push(`${path.basename(file)}: cheerio.${match[1]}`);
      }
      for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]cheerio['"]/g)) {
        for (const name of match[1].split(',')) {
          const imported = name.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
          if (imported.length > 0 && imported !== 'load') {
            offenders.push(`${path.basename(file)}: import { ${imported} }`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // why: a cheerio upgrade that relocates `dist/esm/load-parse.js` would make tsup alias `cheerio`
  // to a missing file. Catching that here costs milliseconds; catching it in the e2e costs a full
  // browser run, and catching it after release costs a broken plugin.
  it('resolves the aliased cheerio module and finds `load` on it', async () => {
    const require = createRequire(import.meta.url);
    const target = path.join(path.dirname(require.resolve('cheerio/package.json')), 'dist/esm/load-parse.js');
    expect(fs.existsSync(target), `tsup aliases cheerio to ${CHEERIO_ALIAS_TARGET}`).toBe(true);

    const aliased: unknown = await import(target);
    expect(typeof (aliased as { load?: unknown }).load).toBe('function');
  });
});
