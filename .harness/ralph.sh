#!/usr/bin/env bash
# Design Lens autonomous harness — the Ralph loop.
# Fresh agent context per iteration; all memory on disk (git + .agentdocs/).
# Usage: ralph.sh plan [N] | build [N] | resume | status | verify
# Exit:  0 complete | 1 max-iterations/cost-cap | 2 stuck/stopped/interrupted | 3 precondition | 4 integrity
set -uo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HARNESS/.." && pwd)"; cd "$ROOT"
# shellcheck source=/dev/null
source "$HARNESS/config.env"
STATUS_DIR="$HARNESS/status"; LOGS_DIR="$HARNESS/logs"
STATE="$STATUS_DIR/state.env"; FEEDBACK="$STATUS_DIR/verify-feedback.md"
SEAL_DIR="$HOME/.design-lens-harness/$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-16)"
die(){ echo "ralph: FATAL: $*" >&2; exit 3; }

MODE="${1:-}"; ARG2="${2:-}"
case "$MODE" in
  status) cat "$STATUS_DIR/STATUS.md" 2>/dev/null || echo "no run yet"; exit 0 ;;
  verify) exec bash "$HARNESS/verify.sh" --strict ;;
  plan|build|resume) ;;
  *) die "usage: ralph.sh plan|build|resume|status|verify [max-iterations]" ;;
esac

# ---------------- preconditions ----------------
for c in git node claude curl shasum; do command -v "$c" >/dev/null || die "$c not found"; done
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repo — run .harness/bootstrap.sh first"
[ "$(git rev-parse --show-toplevel)" = "$ROOT" ] || die "must run from the design-lens repo root"
git rev-parse -q --verify bootstrap >/dev/null || die "missing 'bootstrap' tag — run .harness/bootstrap.sh"
[ -f "$HARNESS/integrity.sha256" ] || die "missing integrity manifest — run .harness/bootstrap.sh"
[ -f "$SEAL_DIR/integrity.sha256" ] || die "missing out-of-repo seal copy — run .harness/bootstrap.sh"
BRANCH="$(git branch --show-current)"
case "$BRANCH" in main|master|"") die "refusing to run on branch '$BRANCH' — bootstrap creates '$RALPH_BRANCH'";; esac
if [ "$MODE" = build ]; then
  bash "$HARNESS/verify.sh" --plan >/dev/null 2>&1 \
    || die "IMPLEMENTATION_PLAN.md does not pass the plan lint — run './.harness/ralph.sh plan' first"
fi
[ "$ENGINE" = codex ] && { [ -f "$HARNESS/codex.sh" ] || die "codex.sh missing"; }
mkdir -p "$STATUS_DIR" "$LOGS_DIR"; rm -f "$HARNESS/STOP"

# never start from an uncommitted state
if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A && git commit -qm "wip(ralph): auto-commit dirty tree before run"
fi

check_integrity(){
  local in_repo_ok=1
  (cd "$ROOT" && shasum -a 256 -c "$HARNESS/integrity.sha256" --status 2>/dev/null) || in_repo_ok=0
  cmp -s "$HARNESS/integrity.sha256" "$SEAL_DIR/integrity.sha256" || in_repo_ok=0
  if [ "$in_repo_ok" = 0 ]; then
    echo "ralph: .harness/ was modified — restoring from the bootstrap tag and aborting" >&2
    git checkout bootstrap -- .harness 2>/dev/null || true
    cp "$SEAL_DIR/integrity.sha256" "$HARNESS/integrity.sha256" 2>/dev/null || true
    write_final_report INTEGRITY_VIOLATION
    exit 4
  fi
}

# ---------------- run bookkeeping ----------------
if [ "$MODE" = resume ]; then
  [ -f "$STATE" ] || die "nothing to resume"
  # shellcheck source=/dev/null
  source "$STATE"; MODE="$RESUME_MODE"
else
  RUN_ID="$(date +%Y%m%d-%H%M%S)-$MODE"; ITER=0; COST=0; NOCHANGE=0
  LAST_HEAD="$(git rev-parse HEAD)"
  if [ "$MODE" = plan ]; then MAX_ITER="${ARG2:-$MAX_PLAN_ITER}"; else MAX_ITER="${ARG2:-$MAX_BUILD_ITER}"; fi
fi
RUN_DIR="$LOGS_DIR/$RUN_ID"; mkdir -p "$RUN_DIR"; ln -sfn "$RUN_DIR" "$LOGS_DIR/current"
export RALPH_RUN_DIR="$RUN_DIR"

if [ "$MODE" = plan ]; then
  PROMPT="$HARNESS/PROMPT_plan.md"; MODEL="$MODEL_PLAN"
  PROMISE='<promise>PLAN_COMPLETE</promise>'; GATE=(bash "$HARNESS/verify.sh" --plan)
