/**
 * Runtime-dependency loader for the bundle's `external` packages (`playwright`,
 * `@ghostery/adblocker-playwright`).
 *
 * These are kept OUT of the tsup CJS bundle (spec 01-packaging: external, so the bundle stays
 * < 2 MB) and therefore cannot be `import`ed at the top level — the committed `design-lens.cjs`
 * ships without them. At run time they live in one of two places: the repo checkout's
 * `cli/node_modules` (dev / this test suite), or `~/.design-lens/runtime/node_modules`, where
 * `bootstrap.sh` installs the exact same version pins for an installed plugin. `loadRuntimeDep`
 * tries the ordinary resolver first (which also picks up the `NODE_PATH` the launcher exports),
 * then falls back to an explicit require against the runtime prefix — NODE_PATH resolution is
 * unreliable for the bundle, so we never trust it alone (ADR-007). `createRequire(import.meta.url)`
 * is used rather than a bare `require` so this resolves correctly after the tsup ESM→CJS bundle.
 *
 * Spec: specs/01-packaging.md (§Runtime provisioning, "runtime-deps.ts" normative pattern).
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';

const req = createRequire(import.meta.url);

/**
 * Absolute path to the runtime `node_modules` that `bootstrap.sh` populates. Honors
 * `DESIGN_LENS_HOME` exactly as bootstrap and the launcher do (spec 01: bootstrap MUST honor
 * `DESIGN_LENS_HOME`, default `$HOME/.design-lens`) so an installed plugin with a relocated home
 * still resolves its deps.
 */
function runtimeModulesDir(): string {
  const home = process.env.DESIGN_LENS_HOME ?? join(homedir(), '.design-lens');
  return join(home, 'runtime', 'node_modules');
}

/**
 * Resolve and load a runtime dependency by package name, returning its module object.
 *
 * Order: (1) the normal resolver — repo `node_modules` in dev, or the launcher's `NODE_PATH` for
 * an installed plugin; (2) an explicit require against `~/.design-lens/runtime/node_modules`. If
 * BOTH fail the dependency genuinely is not provisioned, so we throw a clear, actionable error
 * (never a silent swallow — CONVENTIONS forbids catch-and-continue) that names the package and
 * points at bootstrap; the original resolver errors are attached as `cause` for debugging.
 */
export function loadRuntimeDep<T>(name: string): T {
  try {
    return req(name) as T;
  } catch (primaryErr) {
    try {
      return req(join(runtimeModulesDir(), name)) as T;
    } catch (fallbackErr) {
      throw new Error(
        `design-lens could not load its runtime dependency "${name}". It was not found in the ` +
          `plugin's node_modules nor in ${runtimeModulesDir()}. Run the design-lens bootstrap ` +
          `script (bash <plugin dir>/scripts/bootstrap.sh) to provision the runtime, then retry.`,
        { cause: { primaryErr, fallbackErr } },
      );
    }
  }
}
