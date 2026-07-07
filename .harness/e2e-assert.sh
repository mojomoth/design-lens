#!/usr/bin/env bash
# Sealed, independent e2e assertions against the sealed fixture (.harness/fixture/).
# The build agent's own tests can be edited by the agent; THIS script cannot — it is what makes
# the completion gate honest. Mirrored for the builder in .agentdocs/specs/09-fixture-contract.md.
#
# Usage: e2e-assert.sh --m1   (spine assertions; run per-iteration once the bundle exists)
#        e2e-assert.sh --all  (full fidelity; part of verify.sh --strict)
# Exit: 0 all assertions pass | 1 failures | 3 preconditions missing
set -uo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HARNESS/.." && pwd)"; cd "$ROOT"
# shellcheck source=/dev/null
source "$HARNESS/config.env"

LEVEL="${1:---m1}"
CLI="plugin/cli/dist/design-lens.cjs"
[ -f "$CLI" ] || { echo "e2e-assert: PRECONDITION $CLI missing (build the bundle first)"; exit 3; }
command -v node >/dev/null || { echo "e2e-assert: node not found"; exit 3; }

FAIL=0
ok(){ printf 'PASS %-4s %s\n' "$1" "$2"; }
bad(){ printf 'FAIL %-4s %s\n' "$1" "$2"; FAIL=1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dl-e2e.XXXXXX")"
SERVER_PID=""
cleanup(){
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- boot the sealed fixture ---
node "$HARNESS/fixture/serve.mjs" --port "$FIXTURE_PORT" --alt-port "$FIXTURE_ALT_PORT" \
  >/dev/null 2>"$WORK/serve.err" & SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$FIXTURE_PORT/index.html" >/dev/null 2>&1 && break
  sleep 0.2
done
curl -sf "http://127.0.0.1:$FIXTURE_PORT/index.html" >/dev/null 2>&1 \
  || { echo "e2e-assert: fixture server failed to boot"; cat "$WORK/serve.err"; exit 3; }

# --- run the clone under test ---
( cd "$WORK" && node "$ROOT/$CLI" clone "http://127.0.0.1:$FIXTURE_PORT/index.html" \
    --project sealed-fixture >/dev/null 2>clone.err )
RC=$?
PROJ="$WORK/.design-lens/sealed-fixture"
CLONE="$PROJ/clone"

# ---------- M1 spine assertions ----------
if [ "$RC" -eq 0 ] && [ -f "$CLONE/index.html" ]; then ok A1 "clone exits 0, index.html written"
else bad A1 "clone rc=$RC or missing $CLONE/index.html $(tail -n 5 "$WORK/clone.err" 2>/dev/null)"; fi
[ -f "$CLONE/index.html" ] || { echo "e2e-assert: nothing to assert on"; exit 1; }

IDS_TOTAL=$(grep -o 'data-dl-id="[^"]*"' "$CLONE/index.html" | wc -l | tr -d ' ')
IDS_UNIQ=$(grep -o 'data-dl-id="[^"]*"' "$CLONE/index.html" | sort -u | wc -l | tr -d ' ')
if [ "$IDS_TOTAL" -ge 30 ] && [ "$IDS_TOTAL" -eq "$IDS_UNIQ" ]; then ok A2 "data-dl-id: $IDS_TOTAL stamped, all unique"
else bad A2 "data-dl-id total=$IDS_TOTAL unique=$IDS_UNIQ (need >=30, all unique)"; fi

grep -rq 'js-injected' "$CLONE" && grep -rq 'rgb(1, 2, 3)' "$CLONE" \
  && ok A3 "CSSOM-injected rule captured" || bad A3 ".js-injected insertRule rule missing (CSSOM serialization broken)"

LOCALHOST_REFS=$(grep -rl '127\.0\.0\.1' "$CLONE" 2>/dev/null | grep -v 'manifest\.json' || true)
[ -z "$LOCALHOST_REFS" ] && ok A4 "no live-server refs in clone/" \
  || bad A4 "live 127.0.0.1 refs remain in: $LOCALHOST_REFS"

CSS_COUNT=$(find "$CLONE/assets" -name '*.css' 2>/dev/null | wc -l | tr -d ' ')
grep -rq 'extra' "$CLONE/assets" 2>/dev/null && [ "$CSS_COUNT" -ge 2 ] \
  && ok A5 "stylesheets localized incl. @import chain ($CSS_COUNT css files)" \
  || bad A5 "css localization incomplete (found $CSS_COUNT css files; extra.css present: $(grep -rql 'extra' "$CLONE/assets" 2>/dev/null | head -1 || echo no))"

find "$CLONE/assets" -name 'bg*.svg' | grep -q . && ! grep -q 'url(assets/bg\.svg)' "$CLONE/index.html" \
  && ok A6 "bg.svg localized + css url() rewritten" || bad A6 "bg.svg not localized or url() not rewritten"

if [ -f "$PROJ/manifest.json" ]; then
  MISSING=$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const path = require("path"); const fs = require("fs");
    const base = process.argv[2];
    const miss = (m.resources || []).filter(r => !fs.existsSync(path.join(base, r.localPath)));
    console.log(miss.map(r => r.localPath).join("\n"));
  ' "$PROJ/manifest.json" "$PROJ" 2>&1) \
    && { [ -z "$MISSING" ] && ok A7 "manifest parses; all localPaths exist" || bad A7 "manifest localPaths missing on disk: $MISSING"; } \
    || bad A7 "manifest.json unparseable: $MISSING"
else bad A7 "manifest.json missing"; fi

grep -q 'License & usage notice' "$PROJ/REPORT.md" 2>/dev/null \
  && ok A8 "REPORT.md with license notice" || bad A8 "REPORT.md missing or lacks 'License & usage notice'"

if grep -qE '<script' "$CLONE/index.html" || grep -qE '\son[a-z]+="' "$CLONE/index.html"; then
  bad A9 "clone contains <script> or on* handlers (must be inert)"
else ok A9 "clone is inert (no scripts/handlers)"; fi

find "$CLONE/assets" -name '*.woff2' | grep -q . \
  && ok A15 "cross-origin (alt-port) webfont localized" || bad A15 "fixture.woff2 not localized from the fake CDN"

# ---------- full-fidelity assertions ----------
if [ "$LEVEL" = "--all" ]; then
  grep -qE '<img[^>]+src="data:image' "$CLONE/index.html" \
    && ok A10 "canvas serialized as data-URI img" || bad A10 "painted canvas not converted to data-URI img"
  grep -qi '<template[^>]*shadowroot' "$CLONE/index.html" && grep -q 'Slotted body content of card one' "$CLONE/index.html" \
    && ok A11 "declarative shadow DOM with card content" || bad A11 "shadow DOM content missing"
  grep -q 'captured@fixture\.test' "$CLONE/index.html" \
    && ok A12 "JS-set input value preserved" || bad A12 "input value lost"
  find "$CLONE/assets" -name 'lazy*.svg' | grep -q . && grep -Eq '<img[^>]+id="lazy-io"[^>]+src="[^"]*lazy' "$CLONE/index.html" \
    && ok A13 "IntersectionObserver lazy image localized" || bad A13 "lazy.svg not captured/referenced"
  H8=$(find "$CLONE/assets" -name 'hero-800*' | wc -l | tr -d ' '); H16=$(find "$CLONE/assets" -name 'hero-1600*' | wc -l | tr -d ' ')
  [ "$H8" -ge 1 ] && [ "$H16" -ge 1 ] \
    && ok A14 "both srcset candidates localized" || bad A14 "srcset variants missing (800:$H8 1600:$H16)"
  grep -q 'id="consent"' "$CLONE/index.html" \
    && bad A16 "consent banner present in clone" || ok A16 "consent banner absent"
  TOKENS=$(node "$ROOT/$CLI" tokens "$PROJ" --stdout 2>/dev/null || cat "$PROJ/tokens.json" 2>/dev/null || echo "")
  echo "$TOKENS" | grep -qi '0a2540' && echo "$TOKENS" | grep -qi 'ff5c35' && echo "$TOKENS" | grep -qi 'Fixture Sans' \
    && ok A17 "tokens: both brand colors + font family" || bad A17 "tokens.json lacks #0a2540/#ff5c35/Fixture Sans"
  INSPECT=$(node "$ROOT/$CLI" inspect "$PROJ" 2>/dev/null || echo "")
  NAVC=$(echo "$INSPECT" | grep -o '"nav-link"' | wc -l | tr -d ' ')
  echo "$INSPECT" | grep -q '"logo"' && [ "$NAVC" -ge 3 ] && echo "$INSPECT" | grep -q '"hero-heading"' \
    && echo "$INSPECT" | grep -q '"hero-image"' && echo "$INSPECT" | grep -q '"cta"' \
    && ok A18 "inspect: logo, ${NAVC} nav-links, hero-heading, hero-image, cta" \
    || bad A18 "inspect roles incomplete (nav-links=$NAVC; got: $(echo "$INSPECT" | grep -o '"role":"[^"]*"' | sort -u | tr '\n' ' '))"
fi

[ "$FAIL" = 0 ] && echo "E2E-ASSERT: ALL GREEN ($LEVEL)" || echo "E2E-ASSERT: FAILURES ABOVE ($LEVEL)"
exit $FAIL
