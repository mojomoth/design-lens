# 01-packaging — repo/plugin layout, dual manifests, install story, runtime provisioning

## Purpose

Defines the physical shape of the deliverable: one git repo that is simultaneously a Claude Code
plugin marketplace and a Codex plugin marketplace, containing one plugin under `plugin/`. Covers
the four JSON manifest/marketplace files, the install commands for both tools, and the
SessionStart runtime-provisioning pipeline that turns a copied plugin cache into a working
`~/.design-lens/` runtime with a stable launcher path.

## Requirements

### Repo & plugin layout
- The repo root MUST be a plugin marketplace; the plugin root MUST be `plugin/` (never
  `plugins/design-lens/`). Both marketplace files MUST reference the plugin via source path
  `./plugin`.
- `.agentdocs/` and `.harness/` MUST remain outside `plugin/` — installs copy the plugin
  directory into a tool cache, and `../` references outside the plugin root are forbidden by
  both tools.
- There MUST be no root `package.json` and no npm workspaces anywhere. `plugin/cli/` is a
  self-contained npm package: `npm ci` MUST succeed there from a clean checkout.
- `plugin/cli/dist/design-lens.cjs` (single-file CJS tsup bundle) and
  `plugin/cli/package-lock.json` MUST be committed. The bundle MUST be < 2 MB (repo hygiene gate
  AC-03 rejects files > 2 MB); `playwright`, `playwright-core`, and
  `@ghostery/adblocker-playwright` stay `external` to keep it small.
- `npm run build` (tsup) MUST reproduce the committed `dist/` with zero git diff (AC-11): the
  tsup config MUST be deterministic — no timestamps, no environment-dependent banners.
- npm script names in `plugin/cli/package.json` MUST be exactly `typecheck`, `test` (unit),
  `e2e`, `build`, `verify` (`verify` = typecheck && test && build && e2e). NOT `test:e2e`.
- Root `.gitignore` MUST ignore `node_modules/`, `.design-lens/`, `test-output/` and MUST NOT
  ignore `plugin/cli/dist/`.
- `plugin/scripts/bootstrap.sh` MUST be committed with the executable bit set (`chmod +x`).

### Manifests & version lock
- All four JSON files in "Interfaces & contracts" MUST exist with the normative content shown
  there and MUST parse (AC-09).
- Both `plugin.json` files MUST declare `"version": "0.1.1"`, and
  `node plugin/cli/dist/design-lens.cjs --version` MUST print exactly `0.1.1` (AC-10). The CLI
  version string MUST be defined in exactly one place in `plugin/cli/src/`; a unit test SHOULD
  assert the three-way lock by reading both manifests.
- `claude plugin validate ./plugin --strict` MUST exit 0 (AC-09).
- All paths inside manifests MUST be relative and start with `./`; no path may escape the
  plugin root.
- Any release MUST bump `version` in BOTH plugin.json files and the CLI in the same commit
  (Claude only ships updates to users on a version bump when `version` is set).

### Install story
- Root `README.md` MUST contain both install blocks verbatim as shown in "Interfaces &
  contracts" (AC-15: the strings `plugin marketplace add` and `codex plugin marketplace add`
  are grepped).
- The dev loop `claude --plugin-dir ./plugin` MUST load the plugin (hooks + skills) — this is
  the AC-18 smoke test.
- **Double-listing decision rule (ADR-003)**: both marketplace files list the same plugin. If
  the installed Codex double-lists design-lens because it scans BOTH
  `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`, the builder MUST
  delete `.agents/plugins/marketplace.json`, rely on legacy compat, and record the removal as a
  new ADR in `DECISIONS.md`. Do not attempt any other workaround.
- `plugin/README.md` MUST document the Codex hook-trust step: Codex skips non-managed (plugin)
  hooks until the user trusts them via `/hooks`, so first-run bootstrap on Codex requires either
  trusting the hook interactively or running
  `bash <plugin-cache-dir>/scripts/bootstrap.sh` manually.

