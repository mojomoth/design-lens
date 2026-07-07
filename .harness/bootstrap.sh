#!/usr/bin/env bash
# One-time harness setup. Idempotent — safe to re-run (re-running RE-SEALS .harness/, which is
# how a human legitimately edits config.env or guardrails.md between runs).
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HARNESS/.." && pwd)"; cd "$ROOT"
# shellcheck source=/dev/null
source "$HARNESS/config.env"
SEAL_DIR="$HOME/.design-lens-harness/$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-16)"

echo "== Design Lens harness bootstrap =="

# 1. toolchain sanity
for c in git node npx claude curl shasum; do
  command -v "$c" >/dev/null || { echo "FATAL: $c not found"; exit 1; }
done
node -e 'process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)' \
  || { echo "FATAL: need Node >= 20 (have $(node -v))"; exit 1; }
echo "node:   $(node -v)"
echo "claude: $(claude --version 2>/dev/null | head -n1)"
command -v codex >/dev/null && echo "codex:  $(codex --version 2>/dev/null | head -n1)" \
  || echo "codex:  absent (ok — ENGINE=claude; install Codex CLI later for the codex leg)"
# bash version note: harness scripts are written for stock macOS bash 3.2; nothing needs bash 4.
echo "bash:   $BASH_VERSION"

# 2. git init + baseline commit on main
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -b main
git add -A
git diff --cached --quiet || git commit -m "chore: design-lens harness scaffolding"

# 3. working branch (the loop refuses to run on main)
git checkout -B "$RALPH_BRANCH"

# 4. Playwright Chromium pre-download (pinned; agents never run 'playwright install' themselves)
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
echo "== provisioning Chromium (playwright@$PLAYWRIGHT_VERSION → $PLAYWRIGHT_BROWSERS_PATH) =="
npx -y "playwright@$PLAYWRIGHT_VERSION" install chromium

# 5. fixture self-test: boots both ports, self-fetches every asset
echo "== fixture self-test =="
node "$HARNESS/fixture/serve.mjs" --check --port "$FIXTURE_PORT" --alt-port "$FIXTURE_ALT_PORT"

# 6. seal .harness/ — manifest in-repo AND an out-of-repo copy (defeats manifest regeneration)
( cd "$ROOT" && find .harness -type f \
    ! -path '.harness/logs/*' ! -path '.harness/status/*' ! -name integrity.sha256 \
    | LC_ALL=C sort | xargs shasum -a 256 ) > "$HARNESS/integrity.sha256"
mkdir -p "$SEAL_DIR" "$HARNESS/logs" "$HARNESS/status"
cp "$HARNESS/integrity.sha256" "$SEAL_DIR/integrity.sha256"
echo "sealed: $(wc -l < "$HARNESS/integrity.sha256" | tr -d ' ') files (copy: $SEAL_DIR)"

# 7. commit the seal + baseline tag for all diff-based governance checks
git add -A
git diff --cached --quiet || git commit -m "chore: bootstrap (integrity manifest)"
git tag -f bootstrap

echo
echo "== bootstrap OK =="
echo "next:  ./.harness/ralph.sh plan     (planning loop with 3-critic debate)"
echo "then:  ./.harness/ralph.sh build    (build loop; monitor: ./.harness/ralph.sh status)"
