import { describe, expect, it } from 'vitest';

import { evaluateSignatureCheck, normalizeFontFamily, parseBuildContract, parseSignatureCheck } from '../../src/analyze/build-contract.js';
import { CONTRACT_ROWS, variations } from '../fixtures/design-validation-fixture.js';

describe('build contract parser', () => {
  // why: qa and validate-design both consume this exact parsed shape.
  it('parses the fixture contract', () => {
    const parsed = parseBuildContract(variations());
    expect(parsed.problems).toEqual([]);
    expect(parsed.contract).toMatchObject({
      mode: 'derive', fonts: ['Inter', 'Roboto'], displayFonts: ['Inter'], darkShareMax: 0.1, fullBleedDarkMax: 0.02, stylesheets: 'rewritten',
    });
    expect(parsed.checks.map((check) => [check.rank, check.selector, check.property, check.op, check.value])).toEqual([
      [2, 'h1', 'font-family', '~', 'Inter'], [3, '.title-frame::before', 'count', '>=', '1'],
    ]);
    expect(parsed.contract!.sources['dark-share-max']).toContain('tone.json');
  });

  // why: a self-declared contract with unknown keys, duplicates or invalid values must not be silently accepted.
  it.each([
    ['missing table', variations(undefined, { contract: [] }).replace('### Build contract', '### Contract'), 'exactly one ### Build contract'],
    ['unknown key', variations(undefined, { contract: [...CONTRACT_ROWS, '| palette | dark | - |'] }), 'unknown build contract key palette'],
    ['duplicate key', variations(undefined, { contract: [...CONTRACT_ROWS, '| mode | derive | again |'] }), 'appears more than once'],
    ['display not in fonts', variations(undefined, { contract: CONTRACT_ROWS.map((row) => row.replace('| display-fonts | Inter |', '| display-fonts | Space Grotesk |')) }), 'subset of fonts'],
    ['share out of range', variations(undefined, { contract: CONTRACT_ROWS.map((row) => row.replace('| 0.1 |', '| 1.5 |')) }), 'dark-share-max must be a number in [0, 1]'],
    ['clone-base without stylesheets', variations(undefined, { contract: CONTRACT_ROWS.map((row) => row.replace('| derive |', '| clone-base |')) }), 'requires stylesheets'],
    ['missing required key', variations(undefined, { contract: CONTRACT_ROWS.filter((row) => !row.startsWith('| fonts')) }), 'requires fonts'],
    ['malformed check', variations(undefined, { contract: [...CONTRACT_ROWS, '| check:1 | h1 font-family = Inter | x |'] }), '<selector> :: <property> <op> <value>'],
  ])('reports %s', (_, markdown, problem) => {
    const parsed = parseBuildContract(markdown);
    expect(parsed.contract).toBeNull();
    expect(parsed.problems.join('\n')).toContain(problem);
  });

  // why: operators are matched longest-first so ">=" is never read as "=" with a ">" value.
  it('parses operators longest-first and validates selectors and numeric values', () => {
    expect(parseSignatureCheck(1, '.btn :: border-radius >= 4px', 9)).toMatchObject({ property: 'border-radius', op: '>=', value: '4px', line: 9 });
    expect(parseSignatureCheck(1, '.btn :: color != rgb(0, 0, 0)', 9)).toMatchObject({ op: '!=', value: 'rgb(0, 0, 0)' });
    expect(parseSignatureCheck(1, 'a[ :: color = red', 9)).toContain('valid CSS selector');
    expect(parseSignatureCheck(1, '.x :: width >= wide', 9)).toContain('requires a number');
    expect(parseSignatureCheck(1, '.x :: count ~ 3', 9)).toContain('count checks');
  });

  // why: qa evaluates every check row with these semantics; font names compare case- and quote-insensitively.
  it('evaluates checks and normalizes font families', () => {
    expect(evaluateSignatureCheck({ property: 'font-family', op: '~', value: 'inter' }, '"Inter", sans-serif')).toBe(true);
    expect(evaluateSignatureCheck({ property: 'font-family', op: '!~', value: 'Arial' }, 'Inter')).toBe(true);
    expect(evaluateSignatureCheck({ property: 'border-radius', op: '>=', value: '4px' }, '6px')).toBe(true);
    expect(evaluateSignatureCheck({ property: 'border-radius', op: '<=', value: '4' }, '6px')).toBe(false);
    expect(evaluateSignatureCheck({ property: 'count', op: '=', value: '4' }, 4)).toBe(true);
    expect(evaluateSignatureCheck({ property: 'color', op: '=', value: 'rgb(0, 0, 0)' }, 'rgb(0,  0, 0)')).toBe(true);
    expect(evaluateSignatureCheck({ property: 'color', op: '=', value: 'rgb(0, 0, 0)' }, 'rgb(1, 0, 0)')).toBe(false);
    expect(normalizeFontFamily(' "Space   Grotesk" ')).toBe('space grotesk');
  });
});
