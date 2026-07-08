/**
 * Write the clone project directory to disk (the pipeline's only filesystem sink besides the
 * project-dir resolution in `commands/clone.ts`).
 *
 * Layout (specs/03-clone-format.md §Directory tree): `clone/index.html`, every localized asset at
 * its `assets/<host>/…` path under `clone/`, an EMPTY `clone/assets/dl-overrides.css` (its `<link>`
 * is appended by the localize pass), `screenshots/*.png`, and `manifest.json` + `REPORT.md` at the
 * PROJECT-DIR ROOT (siblings of `clone/`, not inside it). Write failures are fatal — the caller
 * surfaces them.
 *
 * The write is SPLIT into three functions rather than one, because `clone-full.png` is a picture of
 * the WRITTEN clone: the tree must already be on disk before the re-render can serve it, and the
 * re-render may add a warning — so `manifest.json`/`REPORT.md`, which record `stats.warnings`, can
 * only be rendered afterwards. Ordering: {@link writeCloneTree} → screenshots ({@link writePng}) →
 * {@link writeProjectDocs}.
 *
 * Spec: specs/02-clone-engine.md §8 (Write), §M3 (Screenshots); specs/03-clone-format.md §Directory tree.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LocalizedAsset } from '../localize/localize.js';

/** The inert document plus every localized resource that lives under `clone/`. */
export interface WriteCloneTreeInput {
  /** Absolute path to the project dir (`<out>/<slug>`); must not already exist. */
  projectDir: string;
  /** Final `clone/index.html` bytes (provenance comment + beautified document). */
  html: string;
  /** Localized resources to write under `clone/`. */
  assets: LocalizedAsset[];
}

/** The project-root provenance documents, rendered only once the final warning count is known. */
export interface WriteProjectDocsInput {
  projectDir: string;
  /** Serialized `manifest.json` (project-dir root). */
  manifestJson: string;
  /** Rendered `REPORT.md` (project-dir root). */
  reportMarkdown: string;
}

/** Write `clone/` — index.html, every asset at its `assets/…` path, and the empty override sheet. */
export function writeCloneTree(input: WriteCloneTreeInput): void {
  const cloneDir = path.join(input.projectDir, 'clone');
  fs.mkdirSync(cloneDir, { recursive: true });

  for (const asset of input.assets) {
    // assetPath is a `/`-separated `assets/…` path; path.join normalizes separators per platform.
    const dest = path.join(cloneDir, asset.assetPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, asset.body);
  }

  // The override stylesheet is created EMPTY; the localize pass already linked it last in <head>.
  const assetsDir = path.join(cloneDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'dl-overrides.css'), '');

  fs.writeFileSync(path.join(cloneDir, 'index.html'), input.html);
}

/** Write `manifest.json` + `REPORT.md` at the project-dir root (siblings of `clone/`, ADR-010). */
export function writeProjectDocs(input: WriteProjectDocsInput): void {
  fs.mkdirSync(input.projectDir, { recursive: true });
  fs.writeFileSync(path.join(input.projectDir, 'manifest.json'), input.manifestJson);
  fs.writeFileSync(path.join(input.projectDir, 'REPORT.md'), input.reportMarkdown);
}

/** Absolute path of one of the project's screenshots, e.g. `<projectDir>/screenshots/clone-full.png`. */
export function screenshotPath(projectDir: string, name: string): string {
  return path.join(projectDir, 'screenshots', name);
}

/** Write PNG bytes to `filePath`, creating its parent directory. Used for every `screenshot` sink. */
export function writePng(filePath: string, png: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}
