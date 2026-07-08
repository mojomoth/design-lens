/**
 * Write the clone project directory to disk (the pipeline's only filesystem sink besides the
 * project-dir resolution in `commands/clone.ts`).
 *
 * Layout (specs/03-clone-format.md §Directory tree): `clone/index.html`, every localized asset at
 * its `assets/<host>/…` path under `clone/`, an EMPTY `clone/assets/dl-overrides.css` (its `<link>`
 * is appended by the localize pass), and `manifest.json` + `REPORT.md` at the PROJECT-DIR ROOT
 * (siblings of `clone/`, not inside it). Write failures are fatal — the caller surfaces them.
 *
 * Spec: specs/02-clone-engine.md §8 (Write); specs/03-clone-format.md §Directory tree.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LocalizedAsset } from '../localize/localize.js';

/** Everything the writer emits. `html`/`manifestJson`/`reportMarkdown` are already fully rendered. */
export interface WriteCloneInput {
  /** Absolute path to the project dir (`<out>/<slug>`); must not already exist. */
  projectDir: string;
  /** Final `clone/index.html` bytes (provenance comment + beautified document). */
  html: string;
  /** Localized resources to write under `clone/`. */
  assets: LocalizedAsset[];
  /** Serialized `manifest.json` (project-dir root). */
  manifestJson: string;
  /** Rendered `REPORT.md` (project-dir root). */
  reportMarkdown: string;
}

/** Write the whole project tree. Creates parent directories as needed. */
export function writeClone(input: WriteCloneInput): void {
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
  fs.writeFileSync(path.join(input.projectDir, 'manifest.json'), input.manifestJson);
  fs.writeFileSync(path.join(input.projectDir, 'REPORT.md'), input.reportMarkdown);
}
