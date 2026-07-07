#!/usr/bin/env bash
# The programmatic gate. Sealed — the agent can never edit this (integrity-checked by ralph.sh).
# Modes:
#   (none)     iteration backpressure: strict on what exists, SKIP on what doesn't yet
#   --plan     plan lint only (task grammar, coverage, critic verdicts)
#   --strict   completion gate: every check REQUIRED (SKIP becomes FAIL)
#   --install  slow install-stage checks (bootstrap in temp HOME, dual-tool install)
# Compatible with macOS stock bash 3.2 (no globstar/compgen -G "**").
set -uo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HARNESS/.." && pwd)"; cd "$ROOT"
# shellcheck source=/dev/null
source "$HARNESS/config.env"

STRICT=0; PLAN=0; INSTALL=0
case "${1:-}" in
  --strict) STRICT=1 ;;
  --plan) PLAN=1 ;;
  --install) INSTALL=1 ;;
esac

LOGDIR="${RALPH_RUN_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/dl-verify.XXXXXX")}"
FAIL=0
ok(){ printf 'PASS %-4s %s\n' "$1" "$2"; }
bad(){ printf 'FAIL %-4s %s\n' "$1" "$2"; FAIL=1; }
skip(){ if [ "$STRICT" = 1 ]; then bad "$1" "REQUIRED but missing: $2"; else printf 'SKIP %-4s %s\n' "$1" "$2"; fi; }
PLANF=.agentdocs/IMPLEMENTATION_PLAN.md
CLI_DIR=plugin/cli

