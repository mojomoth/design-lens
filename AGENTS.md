# AGENTS.md — Design Lens repo operational guide

## What this repo is
A dual-tool plugin (Claude Code + OpenAI Codex) called **design-lens**, built autonomously by the
Ralph loop in `.harness/`. Product truth lives in `.agentdocs/specs/`; the task list is
`.agentdocs/IMPLEMENTATION_PLAN.md`.

## Key paths
- `plugin/` — the plugin being built (`.claude-plugin/`, `.codex-plugin/`, `skills/`, `cli/`, `hooks/`, `scripts/`)
- `plugin/cli/` — self-contained npm package (TypeScript → tsup CJS bundle). No npm workspaces.
- `.agentdocs/` — specs (read-only in build mode; see its README), plan, progress, ADRs
- `.harness/` — SEALED. Never write here. The loop aborts the run on any modification.

## Commands
- The gate (run it constantly): `bash .harness/verify.sh`  (modes: `--plan`, `--strict`, `--install`)
- CLI package: `cd plugin/cli && npm run typecheck | test | e2e | build | verify`
- Sealed fixture self-test: `node .harness/fixture/serve.mjs --check`  (ports: .harness/config.env)
- Independent e2e assertions: `bash .harness/e2e-assert.sh --m1` (spine) / `--all` (full fidelity)
- The default gate runs only `--m1`; A10–A18 fire solely under `--strict`. Changed clone output? Run `--all`.
- True bundled-dep list (for `plugin/NOTICE.md`): `npx tsup --metafile --out-dir /tmp/dl-meta` — never
  into `dist/` (a stray `metafile-cjs.json` breaks S5). `npm ls --prod` over-claims; add `@percy/dom`
  by hand (vendored as a gzip+base64 string, so it never appears in the metafile).

## Rules that bite
- ONE plan task per iteration. Commit every green state. Never force-push or amend.
- Never edit `.harness/**`. Never weaken/skip/delete tests — a ratchet counts tests at the
  `ralph-last-green` tag and fails the gate if the count drops.
- Spec contradicts reality? Use the spec-drift protocol (PROMPT_build.md §8): ADR + minimal spec
  edit in the SAME commit. Silent workarounds and silent spec edits both fail the gate.
- New npm dependency? Only if in `.agentdocs/CONVENTIONS.md` allowlist; otherwise ADR first.
- Skills stay argument-free (no `$ARGUMENTS`, ANY `$`+digit, backtick-interpolation, `{{…}}`) and
  reference only `~/.design-lens/bin/design-lens` — never `${CLAUDE_PLUGIN_ROOT}` (Codex won't expand it).
- The placeholder scanner greps `plugin/skills` + `plugin/scripts` case-insensitively for
  TODO/FIXME/XXX/PLACEHOLDER substrings — prose there must dodge those words (tiny sealed allowlist).
- Tests never touch the live web. Fixture servers on 127.0.0.1 only.
- `npm ci --dry-run` DELETES `node_modules` before honoring the flag. To check lock↔package.json sync,
  read `package-lock.json` (or just run a real `npm ci`) — never dry-run it.
- `git diff -- <path>` takes a CWD-relative pathspec: `git diff --quiet -- plugin/cli/dist` from inside
  `plugin/cli` matches nothing and exits 0. Run gate ACs from the directory they name.

Keep this file under 60 lines: durable operational facts only, no status reports.