else
  PROMPT="$HARNESS/PROMPT_build.md"; MODEL="$MODEL_BUILD"
  PROMISE='<promise>COMPLETE</promise>'; GATE=(bash "$HARNESS/verify.sh" --strict)
fi
STUCK_TAG='<promise>STUCK</promise>'

run_agent(){ # $1=prompt-file $2=iter-prefix — Claude engine (codex.sh overrides when ENGINE=codex)
  ( claude -p --dangerously-skip-permissions \
      --output-format=stream-json --verbose --model "$MODEL" \
      < "$1" > "$2.jsonl" 2> "$2.stderr" ) & local pid=$! w=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 15; w=$((w + 15))
    if [ "$w" -ge "$ITERATION_TIMEOUT_SEC" ]; then
      echo "ralph: TIMEOUT after ${ITERATION_TIMEOUT_SEC}s — killing agent" >> "$2.stderr"
      kill -TERM "$pid" 2>/dev/null || true; sleep 10; kill -KILL "$pid" 2>/dev/null || true; break
    fi
  done
  wait "$pid" 2>/dev/null || true
  node "$HARNESS/lib/lastmsg.mjs" "$2.jsonl" "$2.last.txt" "$2.cost" \
    || { : > "$2.last.txt"; echo 0 > "$2.cost"; }
}
[ "$ENGINE" = codex ] && source "$HARNESS/codex.sh"

save_state(){ printf 'RESUME_MODE=%s\nRUN_ID=%s\nITER=%s\nCOST=%s\nNOCHANGE=%s\nLAST_HEAD=%s\nMAX_ITER=%s\n' \
  "$MODE" "$RUN_ID" "$ITER" "$COST" "$NOCHANGE" "$LAST_HEAD" "$MAX_ITER" > "$STATE"; }
record_history(){ printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$MODE" "$ITER" \
  "$(git rev-parse --short HEAD)" "${VERIFY:-n/a}" "${PROMISED:-no}" "$COST" >> "$STATUS_DIR/HISTORY.tsv"; }
write_status(){ {
  echo "# Ralph status — run $RUN_ID"
  echo "- mode: $MODE   iteration: $ITER/$MAX_ITER   cost so far: \$$COST"
  echo "- HEAD: $(git log -1 --oneline)"
  echo "- last verify: ${VERIFY:-n/a}"
  echo "- next open task: $(grep -m1 -E '^- \[ \] T[0-9]+' .agentdocs/IMPLEMENTATION_PLAN.md 2>/dev/null || echo '(plan pending)')"
  echo "- stop gracefully: touch .harness/STOP    watch: tail -f .harness/logs/current/iter-*.stderr"
  echo "- updated: $(date)"
} > "$STATUS_DIR/STATUS.md"; }
write_final_report(){ {
  echo "# Ralph final report — ${RUN_ID:-unstarted}"
  echo "outcome: $1  after ${ITER:-0} iteration(s), \$${COST:-0}"
  echo
  echo "## last verify output"
  tail -n 60 "$RUN_DIR"/iter-*.verify.txt 2>/dev/null | tail -n 60 || echo "(none)"
  echo
  echo "## commits since bootstrap"
  git log --oneline "$(git rev-parse bootstrap)"..HEAD 2>/dev/null | head -n 60 || true
  echo
  echo "## next steps"
  case "$1" in
    COMPLETE)      echo "- run: bash .harness/verify.sh --install   (bootstrap + dual-tool install stage)"
                   echo "- smoke: claude --plugin-dir ./plugin, then clone a real reference site"
                   echo "- NOTE: the codex install leg may be demoted to manual — check the --install output" ;;
    PLAN_COMPLETE) echo "- skim .agentdocs/IMPLEMENTATION_PLAN.md (recommended human checkpoint)"
                   echo "- then: ./.harness/ralph.sh build" ;;
    STUCK)         echo "- read the tail of .agentdocs/PROGRESS.md and .harness/logs/current/"
                   echo "- add a corrective sign to .harness/guardrails.md, re-run bootstrap to re-seal, then: ./.harness/ralph.sh resume" ;;
    *)             echo "- inspect .harness/logs/current/; raise budget in config.env (re-run bootstrap to re-seal) or fix the blocker; then: ./.harness/ralph.sh resume" ;;
  esac
} > "$STATUS_DIR/FINAL_REPORT.md"
  cat "$STATUS_DIR/FINAL_REPORT.md"; }
finish(){ record_history; write_status; save_state; write_final_report "$1"
  case "$1" in
    COMPLETE|PLAN_COMPLETE) exit 0 ;;
    MAX_ITERATIONS|COST_CAP) exit 1 ;;
    *) exit 2 ;;
  esac; }
trap 'write_final_report INTERRUPTED; exit 2' INT TERM