# ============================================================ PLAN LINT
plan_lint(){
  local fail=0
  pok(){ printf 'PASS %-4s %s\n' "$1" "$2"; }
  pbad(){ printf 'FAIL %-4s %s\n' "$1" "$2"; fail=1; }
  [ -f "$PLANF" ] || { pbad P1 "missing $PLANF"; return 1; }
  local T NOAC NOSPEC s
  T=$(grep -cE '^- \[[ x]\] T[0-9]+ \(P[1-3]\) ' "$PLANF" || true)
  [ "$T" -ge "$MIN_PLAN_TASKS" ] && pok P2 "$T tasks" || pbad P2 "only $T tasks (< $MIN_PLAN_TASKS)"
  NOAC=$(grep -E '^- \[[ x]\] T[0-9]+ ' "$PLANF" | grep -vc '| AC: ' || true)
  [ "$NOAC" -eq 0 ] && pok P3 "every task has an AC" || pbad P3 "$NOAC tasks missing '| AC:'"
  NOSPEC=$(grep -E '^- \[[ x]\] T[0-9]+ ' "$PLANF" | grep -vc '| Spec: ' || true)
  [ "$NOSPEC" -eq 0 ] && pok P4 "every task cites a spec" || pbad P4 "$NOSPEC tasks missing '| Spec:'"
  for s in .agentdocs/specs/*.md; do
    grep -q "$(basename "$s")" "$PLANF" || pbad P5 "spec $(basename "$s") not covered by any task"
  done
  grep -qE '^## Deferred' "$PLANF" && pok P6 "deferred section" || pbad P6 "missing '## Deferred' section"
  grep -qE '^## Planning log' "$PLANF" && pok P7 "planning log" || pbad P7 "missing '## Planning log'"
  grep -qE 'VERDICT: APPROVE \(feasibility' "$PLANF" \
    && grep -qE 'VERDICT: APPROVE \(simplicity' "$PLANF" \
    && grep -qE 'VERDICT: APPROVE \(verification' "$PLANF" \
    && pok P8 "all three critics approved" || pbad P8 "planning log lacks the three 'VERDICT: APPROVE (<perspective>' lines"
  return $fail
}
if [ "$PLAN" = 1 ]; then plan_lint; exit $?; fi

# ============================================================ INSTALL STAGE (slow; separate mode)
if [ "$INSTALL" = 1 ]; then
  # I1 plugin bootstrap in a temp HOME (browser cache shared to avoid re-downloading Chromium)
  if [ -f plugin/scripts/bootstrap.sh ]; then
    TH="$(mktemp -d "${TMPDIR:-/tmp}/dl-home.XXXXXX")"
    export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
    if HOME="$TH" bash plugin/scripts/bootstrap.sh > "$LOGDIR/i1.log" 2>&1 \
       && [ -x "$TH/.design-lens/bin/design-lens" ] \
       && HOME="$TH" "$TH/.design-lens/bin/design-lens" --version >/dev/null 2>&1; then
      ok I1 "plugin bootstrap provisions ~/.design-lens"
      T0=$(date +%s); HOME="$TH" bash plugin/scripts/bootstrap.sh >/dev/null 2>&1; T1=$(date +%s)
      [ $((T1 - T0)) -le 5 ] && ok I2 "bootstrap fast path ($((T1 - T0))s)" || bad I2 "bootstrap fast path took $((T1 - T0))s (> 5s)"
    else bad I1 "plugin bootstrap failed: $(tail -n 15 "$LOGDIR/i1.log")"; fi
    rm -rf "$TH"
  else bad I1 "plugin/scripts/bootstrap.sh missing"; fi
  # I3 claude plugin-dir smoke
  if command -v claude >/dev/null; then
    claude --plugin-dir ./plugin -p "reply with exactly: ok" > "$LOGDIR/i3.log" 2>&1 \
      && ok I3 "claude --plugin-dir smoke" || bad I3 "claude --plugin-dir smoke failed: $(tail -n 5 "$LOGDIR/i3.log")"
  else bad I3 "claude CLI not found"; fi
  # I4 sandboxed claude marketplace install
  if command -v claude >/dev/null; then
    CC="$(mktemp -d "${TMPDIR:-/tmp}/dl-cc.XXXXXX")"
    if CLAUDE_CONFIG_DIR="$CC" claude plugin marketplace add "$ROOT" > "$LOGDIR/i4.log" 2>&1 \
       && CLAUDE_CONFIG_DIR="$CC" claude plugin install design-lens@design-lens >> "$LOGDIR/i4.log" 2>&1; then
      ok I4 "claude marketplace install"
    else bad I4 "claude marketplace install failed: $(tail -n 10 "$LOGDIR/i4.log")"; fi
    rm -rf "$CC"
  fi
  # I5 codex leg — DEMOTES to warning on failure (pre-agreed: never executed on this machine)
  if command -v codex >/dev/null; then
    CH="$(mktemp -d "${TMPDIR:-/tmp}/dl-codex.XXXXXX")"
    if CODEX_HOME="$CH" codex plugin marketplace add "$ROOT" > "$LOGDIR/i5.log" 2>&1 \
       && CODEX_HOME="$CH" codex plugin add design-lens >> "$LOGDIR/i5.log" 2>&1 \
       && CODEX_HOME="$CH" codex plugin list 2>/dev/null | grep -q design-lens; then
      ok I5 "codex marketplace install"
    else printf 'WARN %-4s %s\n' I5 "codex install could not be verified (demoted to manual check — see FINAL_REPORT)"; fi
    rm -rf "$CH"
  else printf 'WARN %-4s %s\n' I5 "codex CLI absent — manual check required"; fi
  [ "$FAIL" = 0 ] && echo "VERIFY: INSTALL STAGE GREEN" || echo "VERIFY: INSTALL FAILURES ABOVE"
  exit $FAIL
fi

# ============================================================ B: ALWAYS-ON BACKPRESSURE
# B0 harness seal — in-repo manifest AND out-of-repo copy must agree (defeats regenerate-the-manifest)
SEAL_DIR="$HOME/.design-lens-harness/$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-16)"
if [ -f "$HARNESS/integrity.sha256" ]; then
  if (cd "$ROOT" && shasum -a 256 -c "$HARNESS/integrity.sha256" --status 2>/dev/null); then
    if [ -f "$SEAL_DIR/integrity.sha256" ]; then
      cmp -s "$HARNESS/integrity.sha256" "$SEAL_DIR/integrity.sha256" \
        && ok B0 ".harness sealed (both manifests agree)" \
        || bad B0 "in-repo integrity.sha256 differs from the out-of-repo copy — manifest was regenerated"
    else ok B0 ".harness sealed (no out-of-repo copy yet — run bootstrap)"; fi
  else bad B0 ".harness/ files were modified — forbidden"; fi
else skip B0 "integrity.sha256 (run bootstrap)"; fi

# B1 doc governance — seeded ADRs intact; post-plan spec drift requires new ADRs naming the files
ADR_OK=1
for a in ADR-001 ADR-002 ADR-003 ADR-004 ADR-005 ADR-006 ADR-007 ADR-008 ADR-009; do
  grep -q "$a" .agentdocs/DECISIONS.md 2>/dev/null || { bad B1 "seeded $a removed from DECISIONS.md"; ADR_OK=0; }
done
if git rev-parse -q --verify plan-complete >/dev/null 2>&1; then
  DRIFT=$(git diff --name-only plan-complete..HEAD -- \
    .agentdocs/specs .agentdocs/ARCHITECTURE.md .agentdocs/ACCEPTANCE.md .agentdocs/CONVENTIONS.md 2>/dev/null || true)
  if [ -n "$DRIFT" ]; then
    NEW_ADRS=$(grep -cE '^## ADR-[0-9]+' .agentdocs/DECISIONS.md 2>/dev/null || echo 0)
    if [ "$NEW_ADRS" -le 9 ]; then
      bad B1 "protected docs drifted since plan-complete with no new ADR: $(echo "$DRIFT" | tr '\n' ' ')"
    else
      UNJUSTIFIED=""
      for f in $DRIFT; do
        grep -q "$(basename "$f")" .agentdocs/DECISIONS.md || UNJUSTIFIED="$UNJUSTIFIED $f"
      done
      [ -z "$UNJUSTIFIED" ] && ok B1 "spec drift covered by ADRs" \
        || bad B1 "drifted files not named in any ADR:$UNJUSTIFIED"
    fi
  else [ "$ADR_OK" = 1 ] && ok B1 "doc governance intact"; fi
else [ "$ADR_OK" = 1 ] && ok B1 "doc governance intact (pre-plan phase)"; fi

# B2 repo hygiene
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git ls-files | grep -q 'node_modules/' && bad B2 "node_modules committed" || ok B2 "no node_modules tracked"
  git grep -nE '^(<{7} |>{7} )' -- ':!.harness' >/dev/null 2>&1 && bad B2b "merge-conflict markers present" || ok B2b "no conflict markers"
  BIG=$(git ls-files | while IFS= read -r f; do
    [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 2097152 ] && echo "$f"
  done | grep -v '^\.harness/fixture' || true)
  [ -z "$BIG" ] && ok B2c "no oversized files" || bad B2c "files >2MB: $BIG"
else skip B2 "git repo (run bootstrap)"; fi

# B3 placeholder hunt (allowlist is sealed; blank lines stripped so grep -vFf can't be neutered)
if [ -d "$CLI_DIR/src" ] || [ -d plugin/skills ] || [ -d plugin/scripts ]; then
  ALLOW="$LOGDIR/allow.txt"; grep -v '^[[:space:]]*$' "$HARNESS/placeholder-allowlist.txt" > "$ALLOW" 2>/dev/null || : > "$ALLOW"
  HITS=$(grep -rniE 'TODO|FIXME|XXX\b|PLACEHOLDER|not implemented|NotImplemented|throw new Error\((["'"'"'])(todo|unimplemented)' \
        "$CLI_DIR/src" plugin/scripts plugin/skills 2>/dev/null | { [ -s "$ALLOW" ] && grep -vFf "$ALLOW" || cat; } || true)
  [ -z "$HITS" ] && ok B3 "no placeholders" || bad B3 "placeholders found:
$HITS"
else skip B3 "plugin sources"; fi

# B4 test integrity: no skip/only + ratchet counted from the ralph-last-green TREE (not a writable file)
TEST_FILES=$(find "$CLI_DIR/test" -type f \( -name '*.test.*' -o -name '*.spec.*' \) 2>/dev/null || true)
if [ -n "$TEST_FILES" ]; then
  SK=$(echo "$TEST_FILES" | xargs grep -nE '\.(skip|only|todo)\(|xit\(|xdescribe\(' 2>/dev/null || true)
  [ -z "$SK" ] && ok B4 "no skipped/only tests" || bad B4 "skipped/only tests:
$SK"
  N=$(echo "$TEST_FILES" | xargs grep -hoE '(^|[^a-zA-Z.])(it|test)\(' 2>/dev/null | wc -l | tr -d ' ')
  if git rev-parse -q --verify ralph-last-green >/dev/null 2>&1; then
    PREV=$(git grep -hoE '(^|[^a-zA-Z.])(it|test)\(' ralph-last-green -- "$CLI_DIR/test" 2>/dev/null | wc -l | tr -d ' ')
  else PREV=0; fi
  [ "$N" -ge "$PREV" ] && ok B4b "test count $N (ratchet $PREV at last green)" || bad B4b "test count DROPPED: $N < $PREV (last green)"
else skip B4 "tests"; fi

# B5 deps install (only when out of date)
if [ -f "$CLI_DIR/package.json" ]; then
  if [ ! -d "$CLI_DIR/node_modules" ] || [ "$CLI_DIR/package-lock.json" -nt "$CLI_DIR/node_modules/.package-lock.json" ]; then
    ( cd "$CLI_DIR" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } ) > "$LOGDIR/b5.log" 2>&1 \
      && ok B5 "deps installed" || bad B5 "npm install failed: $(tail -n 10 "$LOGDIR/b5.log")"
  else ok B5 "deps up to date"; fi
else skip B5 "package.json"; fi

# B6-B9 code gates, cheap → expensive, fail-fast
if [ -f "$CLI_DIR/tsconfig.json" ]; then
  ( cd "$CLI_DIR" && npx tsc --noEmit ) > "$LOGDIR/b6.log" 2>&1 \
    && ok B6 "tsc" || bad B6 "tsc: $(tail -n 15 "$LOGDIR/b6.log")"
else skip B6 "tsconfig.json"; fi
if find "$CLI_DIR" -maxdepth 1 -name 'eslint.config.*' 2>/dev/null | grep -q .; then
  ( cd "$CLI_DIR" && npx eslint . --max-warnings 0 ) > "$LOGDIR/b7.log" 2>&1 \
    && ok B7 "eslint" || bad B7 "eslint: $(tail -n 15 "$LOGDIR/b7.log")"
else skip B7 "eslint config"; fi
if [ -f "$CLI_DIR/package.json" ] && grep -q '"test"' "$CLI_DIR/package.json"; then
  if [ "$FAIL" = 0 ]; then
    ( cd "$CLI_DIR" && npm run -s test ) > "$LOGDIR/b8.log" 2>&1 \
      && ok B8 "unit tests" || bad B8 "unit: $(tail -n 25 "$LOGDIR/b8.log")"
  else bad B8 "skipped — earlier gates failed"; fi
else skip B8 "npm test script"; fi
if [ -f "$CLI_DIR/package.json" ] && grep -q '"e2e"' "$CLI_DIR/package.json"; then
  if [ "$FAIL" = 0 ]; then
    ( cd "$CLI_DIR" && npm run -s e2e ) > "$LOGDIR/b9.log" 2>&1 \
      && ok B9 "own e2e suite" || bad B9 "e2e: $(tail -n 40 "$LOGDIR/b9.log")"
  else bad B9 "skipped — earlier gates failed"; fi
else skip B9 "npm e2e script"; fi

# B10 SEALED fixture assertions (the agent cannot game these) — spine level every iteration
if [ -f "$CLI_DIR/dist/design-lens.cjs" ]; then
  if [ "$FAIL" = 0 ]; then
    bash "$HARNESS/e2e-assert.sh" --m1 > "$LOGDIR/b10.log" 2>&1 \
      && ok B10 "sealed fixture spine (--m1)" || bad B10 "sealed e2e: $(grep '^FAIL' "$LOGDIR/b10.log" | head -n 10)"
  else bad B10 "skipped — earlier gates failed"; fi
else skip B10 "dist bundle"; fi

# ============================================================ S: STRICT-ONLY (completion)
if [ "$STRICT" = 1 ]; then
  # S1 plan honest & finished (defeats blank-the-plan)
  if plan_lint > "$LOGDIR/s1.log" 2>&1; then
    DONE=$(grep -cE '^- \[x\] T[0-9]+ \(P[1-3]\) ' "$PLANF" || true)
    OPEN=$(awk '/^## Deferred/{exit} /^- \[ \] T[0-9]+/{n++} END{print n+0}' "$PLANF" 2>/dev/null || echo 99)
    [ "$DONE" -ge "$MIN_PLAN_TASKS" ] && [ "$OPEN" -eq 0 ] \
      && ok S1 "plan finished ($DONE done, 0 open)" || bad S1 "plan not finished (done=$DONE need>=$MIN_PLAN_TASKS, open=$OPEN)"
  else bad S1 "plan lint fails: $(grep '^FAIL' "$LOGDIR/s1.log")"; fi
  # S2 sealed full-fidelity e2e
  bash "$HARNESS/e2e-assert.sh" --all > "$LOGDIR/s2.log" 2>&1 \
    && ok S2 "sealed fixture full fidelity (--all)" || bad S2 "sealed e2e --all: $(grep '^FAIL' "$LOGDIR/s2.log" | head -n 10)"
  # S3 plugin validity + manifests parse
  if command -v claude >/dev/null; then
    claude plugin validate ./plugin --strict > "$LOGDIR/s3.log" 2>&1 \
      && ok S3 "claude plugin validate --strict" || bad S3 "validate: $(tail -n 15 "$LOGDIR/s3.log")"
  else bad S3 "claude CLI not found"; fi
  for f in plugin/.claude-plugin/plugin.json plugin/.codex-plugin/plugin.json \
           .claude-plugin/marketplace.json .agents/plugins/marketplace.json; do
    if [ -f "$f" ] && node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
      ok S3b "$f"
    else bad S3b "$f missing or invalid JSON"; fi
  done
  # S4 version lock
  V1=$(node -e "console.log(JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json','utf8')).version||'')" 2>/dev/null || echo A)
  V2=$(node -e "console.log(JSON.parse(require('fs').readFileSync('plugin/.codex-plugin/plugin.json','utf8')).version||'')" 2>/dev/null || echo B)
  V3=$(node "$CLI_DIR/dist/design-lens.cjs" --version 2>/dev/null | tr -d '[:space:]' || echo C)
  [ -n "$V1" ] && [ "$V1" = "$V2" ] && [ "$V1" = "$V3" ] \
    && ok S4 "version lock ($V1)" || bad S4 "version mismatch: claude=$V1 codex=$V2 cli=$V3"
  # S5 dist fresh & reproducible
  if grep -q '"build"' "$CLI_DIR/package.json" 2>/dev/null; then
    ( cd "$CLI_DIR" && npm run -s build ) > "$LOGDIR/s5.log" 2>&1 \
      && git diff --quiet -- "$CLI_DIR/dist" \
      && ok S5 "dist committed & fresh" || bad S5 "dist stale vs npm run build (or build failed)"
  else bad S5 "no build script"; fi
  # S6 skill portability
  for s in clone-reference reverse-design inspect-elements customize-clone build-from-design; do
    F="plugin/skills/$s/SKILL.md"
    if [ ! -f "$F" ]; then bad S6 "missing $F"; continue; fi
    head -n 20 "$F" | grep -q '^name:' && head -n 20 "$F" | grep -q '^description:' \
      || bad S6 "$F lacks name/description frontmatter"
    if grep -nE '\$ARGUMENTS|\$[0-9]|!`|\{\{|CLAUDE_PLUGIN_ROOT' "$F" >/dev/null; then
      bad S6 "$F uses placeholders/plugin-root (breaks Codex)"
    else ok S6 "$F portable"; fi
  done
  # S7 templates
  TPL=plugin/skills/reverse-design/templates/DESIGN.template.md
  if [ -f "$TPL" ]; then
    MISSING_H=""
    for h in "First Impression" "Design Intent" "Layout & Grid" "Visual Hierarchy" "Typography" \
             "Color System" "Imagery & Iconography" "Motion & Interaction" "Component Patterns" \
             "Signature Moves" "What NOT to Copy" "Reusable Principles"; do
      grep -q "$h" "$TPL" || MISSING_H="$MISSING_H|$h"
    done
    [ -z "$MISSING_H" ] && ok S7 "DESIGN template headings" || bad S7 "DESIGN.template.md missing:$MISSING_H"
  else bad S7 "$TPL missing"; fi
  grep -q '## Variation' plugin/skills/reverse-design/templates/VARIATIONS.template.md 2>/dev/null \
    && ok S7b "VARIATIONS template" || bad S7b "VARIATIONS.template.md missing '## Variation'"
  # S8 ethics
  for s in customize-clone build-from-design; do
    grep -q '## Before you ship — brand checklist' "plugin/skills/$s/SKILL.md" 2>/dev/null \
      && ok S8 "$s brand checklist" || bad S8 "plugin/skills/$s/SKILL.md missing brand checklist heading"
  done
  # S9 docs
  grep -qi 'plugin marketplace add' README.md 2>/dev/null && grep -qi 'codex plugin marketplace add' README.md 2>/dev/null \
    && ok S9 "README dual-install docs" || bad S9 "README missing install docs for both tools"
  [ -f plugin/README.md ] && [ -f plugin/NOTICE.md ] && ok S9b "plugin README + NOTICE" || bad S9b "plugin/README.md or plugin/NOTICE.md missing"
  [ -s .agentdocs/PROGRESS.md ] && ok S10 "PROGRESS non-empty" || bad S10 "PROGRESS.md empty"
fi

[ "$FAIL" = 0 ] && echo "VERIFY: ALL GREEN$([ "$STRICT" = 1 ] && echo ' (STRICT)')" || echo "VERIFY: FAILURES ABOVE"
exit $FAIL
