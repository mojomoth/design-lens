#!/usr/bin/env bash
# Optional Codex engine leg — sourced by ralph.sh when ENGINE=codex in config.env.
# STATUS: documented but NOT machine-verified on this repo (the Claude leg is the verified path).
# Flags verified against codex 0.139.0 --help on this machine:
#   --dangerously-bypass-approvals-and-sandbox  (long form of the hidden --yolo alias)
#   --dangerously-bypass-hook-trust             (required: non-interactive runs silently skip
#                                                untrusted hooks without it)
#   --skip-git-repo-check  -C <dir>  --json  -o/--output-last-message <file>
# Codex exposes no cost field in its output; the cost cap is governed by the iteration cap.

run_agent(){ # $1=prompt-file $2=iter-prefix
  ( codex exec \
      --dangerously-bypass-approvals-and-sandbox \
      --dangerously-bypass-hook-trust \
      --skip-git-repo-check \
      -C "$ROOT" --json \
      -o "$2.last.txt" \
      - < "$1" > "$2.jsonl" 2> "$2.stderr" ) & local pid=$! w=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 15; w=$((w + 15))
    if [ "$w" -ge "$ITERATION_TIMEOUT_SEC" ]; then
      echo "ralph: TIMEOUT after ${ITERATION_TIMEOUT_SEC}s — killing codex" >> "$2.stderr"
      kill -TERM "$pid" 2>/dev/null || true; sleep 10; kill -KILL "$pid" 2>/dev/null || true; break
    fi
  done
  wait "$pid" 2>/dev/null || true
  [ -f "$2.last.txt" ] || : > "$2.last.txt"
  echo 0 > "$2.cost"
}
