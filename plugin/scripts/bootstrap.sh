#!/usr/bin/env bash
#
# design-lens runtime provisioner.
#
# Invoked as the SessionStart hook declared in plugin/hooks/hooks.json:
#     bash "${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh"
# and equally supported as a manual invocation (Codex skips untrusted plugin hooks until the
# user trusts them via /hooks):
#     bash <plugin-cache-dir>/scripts/bootstrap.sh
#
# Both tools copy the plugin into a version-suffixed cache whose path changes on every update,
# and neither runs npm postinstall — so the durable runtime lives at the well-known
# ~/.design-lens/ (ADR-007) and this script is what puts it there.
#
# Contract (specs/01-packaging.md §Runtime provisioning):
#   * idempotent; the fast path exits well under 1 s because this runs on EVERY session start
#   * ALWAYS exits 0 — a provisioning failure must never block session start, so on any error we
#     print an actionable message to stderr and exit 0. The CLI emits its own clear error if
#     Playwright/Chromium turn out to be missing at run time (src/lib/runtime-deps.ts).
#   * all human-facing progress goes to stderr (stdout is reserved for machine JSON repo-wide)
#
# NOTE: deliberately NOT `set -E`. With errtrace on, the ERR trap below is inherited by command
# substitutions, so a failing `$(node -p …)` would run the trap *inside the subshell* — `exit 0`
# there merely ends the subshell, handing the outer assignment a SUCCESS status and an empty value,
# and the script would sail on to provision a runtime under a bogus version. Without -E, the
# substitution's non-zero status reaches the parent, where errexit fires the trap for real.
set -euo pipefail

# CLAUDE_PLUGIN_ROOT is exported to hook processes by BOTH tools. Falling back to the script's own
# location keeps the manual invocation above working.
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DL_HOME="${DESIGN_LENS_HOME:-$HOME/.design-lens}"

# Exact pins, mirroring plugin/cli/package.json dependencies. The bundle keeps these two packages
# `external` (tsup.config.ts), so they must exist in the runtime prefix at the SAME versions the
# bundle was built against. test/unit/bootstrap.test.ts fails if these literals ever drift.
PLAYWRIGHT_PIN="1.61.1"
ADBLOCKER_PIN="2.18.1"

# `STEP` names whatever we are currently doing, so the ERR trap can report an actionable cause
# instead of a bare line number. Every step below re-points it before doing its work.
STEP="initializing"

say() { printf 'design-lens: %s\n' "$1" >&2; }

fail() {
  printf 'design-lens setup failed: %s. Run `bash %s/scripts/bootstrap.sh` manually.\n' \
    "$1" "$ROOT" >&2
  exit 0 # never block session start
}

# Catch-all for the top-level commands (mkdir/cp/npm/playwright/touch): any non-zero status trips
# errexit, which fires this trap in the parent shell and turns the failure into an actionable
# message + exit 0. Bash suppresses both errexit and the ERR trap for commands inside an
# `if`/`&&`/`||` condition, which is exactly why the probing helpers below (`cmp -s`, `pin_ok`) and
# the checked reads may return non-zero without tripping it.
trap 'fail "$STEP"' ERR

# node is a hard prerequisite of both host tools; npm ships with it. Check explicitly so the
# failure message names the missing tool rather than a cryptic "command not found".
command -v node >/dev/null 2>&1 || fail "node was not found on PATH"
command -v npm >/dev/null 2>&1 || fail "npm was not found on PATH"

# --- 1. Identify what "provisioned" means for this plugin version + node major ----------------
# node (not jq) reads the manifest: node is guaranteed present, jq is not.
MANIFEST="$ROOT/.claude-plugin/plugin.json"
STEP="reading $MANIFEST"
# Checked explicitly rather than left to the ERR trap: the trap cannot see a failure that happens
# inside a command substitution (see the `set -E` note above). node's own stack trace is suppressed
# because our message already names the file and the remedy.
if ! VERSION="$(node -p 'require(process.argv[1]).version' "$MANIFEST" 2>/dev/null)"; then
  fail "cannot read the plugin manifest at $MANIFEST"
fi
# `node -p` prints the string "undefined" and exits 0 when the key is absent — which would otherwise
# seal a `.installed-vundefined-nodeNN` marker over a half-provisioned runtime.
if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  fail "no \"version\" field in $MANIFEST"
fi

# `node -v` prints e.g. v24.3.0; the marker is scoped to the major (v24) so that a Node upgrade
# retriggers a full reinstall — native modules and browser builds are not portable across majors.
NODE_MAJOR="$(node -v | cut -d. -f1)"
MARKER="$DL_HOME/.installed-v$VERSION-node$NODE_MAJOR"

