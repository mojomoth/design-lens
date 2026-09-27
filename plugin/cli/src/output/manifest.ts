/**
 * Build the project-dir `manifest.json` — the clone's provenance record (PURE module, no I/O).
 *
 * The manifest lives at the project-dir ROOT (a sibling of `clone/`), NOT inside `clone/`, because
 * the sealed gate (AC-07) reads `<projectDir>/manifest.json` and resolves every
 * `resources[].localPath` FROM the project dir — so each `localPath` is rooted at `clone/assets/…`
 * (ADR-010). `localize/urlmap` returns the shorter `assets/…` form that goes INTO the HTML/CSS;
 * this module owns the `clone/` prefix that turns that into a project-dir-relative path, so the two
 * representations never drift.
 *
 * It is the only manifest permitted to record absolute capture-origin URLs. The writer (T11)
 * serialises the returned object with `manifestJson`; this module computes nothing about the
 * filesystem beyond hashing resource bytes handed to it.
 *
 * Spec: specs/03-clone-format.md §manifest.json schema.
 */

import { createHash } from 'node:crypto';

import { VERSION } from '../version.js';

/** Schema version of the manifest document itself (bumped only on a breaking shape change). */
export const MANIFEST_VERSION = 1;

/** How a resource's bytes were obtained (closed enum — spec §via). */
export type ResourceVia = 'network' | 'css-fetch' | 'refetch';

/** Why a reference was left remote instead of localised (closed enum — spec §remote). */
export type RemoteReason = 'cross-origin-iframe' | 'oversize' | 'media-skipped' | 'fetch-failed';

/** One localised resource, addressed by its project-dir-relative `clone/assets/…` path. */
export interface ManifestResource {
  /** Project-dir-relative path, always under `clone/assets/`. */
  localPath: string;
  /** The absolute URL the bytes came from. */
  originalUrl: string;
  /** Content type as fetched (sans charset params is fine; recorded verbatim). */
  contentType: string;
  /** Byte length of the stored file. */
  bytes: number;
  /** Lowercase hex sha256 of the stored bytes. */
  sha256: string;
  /** Provenance of the bytes. */
  via: ResourceVia;
}

/** A reference intentionally left pointing at the live web, with the reason it was not localised. */
export interface ManifestRemote {
  url: string;
  reason: RemoteReason;
  /** Human-readable locus of the reference (e.g. a `data-dl-id`, a stylesheet URL). */
  referencedBy: string;
}

/** Capture-origin provenance. `url` is as given; `finalUrl` is after redirects. */
export interface ManifestSource {
  url: string;
  finalUrl: string;
  title: string;
  /** ISO-8601; MUST match the `capturedAt` in the clone's provenance comment. */
  capturedAt: string;
  viewport: { width: number; height: number };
  userAgent: string;
  robotsDisallowed: boolean;
}

/** Rollup counters surfaced in REPORT.md and used by tooling; all non-negative integers. */
export interface ManifestStats {
  elementsStamped: number;
  styleRules: number;
  fonts: number;
  images: number;
  cssFiles: number;
  warnings: number;
}

/** The full manifest document written to `<projectDir>/manifest.json`. */
export interface Manifest {
  version: number;
  /** Immutable source evidence digest; absent on captures made before evidence support. */
  evidenceHash?: string;
  tool: { name: string; version: string; playwright: string };
  source: ManifestSource;
  resources: ManifestResource[];
  remote: ManifestRemote[];
  stats: ManifestStats;
}

/** Everything the writer must supply; `tool` name/version and `version` are fixed by the module. */
export interface BuildManifestInput {
  /** The exact pinned Playwright version (from `.harness/config.env`, ADR-008). */
  playwrightVersion: string;
  source: ManifestSource;
  resources: ManifestResource[];
  remote?: ManifestRemote[];
  stats: ManifestStats;
}

/** The mandatory prefix for every resource `localPath` (project-dir-relative, ADR-010). */
const ASSET_ROOT = 'clone/assets/';

/**
 * Construct one `resources[]` entry from a resource's stored bytes and its urlmap path.
 *
 * `assetPath` is the `assets/…` string produced by `localize/urlmap.localPathFor` (exactly what is
 * substituted INTO the HTML/CSS). This prefixes `clone/` so the manifest path resolves from the
 * project dir, and computes `bytes`/`sha256` from the bytes actually written to disk — hashing here
 * (rather than trusting a caller-supplied digest) keeps the manifest honest about the stored file.
 *
 * @throws if `assetPath` is not rooted at `assets/` (a caller bug that would break gate AC-07).
 */
export function resourceEntry(
  body: Uint8Array,
  meta: { assetPath: string; originalUrl: string; contentType: string; via: ResourceVia },
): ManifestResource {
  if (!meta.assetPath.startsWith('assets/')) {
    throw new Error(`resourceEntry: assetPath must start with "assets/": ${meta.assetPath}`);
  }
  return {
    localPath: `clone/${meta.assetPath}`,
    originalUrl: meta.originalUrl,
    contentType: meta.contentType,
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
    via: meta.via,
  };
}

/**
 * Assemble the manifest document. Locks `version`, `tool.name`, and `tool.version` (the latter to
 * the single-source-of-truth {@link VERSION}, so the manifest, the provenance comment, and
 * `--version` can never disagree). Validates that every resource path is under `clone/assets/`.
 *
 * @throws if any `resources[].localPath` is not rooted at `clone/assets/` (violates spec §schema
 *   and would make gate AC-07's localPath resolution meaningless).
 */
export function buildManifest(input: BuildManifestInput): Manifest {
  for (const r of input.resources) {
    if (!r.localPath.startsWith(ASSET_ROOT)) {
      throw new Error(`buildManifest: resource localPath must be under "${ASSET_ROOT}": ${r.localPath}`);
    }
  }
  return {
    version: MANIFEST_VERSION,
    tool: { name: 'design-lens', version: VERSION, playwright: input.playwrightVersion },
    source: input.source,
    resources: input.resources,
    remote: input.remote ?? [],
    stats: input.stats,
  };
}

/**
 * Serialise a manifest to the exact bytes written to disk: 2-space indented JSON with a trailing
 * newline (POSIX text-file convention; keeps `git diff` clean when the committed dist regenerates).
 */
export function manifestJson(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
