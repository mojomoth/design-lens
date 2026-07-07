# ACCEPTANCE.md — definition of done (protected doc)

This is the **human-readable mirror** of the sealed machine gate. The build is DONE only when
`bash .harness/verify.sh --strict` exits 0. Editing this file changes nothing — the gate script
is sealed in `.harness/`.

## Always-on backpressure (every iteration, `verify.sh` default mode)

- **AC-01 seal** — `.harness/` untouched (sha256 manifest, in-repo + out-of-repo copy agree).
- **AC-02 governance** — all seeded ADR-001…ADR-009 present; after the `plan-complete` tag, any
  drift in protected docs requires new ADRs naming the drifted files.
- **AC-03 hygiene** — no committed `node_modules/`, no merge-conflict markers, no files > 2 MB.
- **AC-04 no placeholders** — no TODO/FIXME/stub markers in `plugin/cli/src`, `plugin/scripts`,
  `plugin/skills` (allowlist lives sealed in `.harness/`).
- **AC-05 test integrity** — no `.skip`/`.only`/`xit`; unit-test count never drops below the
  count at the `ralph-last-green` tag.
- **AC-06 code gates** — `(cd plugin/cli && npm run typecheck)`, eslint `--max-warnings 0`,
  `npm run test` (unit), `npm run e2e` (own fixtures) all exit 0.
- **AC-07 sealed e2e spine** — `bash .harness/e2e-assert.sh --m1` exits 0 once
  `plugin/cli/dist/design-lens.cjs` exists: clone of the sealed fixture produces
  `clone/index.html`, unique `data-dl-id` ≥ 30, the `.js-injected` CSSOM rule text, localized
  CSS/images (zero `127.0.0.1` refs inside `clone/` except `manifest.json`), the alt-port
  webfont localized (it is network-captured during render; leaving it remote would also fail the
  zero-`127.0.0.1` check), parseable `manifest.json` mapping every localized asset, and a
  `REPORT.md` containing "License & usage notice".

## Strict-only (completion, `verify.sh --strict`)

- **AC-08 full fidelity** — `bash .harness/e2e-assert.sh --all` exits 0: everything in AC-07
  plus canvas serialized as `img[src^="data:image"]`, declarative shadow DOM
  (`<template shadowroot`) with the fixture card content, JS-set input value present as an
  attribute, lazy/IntersectionObserver image localized, both srcset candidates localized, and
  the consent banner absent from the clone.
- **AC-09 plugin validity** — `claude plugin validate ./plugin --strict` exits 0; all four JSON
  files parse: `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`.
- **AC-10 version lock** — both plugin.json `version` fields identical AND equal to
  `node plugin/cli/dist/design-lens.cjs --version`.
- **AC-11 dist fresh** — `npm run build` reproduces the committed `plugin/cli/dist/` with no
  git diff.
- **AC-12 skill portability** — exactly five skills (`clone-reference`, `reverse-design`,
  `inspect-elements`, `customize-clone`, `build-from-design`), each with `name` + `description`
  frontmatter; NO skill body contains `$ARGUMENTS`, `$<digit>`, backtick-command interpolation,
  `{{`, or `CLAUDE_PLUGIN_ROOT`.
- **AC-13 templates** — `reverse-design/templates/DESIGN.template.md` contains the 12 numbered
  headings (First Impression / Design Intent / Layout & Grid / Visual Hierarchy / Typography /
  Color System / Imagery & Iconography / Motion & Interaction / Component Patterns /
  Signature Moves / What NOT to Copy / Reusable Principles);
  `VARIATIONS.template.md` contains `## Variation`.
- **AC-14 ethics** — `customize-clone/SKILL.md` and `build-from-design/SKILL.md` contain
  `## Before you ship — brand checklist`.
- **AC-15 docs** — root `README.md` contains both `plugin marketplace add` (Claude) and
  `codex plugin marketplace add` (Codex) install blocks; `plugin/README.md` and
  `plugin/NOTICE.md` exist.
- **AC-16 plan honest & finished** — plan grammar lint passes; ≥ 15 checked tasks; zero
  unchecked tasks outside `## Deferred`; `PROGRESS.md` non-empty.

## Install stage (`verify.sh --install` — run by the loop after strict goes green)

- **AC-17 bootstrap** — with a temp `HOME` (shared `PLAYWRIGHT_BROWSERS_PATH`):
  `bash plugin/scripts/bootstrap.sh` creates an executable `~/.design-lens/bin/design-lens`
  whose `--version` works; a second invocation exits 0 in < 5 s (fast path).
- **AC-18 dual install** — `claude --plugin-dir ./plugin -p` smoke passes; sandboxed
  `claude plugin marketplace add <repo>` + `claude plugin install design-lens@design-lens`
  succeed. Codex leg (`codex plugin marketplace add` + `codex plugin add design-lens`): attempt;
  on failure DEMOTE to a warning in FINAL_REPORT.md with reproduction steps (pre-agreed
  fallback — this path was never executed on this machine).

## Manual (human, post-loop; NOT loop-blocking)
Clone one real site of the user's choice; eyeball `clone-full.png` vs `original-full.png`; run
`reverse-design` and judge DESIGN.md quality; do a logo+nav+color customization end-to-end in
both Claude Code and Codex.
