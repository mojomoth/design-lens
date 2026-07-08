import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Guards `plugin/scripts/bootstrap.sh`, whose invariants live OUTSIDE the TypeScript sources it
 * provisions: a shell script the sealed install gate (verify.sh --install, I1/I2 = AC-17) executes
 * in a throwaway HOME. Nothing in the unit or e2e suites runs that script, and `--install` is a
 * slow, opt-in mode — so without this file the script's contracts are only ever checked by a gate
 * nobody runs on a normal iteration.
 */
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const PLUGIN = path.join(REPO, 'plugin');

const BOOTSTRAP = path.join(PLUGIN, 'scripts/bootstrap.sh');
const CLI_PKG = path.join(PLUGIN, 'cli/package.json');
const HOOKS = path.join(PLUGIN, 'hooks/hooks.json');

const script = (): string => readFileSync(BOOTSTRAP, 'utf8');

function deps(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(CLI_PKG, 'utf8')) as { dependencies: Record<string, string> };
  return pkg.dependencies;
}

/** The two packages tsup keeps `external`, so the runtime prefix must supply them itself. */
const EXTERNAL_PINS = ['playwright', '@ghostery/adblocker-playwright'] as const;

describe('plugin/scripts/bootstrap.sh', () => {
  // why: spec 01 §Repo layout mandates the script "MUST be committed with the executable bit set".
  // hooks.json invokes it via `bash <path>` so a lost +x bit stays invisible to the SessionStart
  // hook, but a user following plugin/README.md's manual Codex instructions runs it directly and
  // gets "permission denied". Git tracks the bit, so a `chmod -x` regression would otherwise ship.
  it('exists and is committed executable', () => {
    expect(existsSync(BOOTSTRAP), 'plugin/scripts/bootstrap.sh must exist').toBe(true);
    // 0o111 = any of user/group/other execute.
    expect(statSync(BOOTSTRAP).mode & 0o111, 'bootstrap.sh must have the executable bit set').toBeGreaterThan(0);
  });

  // why: spec 01 §Runtime provisioning: "npm installs into ~/.design-lens/runtime/ MUST use the SAME
  // exact version pins as plugin/cli/package.json ... The pins appear as literals in bootstrap.sh; a
  // unit test SHOULD assert they match package.json." These two packages stay `external` to the tsup
  // bundle, so the bundle is compiled against package.json's versions but LOADS whatever bootstrap
  // installed. If the literals drift, every user gets a runtime silently mismatched from the bundle
  // (e.g. Playwright 1.61 API calls against a newer wire protocol) — a failure this test makes
  // impossible to commit. Deleting it re-opens that gap, which no other check covers.
  it.each(EXTERNAL_PINS)('pins %s to exactly the version in cli/package.json', (name) => {
    const want = deps()[name];
    expect(want, `${name} must be an exact (non-range) dependency`).toMatch(/^\d+\.\d+\.\d+$/);
    expect(script(), `bootstrap.sh must install ${name}@${want}`).toContain(`${name}@$`);
    // The literal is held in a shell variable, then interpolated into the npm install argument.
    const varName = name === 'playwright' ? 'PLAYWRIGHT_PIN' : 'ADBLOCKER_PIN';
    expect(script(), `${varName} must equal package.json's ${name} pin`).toContain(`${varName}="${want}"`);
  });

  // why: spec 01 is explicit that bootstrap "MUST exit 0 even when provisioning fails (never block
  // session start)". This hook runs on EVERY SessionStart in both tools; a non-zero exit degrades or
  // blocks the user's session for a failure (no network, no npm) that the CLI itself reports far more
  // clearly at run time. A bare `exit 1` is the single easiest regression to introduce here — and the
  // sealed gate cannot catch it, because I1 only ever exercises the SUCCESS path.
  it('never exits non-zero', () => {
    const exits = [...script().matchAll(/^\s*exit\s+(\d+)/gm)].map((m) => m[1]);
    expect(exits.length, 'bootstrap.sh must contain at least one explicit exit').toBeGreaterThan(0);
    expect(exits, 'every explicit exit in bootstrap.sh must be `exit 0`').toEqual(exits.map(() => '0'));
  });

  // why: regression lock on a bug this script actually had. With `set -E` (errtrace) the ERR trap is
  // inherited by command substitutions, so a failing `VERSION="$(node -p …)"` ran `fail`'s `exit 0`
  // *inside the subshell* — the outer assignment then saw SUCCESS, VERSION was empty, and bootstrap
  // marched on to provision a runtime and seal a `.installed-v-nodeNN` marker over it. The failure is
  // invisible on the happy path (which is all the sealed gate's I1 exercises), so only this test and
  // the guarded read below stand between us and a silently corrupt install.
  it('does not enable errtrace, and checks the manifest read explicitly', () => {
    const s = script();
    const setLine = /^set -[a-zA-Z]+ pipefail$/m.exec(s)?.[0];
    expect(setLine, 'bootstrap.sh must have a `set -… pipefail` line').toBeTruthy();
    expect(setLine, '`set -E` re-opens the subshell trap bug — the ERR trap must not be inherited').not.toContain('E');
    // The manifest read must be guarded by an `if !`, never left to the (subshell-blind) ERR trap.
    expect(s, 'the VERSION read must be explicitly checked, not left to the ERR trap').toMatch(
      /if ! VERSION="\$\(node -p/,
    );
    // `node -p` prints the literal string "undefined" and exits 0 when the key is missing.
    expect(s, 'an absent version field must be rejected, not baked into the marker').toContain('"undefined"');
  });

  // why: spec 01 §Runtime provisioning requires the failure path to print the actionable stderr
  // message AND requires bootstrap to honor DESIGN_LENS_HOME plus derive its plugin root from its own
  // location when CLAUDE_PLUGIN_ROOT is unset (the manual Codex invocation). Losing the ROOT fallback
  // makes `bash <cache>/scripts/bootstrap.sh` install into `/.design-lens`; losing DESIGN_LENS_HOME
  // breaks the sealed gate's temp-HOME isolation. Both fail silently for the person who wrote them.
  it('honors DESIGN_LENS_HOME, falls back for CLAUDE_PLUGIN_ROOT, and reports failures actionably', () => {
    const s = script();
    expect(s, 'DL_HOME must default DESIGN_LENS_HOME to $HOME/.design-lens').toContain(
      'DL_HOME="${DESIGN_LENS_HOME:-$HOME/.design-lens}"',
    );
    expect(s, 'ROOT must fall back to the script location when CLAUDE_PLUGIN_ROOT is unset').toContain(
      'ROOT="${CLAUDE_PLUGIN_ROOT:-',
    );
    expect(s, 'the failure path must print the spec-mandated actionable message').toContain(
      'design-lens setup failed:',
    );
  });

  // why: spec 01 pins the launcher's exact content and calls ~/.design-lens/bin/design-lens "the ONLY
  // executable path skills may reference" (ADR-004) — all five SKILL.md files hard-code it. The
  // launcher must re-resolve DESIGN_LENS_HOME at RUN time (not bake in bootstrap's value) and exec
  // the copied bundle. If the heredoc is edited to interpolate at write time, every skill invocation
  // breaks for anyone whose HOME differs between provisioning and use.
  it('writes a launcher that re-resolves DESIGN_LENS_HOME and execs the copied bundle', () => {
    const s = script();
    // A quoted heredoc delimiter is what prevents bootstrap-time expansion of the lines below.
    expect(s, "the launcher heredoc must be quoted ('LAUNCHER_EOF') so $DL_HOME is not expanded early)").toContain(
      "<<'LAUNCHER_EOF'",
    );
    expect(s).toContain('export NODE_PATH="$DL_HOME/runtime/node_modules${NODE_PATH:+:$NODE_PATH}"');
    expect(s).toContain('exec node "$DL_HOME/lib/design-lens.cjs" "$@"');
    expect(s, 'the launcher must be made executable — the gate checks -x on it').toContain('chmod +x "$LAUNCHER"');
  });

  // why: the version+node-major marker is what makes the fast path correct rather than merely fast.
  // Spec 01 §Marker semantics: a plugin update OR a Node major upgrade must retrigger full
  // provisioning, and step 8 must clear stale markers FIRST. Without the `rm -f`, an interrupted
  // upgrade leaves two markers and the fast path short-circuits on the OLD version's evidence,
  // permanently serving a stale bundle against a mismatched runtime.
  it('scopes the install marker to version + node major and clears stale markers first', () => {
    const s = script();
    expect(s, 'marker must be scoped to plugin version and node major').toContain(
      'MARKER="$DL_HOME/.installed-v$VERSION-node$NODE_MAJOR"',
    );
    const clear = s.indexOf('rm -f "$DL_HOME"/.installed-v*');
    const touch = s.indexOf('touch "$MARKER"');
    expect(clear, 'bootstrap.sh must clear stale markers').toBeGreaterThan(-1);
    expect(touch, 'bootstrap.sh must write the marker').toBeGreaterThan(-1);
    expect(clear, 'stale markers must be cleared BEFORE the new one is written').toBeLessThan(touch);
  });

  // why: hooks.json is the only thing that ever invokes this script automatically, and T25 learned
  // that `claude plugin validate --strict` hard-errors on a dangling hooks pointer. This asserts the
  // two halves still agree: the hook's command path must resolve to the file this suite is guarding.
  // If someone relocates scripts/, the hook silently stops provisioning and every skill 404s.
  it('is the file that hooks.json actually points at', () => {
    const hooks = readFileSync(HOOKS, 'utf8');
    const match = /bash \\"\$\{CLAUDE_PLUGIN_ROOT\}\/(.+?)\\"/.exec(hooks);
    expect(match, 'hooks.json must invoke bash "${CLAUDE_PLUGIN_ROOT}/<path>"').not.toBeNull();
    const pointed = path.join(PLUGIN, match![1]);
    expect(pointed, 'the SessionStart hook must point at plugin/scripts/bootstrap.sh').toBe(BOOTSTRAP);
    expect(existsSync(pointed), 'the hook target must exist').toBe(true);
  });
});
