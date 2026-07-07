# ARCHITECTURE.md — intended system shape (protected doc)

## Big picture

```
user (Claude Code | Codex)
  └─ skills/ (5 SKILL.md — shared bodies, argument-free)
       └─ ~/.design-lens/bin/design-lens  (launcher → node ~/.design-lens/lib/design-lens.cjs)
            └─ plugin/cli  (TypeScript engine, bundled CJS)
                 ├─ capture   (Playwright Chromium)
                 ├─ localize  (resource store → folder mirror)
                 ├─ output    (writer, manifest, REPORT, beautify)
                 └─ analyze   (tokens, inspect)
```

- Skills are thin prose procedures; ALL deterministic logic lives in the CLI.
- No MCP server (rejected: skills + CLI via shell is fully portable across both tools and costs
  no context tokens). No Claude subagents / Codex TOML agents in the plugin (not portable).
- Provisioning: SessionStart hook (both tools) runs `plugin/scripts/bootstrap.sh` → idempotent
  install into `~/.design-lens/` (lib copy, runtime node_modules with pinned playwright +
  adblocker, Chromium, launcher). Fast path < 1s on every later session start.

## plugin/ layout

```
plugin/
├── .claude-plugin/plugin.json     # name design-lens, version 0.1.0, skills ./skills/, hooks
├── .codex-plugin/plugin.json      # same name/version/skills/hooks (Codex requires its own)
├── hooks/hooks.json               # SessionStart → bash ${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh
├── scripts/bootstrap.sh           # idempotent runtime provisioning (hooks DO get CLAUDE_PLUGIN_ROOT in both tools)
├── skills/{clone-reference,reverse-design,inspect-elements,customize-clone,build-from-design}/
│   └── SKILL.md (+ reverse-design/LENSES.md + reverse-design/templates/*.template.md)
├── cli/                           # self-contained npm package
│   ├── package.json  package-lock.json  tsconfig.json  tsup.config.ts  vitest.config.ts  eslint.config.mjs
│   ├── src/
│   │   ├── index.ts               # commander wiring only
│   │   ├── commands/{clone,tokens,inspect,screenshot,serve,verify}.ts
│   │   ├── capture/{browser,consent,settle,stamp,serialize}.ts
│   │   ├── localize/{resource-store,urlmap,html-rewrite,css-rewrite,srcset,fetch-missing}.ts
│   │   ├── output/{writer,manifest,report,beautify}.ts
│   │   ├── analyze/{tokens,inspect,heuristics}.ts
│   │   └── lib/{runtime-deps,slug,log,static-server}.ts
│   ├── dist/design-lens.cjs       # committed tsup bundle
│   └── test/{unit,e2e,fixtures}/
├── NOTICE.md                      # licenses of bundled libraries
└── README.md                      # plugin usage docs
```

## Data flow

```
URL ──clone──▶ .design-lens/<slug>/{clone/, screenshots/, REPORT.md}
clone dir ──tokens──▶ tokens.json          clone dir ──inspect──▶ element JSON (stdout, ephemeral)
clone dir + agent ──reverse-design skill──▶ DESIGN.md + VARIATIONS.md
clone dir + agent ──customize-clone skill──▶ edited index.html + assets/dl-overrides.css
DESIGN.md + user content ──build-from-design skill──▶ new page in the user's stack
```

## Error-handling strategy
Per-stage degradation inside `clone`: consent blocking optional → scroll sweep optional →
percy serializer falls back to the own CSSOM-walk serializer → only navigation/write failures
are fatal (exit 1). Every degradation and every non-localized resource is enumerated in
REPORT.md and `manifest.remote[]`. Human progress on stderr; machine JSON on stdout.

## Clone engine milestones (build order — details in specs/02-clone-engine.md)
- **M1 spine**: launch → goto(load) → stamp data-dl-id → own CSSOM-walk serializer → sanitize →
  localize (urlmap) → beautify → write clone/manifest/REPORT. Gate: `e2e-assert.sh --m1`.
- **M2 fidelity**: @percy/dom serializer upgrade (canvas, shadow DOM, input state), scroll sweep,
  consent blocking, srcset, refetch of CSS-discovered resources. Gate: `e2e-assert.sh --all`.
- **M3 polish**: tokens/inspect/screenshot/serve/verify commands, bootstrap+hooks, skills,
  install gates, docs.
