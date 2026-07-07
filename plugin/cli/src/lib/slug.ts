/**
 * Pure slug derivation for clone project directories (`.design-lens/<slug>/`).
 *
 * Kept browser- and filesystem-free so it can be unit-tested in isolation and reused by the clone
 * writer. Filesystem collision handling injects an `exists` predicate rather than touching disk
 * here. Spec: specs/03-clone-format.md §Location & slug.
 */

/** Used when sanitization yields an empty string (e.g. a hostname of only punctuation). */
const FALLBACK = 'site';

/**
 * sanitize(): lowercase; any char outside `[a-z0-9-]` → `-`; collapse runs of `-`; trim
 * leading/trailing `-`. Deterministic and idempotent.
 */
export function sanitize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface SlugInput {
  /** The clone target URL (used when `project` is absent or blank). */
  url?: string;
  /** Explicit `--project <name>` override; takes precedence over the URL. */
  project?: string;
}

/**
 * Derive the base slug (no collision suffix).
 *
 * With `--project`, slug = sanitize(name). Otherwise slug = sanitize(hostname) plus, when the URL
 * has a non-empty first path segment, `-` + sanitize(segment). Query and fragment are ignored.
 * Examples: `https://stripe.com` → `stripe-com`; `https://stripe.com/sessions/x` →
 * `stripe-com-sessions`.
 *
 * @throws if neither a URL nor a project name is supplied, or if the URL cannot be parsed.
 */
export function baseSlug(input: SlugInput): string {
  if (input.project !== undefined && input.project.trim() !== '') {
    return sanitize(input.project) || FALLBACK;
  }
  if (input.url === undefined || input.url.trim() === '') {
    throw new Error('baseSlug requires a url or a project name');
  }
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error(`baseSlug: invalid URL: ${input.url}`);
  }
  let slug = sanitize(parsed.hostname);
  const firstSegment = parsed.pathname.split('/').find((s) => s !== '');
  if (firstSegment !== undefined) {
    const segment = sanitize(firstSegment);
    if (segment !== '') slug = slug === '' ? segment : `${slug}-${segment}`;
  }
  return slug || FALLBACK;
}

/**
 * Resolve directory collisions deterministically: return `base` if free, else the first free
 * `base-2`, `base-3`, … The caller supplies `exists` (a filesystem check in production); keeping
 * it injected leaves this function pure and testable. Spec 03 forbids writing into an existing
 * project dir.
 */
export function nextFreeSlug(base: string, exists: (candidate: string) => boolean): string {
  if (!exists(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
}
