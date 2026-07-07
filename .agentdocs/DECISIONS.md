# DECISIONS.md — ADR log (append-only)

Format for new entries (append at the bottom, never edit existing ones):

```
## ADR-NNN: <title>
- Date: YYYY-MM-DD · Status: accepted
- Context: <what forced a decision>
- Decision: <what was decided>
- Consequences: <what this binds; name any protected doc files this changes>
```

## ADR-001: Own TypeScript/Playwright clone engine
- Date: 2026-07-06 · Status: accepted (user-confirmed)
- Context: kage (Go) strips all JS but also loses CSS-in-JS (`insertRule`/`adoptedStyleSheets`)
  and shadow DOM, leaves third-party CDN assets remote, and cannot stamp element ids at capture
  time. Modern reference sites depend on exactly those features.
- Decision: build our own engine — Playwright Chromium render → CSSOM-aware serialization →
  sanitize to an inert page → localize all assets → pretty-printed folder mirror.
- Consequences: output contains no JavaScript ("a photograph, not a program"); fidelity work is
  ours; staged M1 (own CSSOM-walk serializer) → M2 (@percy/dom upgrade).

## ADR-002: Customization is agent-conversational; no persistent edit manifest
- Date: 2026-07-06 · Status: accepted (user-confirmed)
- Context: user explicitly rejected a properties.yaml write-back system.
- Decision: element inventory is ephemeral (CLI `inspect` prints JSON to stdout, never written
  into the clone); edits are made by the agent directly on the clone HTML, anchored by
  `data-dl-id`; style edits append to `clone/assets/dl-overrides.css` (a live stylesheet loaded
  last, NOT a manifest); asset swaps go to `clone/assets/custom/`.
- Consequences: no op-layer scripts (no apply-edit tooling); the customization layer stays thin.

## ADR-003: One repo, dual manifests, plugin under `./plugin`
- Date: 2026-07-06 · Status: accepted
- Context: Codex 0.139.0 reads `.claude-plugin/marketplace.json` (verified in the binary) but
  requires its own `.codex-plugin/plugin.json`; installs copy the plugin directory, so harness
  files must live outside the plugin root.
- Decision: repo root is the marketplace (both `.claude-plugin/marketplace.json` and
  `.agents/plugins/marketplace.json`, source `./plugin`); the plugin ships
  `.claude-plugin/plugin.json` AND `.codex-plugin/plugin.json`.
- Consequences: if Codex double-lists the plugin from both marketplace files, delete
  `.agents/plugins/marketplace.json` and rely on legacy compat (record as a new ADR).

## ADR-004: Skills are argument-free and reference only `~/.design-lens/bin/design-lens`
- Date: 2026-07-06 · Status: accepted
- Context: Codex skills have NO runtime placeholder expansion (`$ARGUMENTS`, `$1`, backtick
  interpolation, `{{}}` are skipped by its importer — verified); Codex does not substitute
  `${CLAUDE_PLUGIN_ROOT}` in skill bodies (only in hook processes).
- Decision: shared skill bodies for both tools; frontmatter limited to `name` + `description`;
  target URLs/paths come from the user's message; the only executable path referenced is the
  well-known launcher `~/.design-lens/bin/design-lens`.
- Consequences: five distinct multiword skill names avoid Codex's flat `$name` namespace
  collisions: clone-reference, reverse-design, inspect-elements, customize-clone,
  build-from-design.

## ADR-005: License policy
- Date: 2026-07-06 · Status: accepted
- Context: single-file-cli is AGPL; the plugin is MIT.
- Decision: only MIT/Apache-2.0/BSD/ISC/CC0/MPL-2.0(external-only) dependencies; AGPL code is
  never vendored or imported; `@ghostery/adblocker-playwright` (MPL-2.0) and `playwright`
  stay EXTERNAL to the bundle; bundled licenses enumerated in `plugin/NOTICE.md`.
- Consequences: single-file HTML export is out of scope for v1.

## ADR-006: Harness governance
- Date: 2026-07-06 · Status: accepted
- Context: the two catastrophic loop corruptions are the agent editing its own gates and
  silently rewriting specs to match broken code.
