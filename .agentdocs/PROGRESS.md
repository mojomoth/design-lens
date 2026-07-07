# PROGRESS.md — iteration learnings (append-only log; newest at the bottom)

Rules: ≤ 10 lines per entry, never edit old entries. Durable reusable patterns get PROMOTED into
the pinned section below (that section may be edited in place).

## Codebase patterns (pinned — keep short, current, and true)

- (none yet)

## Log

- 2026-07-06 · harness scaffolding created; no build iterations have run yet.
- 2026-07-08 · T01 done: scaffolded plugin/cli (tsc strict, eslint flat, tsup, vitest) + lib/slug.
  Traps: vitest 3.2 `passWithNoTests`/`fileParallelism` are ROOT-only, NOT per-project (put them
  under `test:`, not inside a `projects[].test`). `new URL()` percent-encodes spaces in path
  segments, so a space in a slug fixture becomes `-20-`; use dash-safe URLs in slug tests.
  Kept deps to devDeps only (runtime deps land per-task per the plan); avoided `@eslint/js`
  (not allowlisted) by exporting a plain flat-config array with `tseslint.configs.recommended`.
