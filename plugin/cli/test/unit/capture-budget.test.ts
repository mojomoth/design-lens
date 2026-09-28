import { describe, expect, it } from 'vitest';
import { viewportCaptureDeadline } from '../../src/commands/clone.js';

describe('source viewport capture budgets', () => {
  it('reserves equal remaining shares and carries unused time forward', () => {
    expect(viewportCaptureDeadline(91_000, 3, 1_000)).toBe(31_000);
    expect(viewportCaptureDeadline(91_000, 2, 11_000)).toBe(51_000);
    expect(viewportCaptureDeadline(91_000, 1, 21_000)).toBe(91_000);
  });

  it('reports an exhausted global budget instead of inventing a 1ms navigation', () => {
    expect(() => viewportCaptureDeadline(1_000, 2, 1_001)).toThrow('whole-run capture deadline exhausted');
  });
});