BUNDLE_SRC="$ROOT/cli/dist/design-lens.cjs"
BUNDLE_DST="$DL_HOME/lib/design-lens.cjs"
LAUNCHER="$DL_HOME/bin/design-lens"

# --- 2. Fast path ------------------------------------------------------------------------------
# Already provisioned for this version+major: the only thing that can legitimately have changed is
# the bundle itself (a developer running `npm run build` against a --plugin-dir checkout), so
# refresh it when the bytes differ and get out. No node_modules stat, no npm, no browser check.
if [ -f "$MARKER" ] && [ -x "$LAUNCHER" ]; then
  STEP="refreshing $BUNDLE_DST"
  if [ -f "$BUNDLE_SRC" ] && ! cmp -s "$BUNDLE_SRC" "$BUNDLE_DST"; then
    cp "$BUNDLE_SRC" "$BUNDLE_DST"
    say "refreshed CLI bundle"
  fi
  exit 0
fi

say "provisioning runtime $VERSION into $DL_HOME (first run downloads Chromium)…"

# --- 3. Layout ---------------------------------------------------------------------------------
STEP="creating $DL_HOME"
mkdir -p "$DL_HOME"/{bin,lib,runtime,cache}

# --- 4. Install the committed single-file CJS bundle -------------------------------------------
STEP="copying the CLI bundle from $BUNDLE_SRC"
[ -f "$BUNDLE_SRC" ] || fail "CLI bundle missing at $BUNDLE_SRC"
cp "$BUNDLE_SRC" "$BUNDLE_DST"

# --- 5. Runtime dependencies (kept external to the bundle) -------------------------------------
# Returns 0 only when <pkg> is present in the runtime prefix at exactly <version>.
pin_ok() {
  local pj="$DL_HOME/runtime/node_modules/$1/package.json"
  [ -f "$pj" ] || return 1
  local have
  have="$(node -p 'require(process.argv[1]).version' "$pj" 2>/dev/null)" || return 1
  [ "$have" = "$2" ]
}

if pin_ok playwright "$PLAYWRIGHT_PIN" && pin_ok @ghostery/adblocker-playwright "$ADBLOCKER_PIN"; then
  say "runtime dependencies already at pinned versions"
else
  STEP="installing playwright@$PLAYWRIGHT_PIN and @ghostery/adblocker-playwright@$ADBLOCKER_PIN"
  say "$STEP"
  # stdout → stderr: npm chatter is human progress, and stdout is the machine-JSON channel.
  npm install --prefix "$DL_HOME/runtime" --no-audit --no-fund \
    "playwright@$PLAYWRIGHT_PIN" "@ghostery/adblocker-playwright@$ADBLOCKER_PIN" >&2
fi

# --- 6. Chromium -------------------------------------------------------------------------------
# Idempotent (a present, matching build is a no-op) and honors PLAYWRIGHT_BROWSERS_PATH, which is
# how the sealed gate shares one browser cache across temp HOMEs instead of re-downloading.
PW_BIN="$DL_HOME/runtime/node_modules/.bin/playwright"
STEP="installing the Chromium browser"
[ -x "$PW_BIN" ] || fail "playwright CLI missing at $PW_BIN after install"
say "ensuring Chromium is installed…"
"$PW_BIN" install chromium >&2

# --- 7. Launcher -------------------------------------------------------------------------------
# The ONLY executable path skills may reference (ADR-004). It re-resolves DESIGN_LENS_HOME at run
# time rather than baking in this run's value, so the same launcher works if $HOME later differs.
# NODE_PATH is a best-effort hint only — the bundle's loadRuntimeDep() does an explicit-path
# require against $DL_HOME/runtime/node_modules when bare resolution fails (ADR-007).
STEP="writing the launcher at $LAUNCHER"
cat > "$LAUNCHER" <<'LAUNCHER_EOF'
#!/usr/bin/env bash
DL_HOME="${DESIGN_LENS_HOME:-$HOME/.design-lens}"
export NODE_PATH="$DL_HOME/runtime/node_modules${NODE_PATH:+:$NODE_PATH}"
exec node "$DL_HOME/lib/design-lens.cjs" "$@"
LAUNCHER_EOF
chmod +x "$LAUNCHER"

# --- 8. Seal this version+major as provisioned -------------------------------------------------
# Clear stale markers FIRST so an interrupted upgrade can never leave two markers behind, which
# would let the fast path short-circuit on an older version's evidence.
STEP="writing the install marker"
rm -f "$DL_HOME"/.installed-v*
touch "$MARKER"
printf 'design-lens %s ready\n' "$VERSION" >&2