### Runtime provisioning (bootstrap contract)
- Provisioning MUST be driven by a SessionStart hook shared by both tools:
  `plugin/hooks/hooks.json` runs `bash "${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh"`.
  `${CLAUDE_PLUGIN_ROOT}` IS valid here — both tools substitute/export it for hook processes.
  It MUST NEVER appear in skill bodies (ADR-004; AC-12 greps for it).
- `bootstrap.sh` MUST be idempotent and MUST follow the behavioral steps in "Interfaces &
  contracts". Fast path (already provisioned): MUST exit 0 in well under 1 s wall time; the
  sealed gate AC-17 enforces < 5 s on second invocation.
- `bootstrap.sh` MUST exit 0 even when provisioning fails (never block session start): on any
  failure it prints an actionable message to stderr — "design-lens setup failed: <cause>. Run
  `bash <plugin dir>/scripts/bootstrap.sh` manually." — and exits 0. The CLI itself MUST emit a
  clear error when Playwright/Chromium is missing at run time.
- npm installs into `~/.design-lens/runtime/` MUST use the SAME exact version pins as
  `plugin/cli/package.json`: `playwright@1.61.1` (matches `.harness/config.env`
  PLAYWRIGHT_VERSION) and the exact-pinned `@ghostery/adblocker-playwright` version chosen at
  build time. The pins appear as literals in bootstrap.sh; a unit test SHOULD assert they match
  package.json.
- The launcher `~/.design-lens/bin/design-lens` is the ONLY executable path skills may
  reference. All human-facing bootstrap progress goes to stderr.
- The bundled CLI MUST resolve its external deps (`playwright`,
  `@ghostery/adblocker-playwright`) via the `loadRuntimeDep` try/require fallback in
  `plugin/cli/src/lib/runtime-deps.ts` — never via bare top-level imports of those packages.
- Bootstrap MUST honor `DESIGN_LENS_HOME` (defaults to `$HOME/.design-lens`) and MUST work when
  invoked manually without `CLAUDE_PLUGIN_ROOT` set (derive plugin root from the script's own
  location). `playwright install chromium` honors `PLAYWRIGHT_BROWSERS_PATH` automatically.

## Interfaces & contracts

### Repo tree (normative; deeper `cli/src` layout is in ARCHITECTURE.md and specs/02)

```
design-lens/                              # repo root = the marketplace
├── .claude-plugin/marketplace.json       # Claude marketplace; ALSO read by Codex (legacy compat)
├── .agents/plugins/marketplace.json      # Codex-native marketplace
├── plugin/                               # THE PLUGIN ROOT (installs copy exactly this dir)
│   ├── .claude-plugin/plugin.json
│   ├── .codex-plugin/plugin.json
│   ├── hooks/hooks.json
│   ├── scripts/bootstrap.sh              # executable
│   ├── skills/{clone-reference,reverse-design,inspect-elements,customize-clone,build-from-design}/
│   │   └── SKILL.md (+ reverse-design/LENSES.md + reverse-design/templates/*.template.md)
│   ├── cli/                              # self-contained npm package
│   │   ├── package.json  package-lock.json  tsconfig.json  tsup.config.ts
│   │   ├── vitest.config.ts  eslint.config.mjs
│   │   ├── src/                          # see ARCHITECTURE.md module map
│   │   ├── dist/design-lens.cjs          # COMMITTED tsup bundle
│   │   └── test/{unit,e2e,fixtures/sites/{basic,spa,banner}}/
│   ├── NOTICE.md                         # bundled-library licenses
│   └── README.md                         # plugin usage docs (+ Codex hook-trust note)
├── README.md                             # install blocks for BOTH tools
├── LICENSE                               # MIT
├── .gitignore
├── .agentdocs/                           # never copied by installs
└── .harness/                             # sealed; never copied by installs
```

