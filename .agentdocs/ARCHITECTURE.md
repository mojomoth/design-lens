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
                 ├─ analyze   (tokens, inspect, fidelity, design validation, tone, build QA)
                 └─ lib       (runtime deps, static server, viewports, run log)
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
├── .claude-plugin/plugin.json     # name design-lens, version 0.4.0, skills ./skills/, hooks auto-loaded
├── .codex-plugin/plugin.json      # same name/version/skills, explicit hooks pointer (ADR-017)
├── hooks/hooks.json               # SessionStart → bash ${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh
├── scripts/bootstrap.sh           # idempotent runtime provisioning (hooks DO get CLAUDE_PLUGIN_ROOT in both tools)
├── skills/{clone-reference,reverse-design,inspect-elements,customize-clone,build-from-design}/
│   └── SKILL.md (+ reverse-design/LENSES.md + reverse-design/templates/*.template.md)
├── cli/                           # self-contained npm package
│   ├── package.json  package-lock.json  tsconfig.json  tsup.config.ts  vitest.config.ts  eslint.config.mjs
│   ├── src/
│   │   ├── index.ts  cli.ts       # commander wiring only (cli.ts registers every command)
│   │   ├── commands/{clone,tokens,inspect,screenshot,serve,verify,fidelity,validate-design,
│   │   │             tone,qa,qa-confirm,runlog,setup}.ts
│   │   ├── capture/{browser,consent,consent-rules,settle,stabilize,stamp,serialize,evidence,
│   │   │            frames,paragraphs,percy-dom-src,percy-restore,readiness,media,disclosures}.ts
│   │   ├── localize/{localize,resource-store,urlmap,html-rewrite,css-rewrite,srcset,
│   │   │             fetch-missing,document-references,media-type,paragraph-selectors}.ts
│   │   ├── output/{writer,manifest,report,beautify,provenance,responsive}.ts
│   │   ├── analyze/{tokens,css-sources,inspect,inspect-details,inspect-observations,inspect-lite,
│   │   │            heuristics,observations,fidelity,design-validation,markdown,pixels,tone,
│   │   │            build-contract,qa-run,qa-probes,qa-checks,qa-numbers,qa-lineage,
│   │   │            qa-review}.ts
│   │   └── lib/{runtime-deps,slug,static-server,viewport,home,pins,runlog}.ts
│   ├── dist/design-lens.cjs       # committed tsup bundle
│   └── test/{unit,e2e,fixtures,evaluations}/
├── NOTICE.md                      # licenses of bundled libraries
└── README.md                      # plugin usage docs
```

## Data flow

```
URL ──clone──▶ .design-lens/<slug>/{clone/, manifest.json, screenshots/, REPORT.md}
clone dir ──tokens──▶ tokens.json          clone dir ──inspect──▶ element JSON (stdout, ephemeral)
clone dir + agent ──reverse-design skill──▶ DESIGN.md + VARIATIONS.md
clone dir + agent ──customize-clone skill──▶ edited index.html + assets/dl-overrides.css
DESIGN.md + VARIATIONS.md + product context ──build-from-design──▶ new page + reviewed evidence
evidence screenshots ──tone──▶ tone.json      built page ──qa──▶ qa/<runId>/ ──qa-confirm──▶ review.json
every command ──(best effort, opt-out)──▶ .design-lens/RUNLOG.jsonl
```

Inspection preserves its legacy JSON by default. Opt-in details batch computed styles, direct
light-DOM relationships, selected images and page/font metadata at explicit viewports. Static
tokens remain CSS summaries. The skills distinguish observations, inferences and proposals; new
products adapt structure to their tasks, using existing components/content and three-viewport
visual review plus available behavior checks. Clone-only and analysis-only requests remain bounded.

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

## Evidence-driven capture extension (ADR-023)
Capture -> shared source observation probe -> immutable evidence -> offline canonical clone
render -> pixel/region/geometry comparator -> fidelity report -> bounded skill repair.
The same probe powers comprehensive inspect. Token statistics plus source observations feed
agent-written design blueprints; a read-only validator checks structured observation claims.

## Reference-faithful builds and measured QA (ADR-030)
`tone` turns source full-page screenshots into hash-bound tone profiles. validate-design stays
read-only and pure over its inputs (documents, evidence, fidelity, tone.json, cited QA runs): it
checks Typeface forms, Tone budget, Signature priority, signature retention, the design basis,
the build contract and reference fidelity, and reports document hashes and deterministic scores.
`qa` drives one Chromium per run against a served build (`--dir`) or URL and writes `qa/<runId>/`;
its probes walk light DOM and open shadow roots, and review images carry salted-hash codes that
only `qa-confirm` can turn into `review.json`. `qa-run` validates options and orchestrates the run;
`qa-probes` holds the self-contained in-page probes, `qa-checks` and `qa-numbers` the pure finding
rules, `qa-lineage` the clone/build id comparison and `qa-review` the coded review images. Lite
inspection (`inspect-lite`) is a separate targeted probe.
The run log is attached through commander hooks and never writes to stdout or changes exit codes.
