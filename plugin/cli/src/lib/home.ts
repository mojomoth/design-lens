/**
 * The one place that answers "where is `~/.design-lens`?".
 *
 * Three subsystems need it and MUST agree: `lib/runtime-deps.ts` (external deps under
 * `runtime/node_modules`), `capture/consent.ts` (the filter-list cache under `cache/filterlists`),
 * and `plugin/scripts/bootstrap.sh`, which populates both. Spec 01-packaging requires bootstrap and
 * the launcher to honor `DESIGN_LENS_HOME` (default `$HOME/.design-lens`), so every in-process
 * consumer resolves the home through this function rather than re-reading the env var — a relocated
 * home that only half the code sees is worse than no relocation at all.
 *
 * Spec: specs/01-packaging.md (§Runtime provisioning).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Absolute path to the design-lens home, honoring a `DESIGN_LENS_HOME` override. */
export function designLensHome(): string {
  return process.env.DESIGN_LENS_HOME ?? join(homedir(), '.design-lens');
}
