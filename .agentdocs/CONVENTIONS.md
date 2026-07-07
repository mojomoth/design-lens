# CONVENTIONS.md — code and repo conventions (protected doc)

## Language & toolchain
- TypeScript, `strict: true`, ESM source (`"type": "module"`), Node ≥ 20.
- Bundled to a single CJS file by **tsup**: `plugin/cli/dist/design-lens.cjs` (committed).
  tsup config: `format: ['cjs']`, `platform: 'node'`, `target: 'node20'`, `noExternal: [/.*/]`,
  `external: ['playwright', 'playwright-core', '@ghostery/adblocker-playwright']`.
- No `any` (use `unknown` + narrowing). No bare catch-and-continue: errors are typed results or
  recorded warnings (`report.warnings[]`), never silently swallowed.
- ESLint flat config (`eslint.config.mjs`) + typescript-eslint, `--max-warnings 0`.

## Dependency allowlist (anything else requires an ADR FIRST)
Runtime/bundled: `playwright` (external), `@ghostery/adblocker-playwright` (external),
`@percy/dom`, `css-tree`, `cheerio`, `js-beautify`, `@projectwallace/css-analyzer`, `culori`,
`commander`.
Dev: `typescript`, `tsup`, `vitest`, `eslint`, `typescript-eslint`, `@types/node` (and @types/*
for allowlisted deps).
FORBIDDEN regardless of ADRs: any AGPL package (notably `single-file-cli` — never vendor, never
import), any package that phones home, npm postinstall-heavy packages.

## Package rules
- `plugin/cli/` is a self-contained npm package. **No npm workspaces anywhere in the repo.**
- `package-lock.json` is committed. `npm ci` must work from a clean checkout.
- Exact-pin `playwright` and `@ghostery/adblocker-playwright` (bootstrap installs the same pins
  into `~/.design-lens/runtime`); caret-pin the rest.
- npm scripts (names are load-bearing, the sealed gate calls them):
  `typecheck` = `tsc --noEmit` · `test` = vitest unit suite · `e2e` = vitest e2e suite ·
  `build` = tsup · `verify` = typecheck && test && build && e2e.

## Testing
- Framework: vitest. Unit tests in `plugin/cli/test/unit/`, e2e in `plugin/cli/test/e2e/`,
  own fixtures in `plugin/cli/test/fixtures/`.
- **Every test carries a docstring comment stating WHY it exists and what breaks if removed.**
- No network in tests except 127.0.0.1. The live web is never a test target.
- e2e spawns the BUILT bundle (`node dist/design-lens.cjs`), not the TS source.

## Commits
- Format: `type(T##): summary` where type ∈ `feat|fix|test|docs|spec|chore|wip` and T## is the
  plan task id (e.g. `feat(T07): localize CSS url() refs via css-tree`).
- Commit every green state. Never force-push, never amend earlier commits, never commit
  `node_modules/` or files > 2 MB.

## Code layout
- `plugin/cli/src/lib/` is the project stdlib: put exemplary, reusable patterns there first —
  the repo teaches by example.
- File naming: kebab-case. One module per concern (see ARCHITECTURE.md module map).
- Comments state constraints the code can't show; no narration, no changelogs in code.