# ---------------- the loop ----------------
while [ "$ITER" -lt "$MAX_ITER" ]; do
  [ -f "$HARNESS/STOP" ] && finish STOPPED
  ITER=$((ITER + 1)); IT="$RUN_DIR/iter-$(printf '%03d' "$ITER")"; VERIFY=""; PROMISED=no
  echo "=== [$MODE] iteration $ITER/$MAX_ITER  $(date +%H:%M:%S) ==="
  check_integrity
  PRE_HEAD="$(git rev-parse HEAD)"

  run_agent "$PROMPT" "$IT"
  COST="$(node -e "console.log((Number('$COST') + Number(require('fs').readFileSync('$IT.cost','utf8').trim() || 0)).toFixed(2))" 2>/dev/null || echo "$COST")"

  # plan mode may only write .agentdocs/ and AGENTS.md — hard-reset violations
  if [ "$MODE" = plan ]; then
    VIOLATION=0
    while IFS= read -r -d '' entry; do
      p="${entry:3}"; p="${p#\"}"; p="${p%\"}"
      case "$p" in .agentdocs/*|AGENTS.md|.harness/logs/*|.harness/status/*) ;; *) VIOLATION=1 ;; esac
    done < <(git status --porcelain=v1 -z)
    if git rev-parse -q --verify "$PRE_HEAD" >/dev/null && [ "$(git rev-parse HEAD)" != "$PRE_HEAD" ]; then
      while IFS= read -r p; do
        case "$p" in .agentdocs/*|AGENTS.md) ;; *) VIOLATION=1 ;; esac
      done < <(git diff --name-only "$PRE_HEAD"..HEAD)
    fi
    if [ "$VIOLATION" = 1 ]; then
      echo "ralph: plan iteration wrote outside .agentdocs/ — reverting" | tee -a "$IT.stderr"
      git reset --hard "$PRE_HEAD" -q
      git clean -fdq -e .harness/logs -e .harness/status
    fi
  fi

  # never lose work between fresh contexts
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git add -A && git commit -qm "wip(ralph): iter $ITER auto-commit"
  fi

  # per-iteration backpressure (build mode): failures become next iteration's top priority
  if [ "$MODE" = build ]; then
    if bash "$HARNESS/verify.sh" > "$IT.verify.txt" 2>&1; then
      VERIFY=pass; git tag -f ralph-last-green >/dev/null 2>&1; rm -f "$FEEDBACK"
    else
      VERIFY=fail
      { echo "# verify.sh FAILURES from iteration $ITER — fixing these is the top-priority task:"
        grep '^FAIL' "$IT.verify.txt"; echo; echo "--- tail of full output ---"; tail -n 60 "$IT.verify.txt"
      } > "$FEEDBACK"
    fi
  fi
  [ "$PUSH" = 1 ] && { git push -q origin "$BRANCH" 2>/dev/null || git push -qu origin "$BRANCH" 2>/dev/null || true; }

  # promise handling — DUAL GATE: promise AND the independent sealed gate must both hold
  if grep -qF "$STUCK_TAG" "$IT.last.txt" 2>/dev/null; then PROMISED=stuck; finish STUCK; fi
  if grep -qF "$PROMISE" "$IT.last.txt" 2>/dev/null; then
    PROMISED=yes
    if "${GATE[@]}" > "$IT.gate.txt" 2>&1; then
      if [ "$MODE" = plan ]; then git tag -f plan-complete >/dev/null 2>&1; finish PLAN_COMPLETE
      else finish COMPLETE; fi
    else
      { echo "# You output $PROMISE but the independent gate FAILED. Fix these before claiming completion:"
        grep '^FAIL' "$IT.gate.txt"; echo; echo "--- tail ---"; tail -n 80 "$IT.gate.txt"
      } > "$FEEDBACK"
    fi
  fi

  # stuck detection: no new commits for STUCK_THRESHOLD consecutive iterations
  HEAD_NOW="$(git rev-parse HEAD)"
  if [ "$HEAD_NOW" = "$LAST_HEAD" ]; then NOCHANGE=$((NOCHANGE + 1)); else NOCHANGE=0; LAST_HEAD="$HEAD_NOW"; fi
  [ "$NOCHANGE" -ge "$STUCK_THRESHOLD" ] && { echo "ralph: $NOCHANGE iterations without a commit"; finish STUCK; }
  # cost cap (claude engine; codex leg reports 0 and is governed by iteration cap)
  if node -e "process.exit(Number('$COST') > Number('$MAX_COST_USD') ? 0 : 1)" 2>/dev/null; then
    echo "ralph: cost cap \$$MAX_COST_USD exceeded (\$$COST)"; finish COST_CAP
  fi
  record_history; write_status; save_state
done
finish MAX_ITERATIONS