### `plugin/.claude-plugin/plugin.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "design-lens",
  "displayName": "Design Lens",
  "version": "0.1.1",
  "description": "Start from great reference designs: clone a site into an editable local mirror, reverse-engineer the design thinking into DESIGN.md, and customize elements conversationally.",
  "author": { "name": "mojomoth" },
  "license": "MIT",
  "keywords": ["design", "frontend", "clone", "playwright", "reference"],
  "skills": "./skills/"
}
```

No `hooks` field: Claude Code auto-loads the conventional `hooks/hooks.json`, and a manifest
pointer at that same path is rejected as a duplicate at load time (ADR-017). Only the Codex
manifest carries the explicit pointer.

### `plugin/.codex-plugin/plugin.json`

```json
{
  "name": "design-lens",
  "version": "0.1.1",
  "description": "Start from great reference designs: clone a site into an editable local mirror, reverse-engineer the design thinking into DESIGN.md, and customize elements conversationally.",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json"
}
```

### `.claude-plugin/marketplace.json` (repo root)

```json
{
  "name": "design-lens",
  "owner": { "name": "mojomoth" },
  "plugins": [
    {
      "name": "design-lens",
      "source": "./plugin",
      "description": "Clone reference designs, reverse-engineer the design thinking, customize conversationally.",
      "category": "design"
    }
  ]
}
```

### `.agents/plugins/marketplace.json` (repo root; Codex-native — `policy` + `category` required per entry)

```json
{
  "name": "design-lens",
  "interface": { "displayName": "Design Lens" },
  "plugins": [
    {
      "name": "design-lens",
      "source": { "source": "local", "path": "./plugin" },
      "policy": { "installation": "AVAILABLE" },
      "category": "Productivity"
    }
  ]
}
```

### Install command blocks (verbatim into root README.md)

Claude Code:

```bash
claude plugin marketplace add <repo-url-or-abs-path>
claude plugin install design-lens@design-lens
```

Codex CLI:

```bash
codex plugin marketplace add <repo-url-or-abs-path>
codex plugin add design-lens@design-lens
```

Dev loop (no install): `claude --plugin-dir ./plugin`.

### `plugin/hooks/hooks.json` (exact content)

```json
{
  "description": "Provision the design-lens runtime (CLI copy, Playwright, Chromium) once per version.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh\"",
            "timeout": 600,
            "statusMessage": "Setting up design-lens runtime (first run downloads Chromium)…"
          }
        ]
      }
    ]
  }
}
```

### `plugin/scripts/bootstrap.sh` (behavioral spec — steps are normative, wording is not)

```
#!/usr/bin/env bash — set -euo pipefail, with the main body wrapped so ANY failure
prints the actionable stderr message and exits 0 (never block session start).
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"   # hook AND manual invocation
DL_HOME="${DESIGN_LENS_HOME:-$HOME/.design-lens}"

1. VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/.claude-plugin/plugin.json")"
   (node, not jq — node is a hard prerequisite anyway; jq may be absent)
   MARKER="$DL_HOME/.installed-v$VERSION-node$(node -v | cut -d. -f1)"
2. FAST PATH: if MARKER exists AND "$DL_HOME/bin/design-lens" exists →
   refresh "$DL_HOME/lib/design-lens.cjs" from "$ROOT/cli/dist/design-lens.cjs" only if
   `cmp -s` differs → exit 0. (< 1 s; this hook runs on EVERY session start.)
3. mkdir -p "$DL_HOME"/{bin,lib,runtime,cache}
4. cp "$ROOT/cli/dist/design-lens.cjs" "$DL_HOME/lib/design-lens.cjs"
5. Runtime deps (external to the bundle) — skip if installed versions already equal the pins:
   npm install --prefix "$DL_HOME/runtime" --no-audit --no-fund \
     playwright@1.61.1 @ghostery/adblocker-playwright@<EXACT_PIN_FROM_cli/package.json>
6. "$DL_HOME/runtime/node_modules/.bin/playwright" install chromium
   (idempotent; honors PLAYWRIGHT_BROWSERS_PATH)
7. Write launcher "$DL_HOME/bin/design-lens" + chmod +x, exact content:
       #!/usr/bin/env bash
       DL_HOME="${DESIGN_LENS_HOME:-$HOME/.design-lens}"
       export NODE_PATH="$DL_HOME/runtime/node_modules${NODE_PATH:+:$NODE_PATH}"
       exec node "$DL_HOME/lib/design-lens.cjs" "$@"
