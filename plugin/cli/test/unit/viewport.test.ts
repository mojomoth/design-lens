import { describe, expect, it } from 'vitest';

import { parseViewport, parseViewports } from '../../src/lib/viewport.js';

describe('parseViewport', () => {
  // why: clone and inspect must interpret the same viewport notation, including the existing
  // whitespace and uppercase-X support, so responsive measurements agree across commands.
  it.each([
    ['1440x900', { width: 1440, height: 900 }],
    [' 390X844 ', { width: 390, height: 844 }],
    ['1x1', { width: 1, height: 1 }],
    ['0010x0020', { width: 10, height: 20 }],
  ])('parses %s into positive integer dimensions', (raw, expected) => {
    expect(parseViewport(raw)).toEqual(expected);
  });

  // why: viewport strings reach Chromium as integer geometry; rejecting malformed, zero,
  // fractional, or unsafe numbers here prevents late browser errors and silently rounded sizes.
  it.each([
    '',
    '390',
    '390 844',
    '390 x 844',
    '390×844',
    '390x844px',
    '0x900',
    '390x0',
    '-390x844',
    '390x-844',
    '390.5x844',
    '390x844.5',
    'Infinityx844',
    '390xNaN',
    '9007199254740992x844',
    '390x9007199254740992',
    `${'9'.repeat(400)}x844`,
  ])('rejects %j with an actionable viewport error', (raw) => {
    expect(() => parseViewport(raw)).toThrow(/--viewport/);
  });
});

// why: list order selects the canonical HTML; duplicate capture IDs would overwrite source evidence.
describe('parseViewports', () => {
  it('preserves independent capture order and trims whitespace', () => {
    expect(parseViewports('1440x900, 768X1024,390x844')).toEqual([
      { width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 },
    ]);
  });
  it.each(['', '1440x900,', '390x844,0390X844', '1440x900,0x900'])('rejects ambiguous or malformed list %j', (value) => {
    expect(() => parseViewports(value)).toThrow();
  });
  it('bounds independent browser captures to eight viewports', () => {
    const sizes = Array.from({ length: 9 }, (_, index) => `${index + 1}x100`);
    expect(() => parseViewports(sizes.join(','))).toThrow();
    expect(parseViewports(sizes.slice(0, 8).join(','))).toHaveLength(8);
  });
});