- Decision: `.harness/` is sealed (sha256 manifest + out-of-repo copy, checked every iteration);
  protected docs are editable only via the spec-drift protocol (ADR + minimal edit, same
  commit); ACCEPTANCE.md is only a mirror — the machine gate never reads agent-editable files.
- Consequences: gate hardening lives in `.harness/verify.sh` + `.harness/e2e-assert.sh` only.

## ADR-007: Runtime provisioning via SessionStart hook + `~/.design-lens/`
- Date: 2026-07-06 · Status: accepted
- Context: plugin caches are copied dirs with changing paths; neither tool runs npm postinstall;
  Codex exports CLAUDE_PLUGIN_ROOT/DATA to hook processes (verified) but not to skill bodies;
  `@playwright/mcp` cannot self-provision browsers.
- Decision: SessionStart hook runs `plugin/scripts/bootstrap.sh` (idempotent, fast-path < 1 s,
  never blocks session start): copies the committed CJS bundle to `~/.design-lens/lib/`,
  npm-installs pinned playwright + adblocker into `~/.design-lens/runtime/`, installs Chromium,
  writes the `~/.design-lens/bin/design-lens` launcher.
- Consequences: `plugin/cli/dist/design-lens.cjs` and `package-lock.json` are committed; the CLI
  resolves external deps via a try/require fallback into `~/.design-lens/runtime/node_modules`.

## ADR-008: Pinned Playwright, staged clone-engine milestones
- Date: 2026-07-06 · Status: accepted
- Context: a one-shot loop debugging a never-executed third-party serializer mid-run is the
  likeliest budget burner.
- Decision: Playwright exact-pinned (see `.harness/config.env` PLAYWRIGHT_VERSION); Chromium is
  provisioned by harness bootstrap (agents never run `playwright install`); M1 uses an own
  ~50-line CSSOM-walk serializer, M2 upgrades to @percy/dom gated by the sealed fixture's
  fidelity assertions, M3 is polish/packaging.
- Consequences: the spine stays green throughout; percy problems can't strand the build.

## ADR-009: The harness itself
- Date: 2026-07-06 · Status: accepted
- Context: Ralph-loop research — fresh context per iteration beats in-session looping; agents
  lie about completion; test deletion and placeholder stubs are the common reward hacks.
- Decision: bash loop re-spawning `claude -p` per iteration; dual-gate exit (promise string AND
  sealed `verify.sh`); one task per iteration; auto-commit every iteration; test-count ratchet
  against `ralph-last-green`; stuck detection; cost/iteration caps; Codex leg optional.
- Consequences: all loop memory lives in git + `.agentdocs/`; the loop is resumable.

## ADR-010: `manifest.json` lives at the project-dir root, not inside `clone/`
- Date: 2026-07-08 · Status: accepted (spec-drift, planning iteration)
- Context: the sealed gate `.harness/e2e-assert.sh` (assertion A7, immutable ground truth) reads
  the manifest at `<projectDir>/manifest.json` and resolves each `resources[].localPath` from
  `<projectDir>` (`fs.existsSync(path.join(projectDir, localPath))`). `specs/03-clone-format.md`
  (line 47 + schema) instead placed the manifest at `clone/manifest.json` with `localPath`
  relative to `clone/` (`assets/…`). Following the spec would put the file where A7 does not look
  and would make every `localPath` fail the join — the spine could never pass `--m1`. The two
  cannot both be satisfied; the sealed gate wins (ADR-006).
- Decision: `manifest.json` is written at the project-dir root (a sibling of `clone/`, like
  `REPORT.md` and `tokens.json`); every `resources[].localPath` is rooted at the project dir and
  therefore begins `clone/assets/…`. `specs/03-clone-format.md` is edited in this same commit to
  match (location line + schema `localPath`).
- Consequences: changes `.agentdocs/specs/03-clone-format.md`. Resource references *inside*
  `clone/index.html` and rewritten CSS remain relative to `clone/` (`assets/…`) — unchanged; only
  the manifest's own recorded `localPath` (relative to the project dir) gains the `clone/` prefix.
