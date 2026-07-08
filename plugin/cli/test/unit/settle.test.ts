/**
 * Unit tests for the pure pieces of the navigate/settle stage: robots.txt disallow parsing and the
 * lazy-load scroll step size.
 *
 * WHY this exists: `pathIsDisallowed` decides the manifest `robotsDisallowed` flag from arbitrary
 * robots.txt text, and `scrollStepPx` pins the 0.8-viewport step the lazy-load sweep depends on
 * (spec 02 §M2). Both are browser-free and easy to get subtly wrong (group scoping, empty-Disallow
 * = allow-all, fractional viewport). If either regresses, the browser-driven e2e would still pass
 * for the happy path but silently mis-handle these edge cases — so they are asserted here directly.
 */

import { describe, expect, it } from 'vitest';

import { pathIsDisallowed, scrollStepPx } from '../../src/capture/settle.js';

describe('pathIsDisallowed', () => {
  it('disallows a path matched by the wildcard group', () => {
    // A `User-agent: *` group with a matching Disallow prefix must flag the path.
    expect(pathIsDisallowed('User-agent: *\nDisallow: /private', '/private/x')).toBe(true);
  });

  it('treats an empty Disallow value as allow-all', () => {
    // `Disallow:` with no value is the canonical "everything is allowed" signal.
    expect(pathIsDisallowed('User-agent: *\nDisallow:', '/anything')).toBe(false);
  });

  it('ignores rules scoped to a non-wildcard user-agent', () => {
    // A Disallow under `User-agent: Googlebot` must not affect our wildcard decision.
    expect(pathIsDisallowed('User-agent: Googlebot\nDisallow: /', '/x')).toBe(false);
  });
});

describe('scrollStepPx', () => {
  it('advances 80% of the viewport height, floored', () => {
    // 900 * 0.8 = 720; a full-viewport jump (900) would skip observers with a partial-overlap margin.
    expect(scrollStepPx(900)).toBe(720);
  });

  it('never returns less than one pixel for a tiny or zero viewport', () => {
    // floor(0 * 0.8) = 0 would make the sweep loop spin without ever moving — clamp to 1.
    expect(scrollStepPx(0)).toBe(1);
    expect(scrollStepPx(1)).toBe(1);
  });
});
