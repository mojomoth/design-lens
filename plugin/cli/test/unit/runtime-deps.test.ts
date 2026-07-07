import { describe, it, expect } from 'vitest';
import { loadRuntimeDep } from '../../src/lib/runtime-deps.js';

// why: the shipped bundle keeps playwright / adblocker `external` (spec 01-packaging), so the ONLY
// way the CLI reaches them at run time is loadRuntimeDep's two-tier require (repo node_modules or
// NODE_PATH first, then the ~/.design-lens/runtime fallback bootstrap populates). If this resolver
// regressed — wrong package name passed to require, a swallowed error, or the fallback path built
// wrong — every browser command (clone/screenshot/inspect) would die at launch with no usable
// message. These tests bind no browser; they only prove the module object is resolved and that a
// genuinely-missing dep surfaces an actionable error instead of a bare require stack.
describe('loadRuntimeDep', () => {
  it('resolves the playwright module object from the resolvable dependency', () => {
    // playwright is an exact-pinned dependency (T05), so it resolves via the primary require path
    // exactly as it will in dev and via the launcher's NODE_PATH in an installed plugin.
    const playwright = loadRuntimeDep<typeof import('playwright')>('playwright');
    expect(playwright).toBeTypeOf('object');
    expect(playwright.chromium).toBeTypeOf('object');
    // The one member the clone pipeline (T11) actually calls — proves we got the real module,
    // not an empty stub or the wrong package.
    expect(playwright.chromium.launch).toBeTypeOf('function');
  });

  it('throws an actionable error naming the dep and bootstrap when it resolves nowhere', () => {
    // A package that exists in neither node_modules nor the runtime prefix must NOT surface as a
    // raw MODULE_NOT_FOUND: the user needs to know which dep is missing and how to fix it.
    const missing = '@design-lens/definitely-not-a-real-runtime-dep';
    expect(() => loadRuntimeDep(missing)).toThrowError(
      /could not load its runtime dependency "@design-lens\/definitely-not-a-real-runtime-dep"[\s\S]*bootstrap/,
    );
  });
});
