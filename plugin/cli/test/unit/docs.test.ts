import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Docs invariants for the three shipped documents (spec 10-ethics §Layer 3, spec 01-packaging
 * §Install story). These are prose files no typechecker sees, but two of the invariants are
 * load-bearing legal obligations, not style preferences:
 *
 *   - `plugin/NOTICE.md` is how Design Lens discharges the attribution clause of the MIT/BSD/ISC
 *     licenses of every package it *redistributes* inside `dist/design-lens.cjs` (ADR-005). A
 *     dependency added to package.json without a NOTICE row ships a license violation, and
 *     nothing else in the repo would notice.
 *   - `plugin/README.md`'s fair-use section is the docs layer of the three-layer ethics guardrail
 *     (CLI / skills / docs). Its heading is referenced from the root README and NOTICE.md.
 */

// Repo root, four levels up from test/unit/ (plugin/cli/test/unit → plugin/cli → plugin → repo).
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const PLUGIN = path.join(REPO, 'plugin');

const ROOT_README = path.join(REPO, 'README.md');
const PLUGIN_README = path.join(PLUGIN, 'README.md');
const NOTICE = path.join(PLUGIN, 'NOTICE.md');
const CLI_PKG = path.join(PLUGIN, 'cli/package.json');

/** Kept external to the bundle and installed into `~/.design-lens/runtime` by bootstrap.sh. */
const EXTERNAL_DEPS = ['playwright', '@ghostery/adblocker-playwright'];

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function runtimeDeps(): string[] {
  const pkg = JSON.parse(read(CLI_PKG)) as { dependencies?: Record<string, string> };
  return Object.keys(pkg.dependencies ?? {});
}

describe('shipped documentation', () => {
  // why: spec 01 §Install story requires BOTH install blocks in the root README, and the sealed
  // gate's S9 greps for exactly these two strings (AC-15). A reworded heading or a dropped Codex
  // block makes the plugin uninstallable-by-documentation for half its audience. This test fails
  // in the fast unit suite; S9 only fails under the full gate. If removed, a README rewrite can
  // silently drop the Codex install path.
  it('root README documents the install path for both tools', () => {
    const readme = read(ROOT_README);
    expect(readme).toMatch(/plugin marketplace add/i);
    expect(readme).toMatch(/codex plugin marketplace add/i);
  });

  // why: spec 10-ethics §Layer 3 mandates this exact heading in plugin/README.md — it is the docs
  // layer of the three-layer guardrail, and both the root README and NOTICE.md link to its anchor
  // (`#fair-use--respect-for-designers`), which is derived from the heading text. Renaming the
  // heading breaks those links and removes the only place the study/ship separation is argued. The
  // sealed gate's S9b only checks the file EXISTS, so without this test an empty README passes.
  it('plugin README carries the verbatim fair-use heading and makes the three-part argument', () => {
    const readme = read(PLUGIN_README);
    expect(readme).toContain('## Fair use & respect for designers');
    // The argument spec 10 requires: study (clone-reference + reverse-design) is separated from
    // ship (build-from-design + the brand checklist), and clones are never deployed/redistributed.
    expect(readme).toContain('clone-reference');
    expect(readme).toContain('reverse-design');
    expect(readme).toContain('build-from-design');
    expect(readme).toContain('## Before you ship — brand checklist');
    expect(readme).toMatch(/never to be deployed or redistributed/i);
  });

  // why: spec 01 §Install story requires plugin/README.md to document the Codex hook-trust step.
  // Codex silently skips non-managed plugin hooks until the user trusts them, so a first-run Codex
  // user gets NO bootstrap, no `~/.design-lens/bin/design-lens`, and every skill fails with a
  // confusing "command not found". The manual escape hatch must be written down. If removed,
  // nothing in the repo tells a Codex user why the plugin appears broken on install.
  it('plugin README documents the Codex hook-trust step and the manual bootstrap escape hatch', () => {
    const readme = read(PLUGIN_README);
    expect(readme).toMatch(/\/hooks/);
    expect(readme).toMatch(/scripts\/bootstrap\.sh/);
  });

  // why: THE license-compliance guard. ADR-005 requires every redistributed package to be
  // enumerated in NOTICE.md. `dependencies` in package.json is the authoritative list of what the
  // bundle carries (minus the two externals, which NOTICE lists separately as runtime installs).
  // Adding a dependency without a NOTICE row is an attribution-clause violation that no other
  // check in this repo — typecheck, lint, the sealed gate — would ever surface. If this test is
  // removed, NOTICE.md silently rots the first time someone runs `npm install --save`.
  it('NOTICE.md lists every runtime dependency declared in package.json', () => {
    const notice = read(NOTICE);
    const missing = runtimeDeps().filter((dep) => !notice.includes(dep));
    expect(missing, `dependencies absent from plugin/NOTICE.md: ${missing.join(', ')}`).toEqual([]);
  });

  // why: ADR-005 permits MPL-2.0 (`@ghostery/adblocker-playwright`) and Apache-2.0 (`playwright`)
  // ONLY as external, separately-installed dependencies — they must never be compiled into the
  // bundle. NOTICE.md must therefore describe them as NOT bundled; saying otherwise would both
  // misstate our obligations and mask a real packaging regression. Pinned to the tsup `external`
  // list, which is the mechanism that keeps the claim true.
  it('NOTICE.md records the external deps as runtime-installed, not bundled', () => {
    const notice = read(NOTICE);
    for (const dep of EXTERNAL_DEPS) {
      expect(notice, `${dep} must appear in NOTICE.md`).toContain(dep);
    }
    expect(notice).toMatch(/NOT bundled/i);
    expect(notice).toContain('MPL-2.0');
    expect(notice).toContain('Apache-2.0');
  });

  // why: ADR-005 forbids AGPL code outright — `single-file-cli` is named in CONVENTIONS.md as the
  // specific package never to vendor or import. NOTICE.md states this explicitly so the promise is
  // auditable from the shipped artifact alone, and this test proves no AGPL dependency ever crept
  // into package.json. If removed, an AGPL dep could be added and the MIT license claim on the
  // whole plugin would become false.
  it('declares no AGPL dependency and says so in NOTICE.md', () => {
    const notice = read(NOTICE);
    expect(notice).toContain('AGPL');
    expect(notice).toMatch(/never vendored/i);
    expect(notice).toContain('single-file-cli');
    expect(runtimeDeps()).not.toContain('single-file-cli');
  });

  // why: the two files S9b requires must exist; a missing NOTICE.md fails the sealed gate late and
  // opaquely. Cheap, and it pins the paths the rest of this suite reads.
  it('plugin/README.md and plugin/NOTICE.md exist', () => {
    expect(existsSync(PLUGIN_README)).toBe(true);
    expect(existsSync(NOTICE)).toBe(true);
  });
});
