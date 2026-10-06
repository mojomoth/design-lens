import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VERSION } from '../../src/version.js';

// Repo root, four levels up from test/unit/ (plugin/cli/test/unit → plugin/cli → plugin → repo).
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const PLUGIN = path.join(REPO, 'plugin');

const CLAUDE_PLUGIN = path.join(PLUGIN, '.claude-plugin/plugin.json');
const CODEX_PLUGIN = path.join(PLUGIN, '.codex-plugin/plugin.json');
const CLAUDE_MARKET = path.join(REPO, '.claude-plugin/marketplace.json');
const CODEX_MARKET = path.join(REPO, '.agents/plugins/marketplace.json');

/** The four manifest files AC-09 requires to exist and parse, in spec 01's listed order. */
const ALL_FOUR = [CLAUDE_PLUGIN, CODEX_PLUGIN, CLAUDE_MARKET, CODEX_MARKET];

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('plugin manifests & marketplace files', () => {
  // why: spec 01 §Manifests requires all four JSON files to exist and parse (AC-09), and the sealed
  // gate's S3b re-checks exactly this list. Catching a malformed/renamed manifest here — in the fast
  // unit suite — means a broken install manifest fails in seconds instead of only under `--strict`,
  // where the failure surfaces as an opaque `claude plugin validate` error. If this test is removed,
  // a stray trailing comma or a moved file ships an uninstallable plugin.
  it('all four manifest files exist and parse as JSON', () => {
    for (const file of ALL_FOUR) {
      expect(existsSync(file), `${path.relative(REPO, file)} must exist`).toBe(true);
      expect(() => readJson(file), `${path.relative(REPO, file)} must parse`).not.toThrow();
    }
  });

  // why: spec 01 §Manifests & version lock mandates the three-way lock — both plugin.json files and
  // the CLI's single VERSION source must agree — and explicitly asks for "a unit test [to] assert the
  // three-way lock by reading both manifests". The strict gate's S4 compares the same three values by
  // shelling out to the BUILT bundle, so a mismatch there is only caught after a rebuild; this test
  // catches a half-finished release bump (manifest edited, src/version.ts forgotten, or vice versa)
  // the moment it happens. Claude only ships updates to users on a version bump, so a desynced pair
  // silently strands users on the old plugin. If removed, S4 becomes the only guard and fails late.
  it('locks version 0.4.0 across both plugin.json manifests and the CLI VERSION constant', () => {
    const claude = readJson(CLAUDE_PLUGIN);
    const codex = readJson(CODEX_PLUGIN);

    expect(claude['version']).toBe('0.4.0');
    expect(codex['version']).toBe('0.4.0');
    expect(VERSION).toBe('0.4.0');

    // The lock is an equality relation, not three independent literals: assert it as such so a
    // future coordinated bump to e.g. 0.5.0 only needs the literals above changed in one place.
    expect(claude['version']).toBe(VERSION);
    expect(codex['version']).toBe(VERSION);
    expect(readJson(path.join(PLUGIN, 'cli/package.json'))['version']).toBe(VERSION);
    const lock = readJson(path.join(PLUGIN, 'cli/package-lock.json'));
    expect(lock['version']).toBe(VERSION);
    expect((lock['packages'] as Record<string, Record<string, unknown>>)['']!['version']).toBe(VERSION);
  });

  // why: spec 01 requires both plugin.json files to name the same plugin and point at the same skills
  // entry point. Codex reads `.codex-plugin/plugin.json` while Claude reads
  // `.claude-plugin/plugin.json`; if the two drift, one tool silently loads a different skill set than
  // the other — the exact dual-tool divergence this plugin exists to avoid (ADR-003). The hooks
  // contract is deliberately ASYMMETRIC since ADR-017: Claude Code auto-loads hooks/hooks.json and
  // hard-fails at load time on a manifest pointer to that same path ("Duplicate hooks file"), so the
  // Claude manifest must NOT carry a hooks key, while Codex still needs the explicit pointer.
  it('keeps name and skills identical; hooks pointer lives ONLY in the Codex manifest', () => {
    const claude = readJson(CLAUDE_PLUGIN);
    const codex = readJson(CODEX_PLUGIN);

    for (const manifest of [claude, codex]) {
      expect(manifest['name']).toBe('design-lens');
      expect(manifest['skills']).toBe('./skills/');
      expect(manifest['description']).toBe(claude['description']);
    }
    expect(codex['hooks']).toBe('./hooks/hooks.json');
    expect(claude['hooks'], 'a Claude manifest hooks key duplicates the auto-load and breaks plugin load (ADR-017)').toBeUndefined();
  });

  // why: spec 01 §Manifests — "All paths inside manifests MUST be relative and start with `./`; no
  // path may escape the plugin root." Installs COPY the plugin directory into a version-suffixed tool
  // cache, so an absolute path or a `../` escape resolves to nothing (or, worse, to an unrelated file)
  // on every user's machine while working perfectly in this repo. This asserts the invariant on the
  // real manifest values rather than trusting review. If removed, a `../cli/dist/...` shortcut would
  // pass every local test and break 100% of installs.
  it('uses only relative ./-prefixed paths that never escape the plugin root', () => {
    // Claude's manifest has no hooks key since ADR-017 — filter, don't assume symmetry.
    const pathValues = [
      ...['skills', 'hooks'].map((k) => readJson(CLAUDE_PLUGIN)[k]),
      ...['skills', 'hooks'].map((k) => readJson(CODEX_PLUGIN)[k]),
    ].filter((v) => v !== undefined);

    for (const value of pathValues) {
      expect(typeof value).toBe('string');
      const p = value as string;
      expect(p.startsWith('./'), `${p} must start with ./`).toBe(true);
      expect(path.isAbsolute(p), `${p} must not be absolute`).toBe(false);
      // Resolve against the plugin root and confirm containment — catches `./../x` style escapes
      // that still satisfy the `./` prefix check above.
      const resolved = path.resolve(PLUGIN, p);
      expect(resolved.startsWith(PLUGIN + path.sep) || resolved === PLUGIN).toBe(true);
    }
  });

  // why: `claude plugin validate ./plugin --strict` (AC-09, gate check S3) hard-fails with
  // "Path not found: ./hooks/hooks.json" when a manifest's hooks pointer dangles — a plugin.json
  // referencing a file that does not exist is an invalid plugin, not a tolerated warning. The same
  // applies to the skills directory. This resolves both pointers on disk so the failure is a one-line
  // unit-test diff instead of an opaque validator error. If removed, deleting or renaming
  // hooks/hooks.json (T26 territory) would only be caught under `--strict`.
  it('resolves the skills and hooks pointers to real paths on disk', () => {
    for (const manifest of [CLAUDE_PLUGIN, CODEX_PLUGIN]) {
      const json = readJson(manifest);
      const skills = path.resolve(PLUGIN, json['skills'] as string);
      expect(existsSync(skills), `${json['skills'] as string} must exist`).toBe(true);
      if (json['hooks'] !== undefined) {
        const hooks = path.resolve(PLUGIN, json['hooks'] as string);
        expect(existsSync(hooks), `${json['hooks'] as string} must exist`).toBe(true);
      }
    }
    // The auto-loaded conventional path must exist regardless of any manifest pointer.
    expect(existsSync(path.join(PLUGIN, 'hooks/hooks.json'))).toBe(true);
  });

  // why: spec 01 §Repo & plugin layout — "Both marketplace files MUST reference the plugin via source
  // path `./plugin`" (never `plugins/design-lens/`), and the Codex-native entry additionally requires
  // `policy` and `category` keys or Codex refuses the entry (verified fact, codex-plugin.md §1). The
  // two files use DIFFERENT source shapes (a bare string vs a `{source,path}` object), which is easy
  // to "helpfully" unify and thereby break one tool. Removing this test lets a marketplace regression
  // reach users, where it manifests as a plugin that cannot be discovered at all.
  it('points both marketplace files at ./plugin with the per-tool required keys', () => {
    const claudeMarket = readJson(CLAUDE_MARKET);
    const codexMarket = readJson(CODEX_MARKET);

    const claudeEntry = (claudeMarket['plugins'] as Record<string, unknown>[])[0]!;
    expect(claudeEntry['name']).toBe('design-lens');
    expect(claudeEntry['source']).toBe('./plugin');

    const codexEntry = (codexMarket['plugins'] as Record<string, unknown>[])[0]!;
    expect(codexEntry['name']).toBe('design-lens');
    expect(codexEntry['source']).toEqual({ source: 'local', path: './plugin' });
    // Codex-native marketplace entries require both of these or the entry is rejected outright.
    expect(codexEntry['policy']).toEqual({ installation: 'AVAILABLE' });
    expect(codexEntry['category']).toBe('Productivity');
  });

  // why: the SessionStart hook is the ONLY provisioning path for `~/.design-lens` on both tools, and
  // spec 01 pins its exact shape: a `command` hook invoking bootstrap.sh via `${CLAUDE_PLUGIN_ROOT}`
  // (the one place that variable is legal — ADR-004 bans it from skill bodies, and AC-12 greps for it
  // there). The 600s timeout exists because a first run downloads Chromium; shrinking it silently
  // breaks cold installs on slow links. If this test is removed, a reformatted hooks.json could drop
  // the SessionStart key entirely and every install would ship without a runtime.
  it('declares the SessionStart bootstrap hook with the plugin-root variable and a cold-start timeout', () => {
    const hooks = readJson(path.join(PLUGIN, 'hooks/hooks.json'));
    const sessionStart = (hooks['hooks'] as Record<string, unknown>)['SessionStart'] as Record<
      string,
      unknown
    >[];

    expect(Array.isArray(sessionStart)).toBe(true);
    const entry = (sessionStart[0]!['hooks'] as Record<string, unknown>[])[0]!;
    expect(entry['type']).toBe('command');
    expect(entry['command']).toBe('bash "${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh"');
    expect(entry['timeout']).toBe(600);
  });
});
