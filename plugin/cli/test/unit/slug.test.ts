import { describe, it, expect } from 'vitest';
import { sanitize, baseSlug, nextFreeSlug } from '../../src/lib/slug.js';

// why: `sanitize` is the shared primitive behind every project-dir name; if its lowercasing,
// non-`[a-z0-9-]` replacement, dash-collapsing or trimming regressed, slugs could contain path
// separators or uppercase and break `.design-lens/<slug>/` lookups across every command.
describe('sanitize', () => {
  it('lowercases and replaces non [a-z0-9-] chars with a single dash', () => {
    expect(sanitize('Hello World!')).toBe('hello-world');
    expect(sanitize('a.b/c')).toBe('a-b-c');
  });

  it('collapses runs of dashes and trims leading/trailing dashes', () => {
    expect(sanitize('--a___b--')).toBe('a-b');
    expect(sanitize('...')).toBe('');
  });

  it('is idempotent (sanitizing an already-clean slug is a no-op)', () => {
    expect(sanitize('stripe-com-sessions')).toBe('stripe-com-sessions');
  });
});

// why: the slug algorithm is the on-disk contract in spec 03; the two canonical examples and the
// query/fragment-ignoring rule are asserted here so a future refactor cannot silently change where
// clones land (which would strand every downstream tokens/inspect/verify command).
describe('baseSlug', () => {
  it('derives host-only slug from a bare origin (spec example)', () => {
    expect(baseSlug({ url: 'https://stripe.com' })).toBe('stripe-com');
  });

  it('appends the first non-empty path segment (spec example)', () => {
    expect(baseSlug({ url: 'https://stripe.com/sessions/x' })).toBe('stripe-com-sessions');
  });

  it('ignores query string and fragment', () => {
    expect(baseSlug({ url: 'https://stripe.com/sessions?a=1#frag' })).toBe('stripe-com-sessions');
  });

  it('skips empty leading path segments (double slash) and uses the first real one', () => {
    expect(baseSlug({ url: 'https://example.com///docs/' })).toBe('example-com-docs');
  });

  it('treats a root path ("/") as host-only', () => {
    expect(baseSlug({ url: 'https://example.com/' })).toBe('example-com');
  });

  it('prefers an explicit --project name over the URL', () => {
    expect(baseSlug({ url: 'https://stripe.com', project: 'My Brand' })).toBe('my-brand');
  });

  it('ignores a blank project name and falls back to the URL', () => {
    expect(baseSlug({ url: 'https://stripe.com', project: '   ' })).toBe('stripe-com');
  });

  it('is deterministic (same input → same output)', () => {
    const input = { url: 'https://a.b.example.com/Foo-Bar/baz' };
    expect(baseSlug(input)).toBe(baseSlug(input));
    expect(baseSlug(input)).toBe('a-b-example-com-foo-bar');
  });

  it('falls back to "site" when the host and segments sanitize to empty', () => {
    // a project name that is only punctuation sanitizes to "" → fallback keeps a valid dir name
    expect(baseSlug({ project: '///' })).toBe('site');
  });

  it('throws when neither url nor project is provided', () => {
    expect(() => baseSlug({})).toThrow(/requires a url or a project/);
  });

  it('throws on an unparseable URL', () => {
    expect(() => baseSlug({ url: 'not a url' })).toThrow(/invalid URL/);
  });
});

// why: collision suffixing (`-2`, `-3`, …) is what stops `clone` from overwriting an existing
// project dir (spec 03); injecting `exists` keeps it pure. If this regressed, a second clone of
// the same site could silently destroy the first.
describe('nextFreeSlug', () => {
  it('returns the base unchanged when it is free', () => {
    expect(nextFreeSlug('stripe-com', () => false)).toBe('stripe-com');
  });

  it('appends -2 when the base is taken', () => {
    const taken = new Set(['stripe-com']);
    expect(nextFreeSlug('stripe-com', (c) => taken.has(c))).toBe('stripe-com-2');
  });

  it('finds the first free numbered suffix when several are taken', () => {
    const taken = new Set(['stripe-com', 'stripe-com-2', 'stripe-com-3']);
    expect(nextFreeSlug('stripe-com', (c) => taken.has(c))).toBe('stripe-com-4');
  });
});