8. rm -f "$DL_HOME"/.installed-v*; touch "$MARKER"; echo "design-lens $VERSION ready" >&2
```

Marker semantics: version-and-node-major scoped, so a plugin update OR a Node major upgrade
retriggers full provisioning; step 8 clears stale markers first.

### `plugin/cli/src/lib/runtime-deps.ts` (normative pattern)

```ts
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const req = createRequire(import.meta.url); // survives the tsup ESM→CJS bundle

export function loadRuntimeDep<T>(name: string): T {
  try {
    return req(name) as T; // repo dev (cli/node_modules) or NODE_PATH via launcher
  } catch {
    return req(join(homedir(), ".design-lens", "runtime", "node_modules", name)) as T;
  }
}
```

## Out of scope

- Auto-update logic beyond the version-scoped marker. (npm publication of the CLI moved INTO
  scope — ADR-016: unscoped package `design-lens`, `setup` subcommand mirrors bootstrap.sh.)
- MCP servers, Claude subagents / Codex TOML agents, the Claude-only `bin/` PATH feature,
  `userConfig`, `CLAUDE.md` at plugin root (not loaded by either tool).
- Single-file HTML export (AGPL `single-file-cli` — forbidden, ADR-005).
- Codex `config.toml`-based manual skill/hook wiring — the plugin path is the only install story.
- Skill body content and templates (specs/07-skills.md); clone engine behavior (specs/02).

## Verified facts (do not re-litigate)

- Codex 0.139.0 reads BOTH `<repo>/.agents/plugins/marketplace.json` and
  `<repo>/.claude-plugin/marketplace.json`; its native path is `.agents/plugins/`, and its
  validator errors with "missing `.codex-plugin/plugin.json`" — hence dual manifests, dual
  marketplace files. (gaps.txt §2; ADR-003)
- The Codex hook runner exports `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` to hook processes,
  and both tools accept the Claude hooks.json shape with `SessionStart`; Codex does NOT expand
  `${CLAUDE_PLUGIN_ROOT}` (or `$ARGUMENTS`/`$N`/`{{}}`) in skill bodies. (gaps.txt §2,
  codex-plugin.md §4; ADR-004, ADR-007)
- Neither tool runs npm postinstall; installs copy the plugin dir into a version-suffixed cache
  (`~/.claude/plugins/cache/...`, `~/.codex/plugins/cache/...`) whose path changes per update,
  and `../` escapes are forbidden — so the bundle is committed and the runtime lives at the
  well-known `~/.design-lens/`. (claude-plugin.md §3–4, codex-plugin.md §1; ADR-007)
- Claude: if `version` is set in plugin.json, users only get updates when it is bumped; if set
  in both plugin.json and the marketplace entry, plugin.json wins. (claude-plugin.md §1)
- Codex-native marketplace entries require `policy` and `category`. (codex-plugin.md §1)
- Codex skips non-managed (plugin) hooks until trusted via `/hooks`; automation uses
  `--dangerously-bypass-hook-trust`. (gaps.txt §1, codex-plugin.md §4)
- `@playwright/mcp` cannot self-provision browsers; `playwright install chromium` must be run
  explicitly, which bootstrap does. Playwright pin is 1.61.1 (`.harness/config.env`). (gaps.txt
  §3; ADR-007, ADR-008)
- NODE_PATH is unreliable for ESM resolution — the bundle is CJS and `loadRuntimeDep` does an
  explicit-path `require` fallback instead of trusting NODE_PATH. (plugin-design.md §3.3;
  ADR-007)
- Install/validate command lines: `claude plugin marketplace add`, `claude plugin install
  <plugin>@<marketplace>`, `claude plugin validate ./plugin --strict`, `claude --plugin-dir`,
  `codex plugin marketplace add`, `codex plugin add <plugin>`, `codex plugin list --json`.
  (claude-plugin.md §4, codex-plugin.md §1; ACCEPTANCE AC-09/AC-18)
