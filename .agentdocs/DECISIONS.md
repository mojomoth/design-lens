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

## ADR-011: A4 forbids the capture host in `clone/` — slug asset host dirs, thin provenance, cross-origin capture
- Date: 2026-07-08 · Status: accepted (spec-drift, T11 build iteration)
- Context: the sealed gate `.harness/e2e-assert.sh` assertion A4 (immutable ground truth) requires
  ZERO `127.0.0.1` occurrences anywhere inside `clone/` (excluding `manifest.json`). Three
  spec-mandated behaviours violate this against the sealed `127.0.0.1` fixture:
  (1) `specs/02-clone-engine.md` urlmap maps assets to `assets/<host>/…` with a non-default-port
      host segment `<hostname>-<port>` = `127.0.0.1-4630` — the literal host appears in every
      rewritten `<link>`/`src`/`url()` in `clone/`; the urlmap unit test even asserted it.
  (2) `specs/03-clone-format.md` provenance comment embeds `<sourceUrl>` on line 1 of
      `clone/index.html`, i.e. `http://127.0.0.1:4630/…`.
  (3) the cross-origin alt-port webfont (`@font-face src: url(http://127.0.0.1:4631/…woff2)`) is
      CORS-blocked at render (verified: Playwright reports `net::ERR_FAILED`, and the sealed CDN
      sends no `Access-Control-Allow-Origin`), so it stayed a live remote URL in `style.css`.
  A4 and these behaviours cannot both hold; the sealed gate wins (ADR-006). Note `specs/09`'s claim
  that the font "is captured during render" is only true once cross-origin capture is enabled (3).
- Decision (generic — no fixture special-casing, per `specs/09-fixture-contract.md`):
  1. The urlmap host segment is SLUGGED: `hostname.replace(/[^a-z0-9]+/gi,'-')` before the
     `-<port>` suffix, so `example.com`→`example-com`, `127.0.0.1-4630`→`127-0-0-1-4630`. Portable,
     Windows-legal, and never embeds a literal dotted host. Hosts differing only by port stay
     distinct via the port suffix. Edits `specs/02-clone-engine.md` urlmap host rule; the T06
     urlmap unit test expectations are updated to the slugged form (count unchanged).
  2. The provenance comment drops the raw source URL: it keeps tool + `--version` + license
     pointer; the source URL and capture time live in `manifest.source` and `REPORT.md` (both
     outside `clone/`, which A4 does not scan). Edits `specs/03-clone-format.md` provenance template.
  3. Chromium launches with `--disable-web-security` + `--disable-features=IsolateOrigins,
     site-per-process` and the context sets `bypassCSP`, so cross-origin CSS assets (the alt-port
     woff2) load and ARE captured during render (satisfies `specs/02` §6 "woff2 fonts captured
     during render" and sealed A15 without an M2 refetch). Documented in `specs/02-clone-engine.md`.
- Consequences: changes `.agentdocs/specs/02-clone-engine.md` and
  `.agentdocs/specs/03-clone-format.md`. Asset directory names are now dash-slugged for all hosts.
  Disabling web security is safe because the clone output is inert (no JS ever runs from the clone)
  and faithful cross-origin asset capture is the tool's purpose. The M2 refetch task (T16) still
  owns UA-specific refetch of resources the page never requests (e.g. unused srcset variants).

## ADR-012: fanboy-cookiemonster cannot satisfy A16 — ship a built-in generic consent ruleset
- Date: 2026-07-08 · Status: accepted (spec-drift, T15 build iteration)
- Context: two specs contradict each other, and the contradiction is empirically verifiable.
  (1) `specs/02-clone-engine.md` §M2 makes fanboy-cookiemonster the ONE default consent list.
  (2) `specs/09-fixture-contract.md` A16 requires `<div id="consent" class="cookie-banner">` to be
      ABSENT from the clone, and `:100-105` forbids any fixture-specific CLI flag from rescuing it —
      "the generic pipeline must produce these results" — while noting the `cookie-banner` class is
      "deliberately generic".
  Measured against the live list (25 750 lines, ~15 272 generic `##` rules): fanboy-cookiemonster
  contains NO generic rule matching either `#consent` or `.cookie-banner`. Both appear only as
  domain-scoped rules (`ft.com###consent`, `sellme.ee##.cookie-banner`, …) plus compound generics
  (`#consent.alert`, `.cookie-banner.toast`) that need a second class the fixture does not carry.
  A loopback capture matches none of them. Confirmed by running `e2e-assert.sh --all` with the
  real downloaded list: `FAIL A16 consent banner present in clone`. So (1) cannot satisfy (2), with
  or without network. An adblocker must be conservative about hiding `.cookie-banner` on every site
  on the web; design-lens photographs ONE page the user explicitly asked to clone, where an
  over-removed cookie bar costs nothing and a surviving one ruins the reference.
- Decision (generic — no fixture special-casing; `specs/09` §24-26 also forbids hardcoded `#consent`
  logic in `plugin/cli/src/`, so nothing below names that id):
  1. `plugin/cli/src/capture/consent-rules.ts` ships `BUILTIN_CONSENT_RULES`: ~22 GENERIC uBlock
     cosmetic rules for unambiguous consent containers (`##.cookie-banner`, `###cookie-consent`,
     `##.cc-window`, …). The sealed banner is removed by the generic `.cookie-banner` class rule.
  2. Default filter text = `BUILTIN_CONSENT_RULES` + `\n` + the remote fanboy-cookiemonster list
     (cache → download → stale cache). Both go through the single `PlaywrightBlocker.parse(text)`
     path spec 02 mandates. A download failure now warns and proceeds with the built-in rules
     (`consentBlocking: "enabled"`), instead of the spec's `"unavailable"` — consent blocking
     degrades to fewer rules, never to none, and an offline clone still loses its banner.
     `"unavailable"` remains for the case where no list can be parsed (e.g. an unreadable
     `--filter-list`).
  3. `--filter-list <file>` REPLACES the whole default text, built-ins included: the user named an
     exact list, and this is what keeps the flag deterministic and offline for tests.
  4. `enableBlockingInPage(page)` is still the entry point (network blocking), but the engine's
     cosmetic verdicts are INTERCEPTED rather than injected: its native behaviour is
     `frame.addStyleTag()` with a `display: none !important` blob (hundreds of KB for a real list),
     which would be serialized into `clone/index.html` and would still leave the banner element in
     the markup. A16 and spec 08's banner e2e both assert ABSENCE, so the intercepted selectors are
     handed to `capture/stamp.ts`, which REMOVES the matches before stamping. Scriptlet injection is
     dropped outright (the clone is "a photograph, not a program").
- Consequences: changes `.agentdocs/specs/02-clone-engine.md` (the §M2 Consent blocking bullet and
  the §3 pre-serialize removal clause). Adds no dependency. Real-world clones now lose consent
  containers matching the 22 built-in selectors even when the remote list is unavailable; each
  selector names a consent UI and nothing else, and `--no-block-cookies` restores the banner.
  Sealed A16 passes offline. `--filter-list` users get exactly the rules they asked for.

## ADR-013: `typography.faces[]` paths are stylesheet-relative, not clone-relative
- Date: 2026-07-08 · Status: accepted (spec-drift, T17 build iteration)
- Context: two specs contradict each other, and the contradiction is empirically verifiable.
  (1) `specs/05-element-inventory.md` §tokens says `faces` = the `src` `url()` paths of matching
      `@font-face` rules "exactly as written in the localized CSS (clone-relative `assets/…` when
      localized, absolute URL when left remote)".
  (2) `specs/02-clone-engine.md` §6 / `specs/03-clone-format.md` make a reference inside a CSS file
      resolve against THAT FILE's directory, not the clone root — `localize.ts` computes
      `path.posix.relative(path.posix.dirname(assetPath), target)`.
  The two clauses cannot both hold. Cloning the `basic` fixture and reading the localized
  stylesheet proves it: `assets/127.0.0.1_<port>/style.css` contains
  `src: url(fonts/brand.woff2)` — a path relative to the stylesheet, which is neither
  `assets/…` nor an absolute URL. Only an `@font-face` written inside an inline `<style>` block
  gets an `assets/…` path, because there the base IS the clone root.
- Furthermore, the `assets/…` form is not merely absent — it is uncomputable under spec 05's own
  rules. Spec 05 mandates that all CSS sources be "concatenated … into one string analyzed by a
  single `analyze()` call". Concatenation erases which stylesheet each `@font-face` came from, and
  without that base there is no way to re-root a stylesheet-relative `url()` at the clone root.
  Honouring the parenthetical would require abandoning the single-`analyze()` requirement.
- Decision: keep "exactly as written" — the load-bearing half of the clause, and the half that
  keeps `tokens.json` a faithful description of bytes on disk — and correct the parenthetical to
  describe what the localizer actually writes. `faces[]` holds the `url()` value verbatim:
  stylesheet-relative inside an external stylesheet, `assets/…` inside an inline `<style>`,
  absolute URL when the face was left remote, `data:` when inlined. No re-rooting, no guessing.
- Consequences: changes `.agentdocs/specs/05-element-inventory.md` (the `typography.faces`
  sentence only). No code, schema, or dependency change — `faces` was always going to carry the
  verbatim value; this ADR stops the spec from promising a prefix the clone format cannot deliver.
  Consumers that need a loadable path (the reverse-design skill) must resolve `faces[]` against the
  stylesheet that declared the face, exactly as a browser does; `tokens.json` deliberately does not
  pretend that a single flat path exists.

## ADR-014: `specs/10-ethics.md` still carried the pre-ADR-011 provenance template
- Date: 2026-07-08 · Status: accepted (spec-drift, T27 build iteration)
- Context: two specs give two different templates for the SAME line — line 1 of `clone/index.html`.
  `specs/10-ethics.md` §Interfaces says
  `<!-- Cloned by design-lens v0.1.0 from <URL> at <ISO date>. For private design study and
  derivation only — see ../REPORT.md -->`, embedding the raw source URL.
  `specs/03-clone-format.md` §Provenance comment says the URL-free form
  `<!-- Cloned by design-lens v0.1.0 at <capturedAt> for private design study and derivation only.
  Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->`.
  ADR-011 decided the URL-free form and edited `specs/03` — but it never named `specs/10`, so the
  superseded template survived there. This is not a stylistic difference: the sealed assertion A4
  (immutable ground truth) forbids ZERO occurrences of the capture host anywhere inside `clone/`,
  and the sealed fixture is served from `127.0.0.1:4630`. Emitting spec 10's template against that
  fixture puts `http://127.0.0.1:4630/index.html` on line 1 of a file inside `clone/` → `FAIL A4`.
  The two specs cannot both hold; the sealed gate wins (ADR-006), and spec 03's form already ships.
- Decision: `specs/10-ethics.md` adopts spec 03's URL-free template verbatim and cites ADR-011 for
  why the URL is absent. Spec 10 keeps everything it uniquely owns — the comment is mandatory,
  undisableable, precedes `<html>`, and its version MUST equal `manifest.tool.version` and the CLI
  `--version` output. That version lock is now enforced by construction rather than by convention:
  `plugin/cli/src/output/provenance.ts` is the single producer (reading the single-source-of-truth
  `VERSION`) and also exports the `PROVENANCE_LINE` regex that `verify` validates with. Those were
  two independent string literals in `clone.ts` and `verify.ts`; `clone` could have emitted a stamp
  its own `verify` rejected. One module, one template, round-trip asserted in unit tests.
- Consequences: changes `.agentdocs/specs/10-ethics.md` (the provenance-comment bullet in
  §Interfaces & contracts, and the §Requirements sentence that pointed at it). No behaviour change —
  the shipped clone already emitted spec 03's form, so no clone on disk is invalidated and no test
  expectation moves. `specs/03-clone-format.md` remains the owner of the template's bytes; spec 10
  now points at it instead of restating it, so the next amendment cannot desynchronize them again.
  The remaining spec-10 Layer-1 duties landed with this ADR's commit (T27): the REPORT.md
  `## Capture results` font-host list, `manifest.remote[]` coverage of un-localizable references,
  and the verbatim stderr completion notice.

## ADR-015: Codex install requires the `<plugin>@<marketplace>` form
- Date: 2026-07-08 · Status: accepted (post-completion, human-supervised)
- Context: the install-stage gate I5 and docs used `codex plugin add design-lens`; codex 0.139.0
  rejects the bare form ("plugin requires --marketplace unless passed as <plugin>@<marketplace>").
  Verified interactively: `codex plugin add design-lens@design-lens` installs and enables 0.1.0.
- Decision: use `design-lens@design-lens` everywhere: README.md, specs/00-product.md,
  specs/01-packaging.md, and `.harness/verify.sh` I5 (harness re-sealed via bootstrap).
- Consequences: changes `.agentdocs/specs/00-product.md`, `.agentdocs/specs/01-packaging.md`;
  the codex leg of `verify.sh --install` now passes instead of demoting to a manual check.

## ADR-016: Distribution channels — npm publication, skills-CLI installs, author normalization
- Date: 2026-07-10 · Status: accepted (post-completion, human-supervised)
- Context: the product owner directed that design-lens be installable on Claude Code, Codex,
  Cursor, and OpenCode. The `npx skills add` ecosystem (vercel-labs `skills`) discovers this
  repo's five skills via `.claude-plugin/plugin.json` (verified locally with `--list`), but it
  copies SKILL.md directories WITHOUT hooks — the SessionStart bootstrap never runs on Cursor or
  OpenCode, and the canonical CLI-availability paragraph (spec 07, verbatim in every skill body)
  only offers plugin-based recovery. specs/00-product.md and specs/01-packaging.md declared npm
  publication of the CLI out of scope; a published npm package (unscoped name `design-lens`,
  verified unclaimed) is the only channel-agnostic way for a skill to self-provision the runtime.
  Separately, the manifests' author/owner metadata (`zipida`) predates publication; the publishing
  GitHub/npm account is `mojomoth`.
- Decision: (a) npm publication of `plugin/cli` as unscoped `design-lens` moves INTO scope, with a
  new `setup` subcommand — a TypeScript port of `bootstrap.sh` sharing the exact version pins — so
  hook-less installs recover via `npx -y design-lens setup`; the committed bundle remains the
  plugin-channel distribution. (b) The canonical paragraph in specs/07-skills.md gains one final
  sentence pointing hook-less installs at `npx -y design-lens setup`; all five SKILL.md bodies
  update in lockstep. (c) author/owner become `{ "name": "mojomoth" }` (no email) in
  `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and spec 01's quoted
  copies of both.
- Consequences: changes `.agentdocs/specs/00-product.md`, `.agentdocs/specs/01-packaging.md`,
  `.agentdocs/specs/07-skills.md`. `bootstrap.sh` stays the plugin-channel provisioner; the pin
  lock (playwright 1.61.1, adblocker 2.18.1) now spans bootstrap.sh, package.json, AND setup.ts,
  guarded by an extended unit test. `plugin/cli/package.json` drops `private: true` and gains
  bin/files/repository/engines; `dist/design-lens.cjs` is rebuilt (setup command) and recommitted
  under the S5 reproducibility gate.

## ADR-017: Claude manifest must not reference hooks/hooks.json; release 0.1.1
- Date: 2026-07-10 · Status: accepted (post-completion, human-supervised)
- Context: the first real remote install (sandboxed `claude plugin install
  design-lens@design-lens` from github.com/mojomoth/design-lens, Claude Code 2.1.206) installs but
  FAILS TO LOAD: "Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded
  file … The standard hooks/hooks.json is loaded automatically, so manifest.hooks should only
  reference additional hook files." Current Claude Code auto-loads the conventional
  `hooks/hooks.json` and rejects a manifest `hooks` pointer at the same path. The sealed gate
  never caught this: I4 asserts install success, not load status, and `claude plugin validate
  --strict` accepts the pointer.
- Decision: remove the `"hooks"` field from `plugin/.claude-plugin/plugin.json` — the standard
  path is auto-loaded, so behaviour is unchanged for the SessionStart bootstrap. KEEP the field in
  `plugin/.codex-plugin/plugin.json`: Codex has its own loader (ADR-003), its auto-load behaviour
  is unverified, and ADR-015's interactive Codex verification passed with the pointer present.
  Because v0.1.0 was already tagged, released, and published to npm, the release rule
  (spec 01 §Manifests: any release bumps version in both manifests and the CLI in one commit)
  applies: this ships as 0.1.1 — version.ts, both plugin.jsons, cli package.json(+lock), dist
  rebuild, and the version literals in the specs and version-lock tests move together.
- Consequences: changes `.agentdocs/specs/00-product.md`, `.agentdocs/specs/01-packaging.md`
  (Claude manifest quote loses its hooks line; version literals), `.agentdocs/specs/02-clone-engine.md`,
  `.agentdocs/specs/03-clone-format.md`, `.agentdocs/specs/10-ethics.md` (version literals only).
  `manifests.test.ts` now encodes the asymmetric contract: Codex manifest points at
  `./hooks/hooks.json`, Claude manifest must NOT carry a `hooks` key. Old 0.1.0 provenance stamps
  remain valid to `verify` (PROVENANCE_LINE is deliberately loose-versioned).

## ADR-018: Responsive inspection preserves the legacy wire format
- Date: 2026-09-14 · Status: accepted (user-approved improvement plan)
- Context: fixed inspection geometry and hidden role candidates undermine responsive design
  reconstruction. Capture already accepts a viewport, but its parser accepts zero dimensions.
- Decision: share positive-safe-integer viewport validation between capture and inspection;
  add optional `inspect --viewport WxH`, preserving the default 1440×900/DSF 1 and JSON shape.
  Every role filters out unpainted candidates, including ancestor opacity, without restricting
  offscreen footers or incorrectly rejecting a child that restores visibility.
- Consequences: `02-clone-engine.md` and `05-element-inventory.md` change in this same commit.
  No inventory persistence, new dependency, capture format change, or harness modification.
  The approved follow-up tasks are recorded as T31–T35 in IMPLEMENTATION_PLAN.md.

## ADR-019: Opt-in computed evidence and direct element inspection
- Date: 2026-09-14 · Status: accepted (user-approved improvement plan)
- Context: four computed style fields and exclusive semantic roles cannot describe nested layout
  containers, responsive token resolution or font fallback. Static CSS tokens intentionally
  estimate relative units and count declarations, rather than observe the rendered page.
- Decision: `inspect --details` enriches selected elements and page metadata; `--id` explicitly
  addresses one light-DOM element, including hidden/boxless containers, with nullable semantic
  labels rather than fabricated roles. Keep the default JSON and tokens.json unchanged. Share
  bounded font readiness between screenshots and inspection; warn on timeout/unavailability or
  failed faces, and include the outcome in detailed inspection.
- Consequences: `05-element-inventory.md` defines the additive interface and errors in this
  commit. `02-clone-engine.md` and `03-clone-format.md` retain font diagnostics from clone
  re-rendering in its warning count and report instead of leaving them only on stderr.
  No new dependency or stored inventory; shadow traversal and automatic multi-viewport
  aggregation remain outside this change. Detailed measurements are batched for selected nodes.

## ADR-020: Analysis separates measured evidence from transferable design proposals
- Date: 2026-09-14 · Status: accepted (user-approved improvement plan)
- Context: CSS occurrence counts were interpreted as painted-area shares, and mandatory reasons
  encouraged certainty about unobserved designer intent. Variations only changed surfaces while
  requiring every new product to keep the reference skeleton.
- Decision: keep DESIGN.md's twelve section prefixes and existing artifact paths, adding evidence
  provenance/limitations and observed, inferred, proposed, unavailable distinctions. Require
  capture-size and mobile evidence or an explicit gap. Use rendered detailed inspection to
  corroborate static estimates, never assign visual-area percentages from CSS counts. Reusable
  principles state evidence, possible reason, applicability, implementation and verification.
  Default to three variations with a recommendation; distinguish clone-compatible token swaps
  from intentional new-product structure changes, recording the target and selection in the
  existing VARIATIONS.md. Explicit analysis-only requests still end at the analysis artifacts.
- Consequences: `04-design-analysis.md`, `05-element-inventory.md`, and `07-skills.md` change in
  the same commit as the reverse-design skill and templates. No new artifact schema, command,
  dependency, or CLI token algorithm is introduced by this step.

## ADR-021: Requested production work continues through adaptation and verification
- Date: 2026-09-14 · Status: accepted (user-approved improvement plan)
- Context: capture and inspection stopped at offers, and new builds required a second choice
  and copy approval even when the conversation already supplied enough context. Optional image
  comparisons let structural verification be mistaken for design quality. The customization
  rule forbidding edits anywhere in screenshots contradicted its own after-image procedure.
- Decision: preserve five portable skills and their canonical availability/brand sections, while
  carrying explicit user intent across capture, analysis, selection, implementation and checks.
  Ask only for essential unresolved information. New products reuse applicable principles with
  intentional structural adaptations in the existing VARIATIONS.md. Existing stacks and content
  take priority. Require viewed responsive images and available behavior checks, preserving
  source captures and distinguishing structural checks from visual validation. Analysis-only
  and clone-only requests still finish at their requested artifacts; local work does not publish.
- Consequences: `06-customization.md` and `07-skills.md` change in this same commit as the four
  remaining skill procedures. The CLI interface and output format are unchanged in this step.

## ADR-022: Evaluate product adaptation and synchronize the local 0.2.0 release
- Date: 2026-09-14 · Status: accepted (user-approved improvement plan)
- Context: CLI assertions cannot establish that agent-written design work transfers principles
  to different product tasks. The release also needs version/help/docs/bundle coherence. An
  independent implementation review found that an actual stalled font held navigation's load
  event open before the new FontFaceSet timer could start; synthetic readiness tests missed it.
- Decision: add an authored loopback-only reference and two complete product briefs, execute
  fresh independent skill runs and separately review their actual evidence and behavior. Keep
  the protocol and results in the CLI test tree, generated artifacts in isolated temp directories,
  and treat visual review as recorded judgment, not a numerical unit-test claim. Bound font-only
  initial requests before load in bare inspect/screenshot pages while preserving non-font load readiness,
  HTTP/redirect/CORS semantics and the existing after-load readiness timer. Browser-followed
  redirect hops retain native loading/CORS behavior plus after-load readiness; navigation failures
  still exit 1. This guard does not promise a five-second total request chain or command. Propagate
  fallback diagnostics and add real local network regressions. A second review reproduced
  Playwright screenshotting implicitly waiting for the same pending font after our timer expired.
  On timeout/unavailable readiness only, use Chromium's current-paint screenshot with matching
  viewport/full-page/DSF geometry; normal ready screenshots and original capture navigation
  stay unchanged. Add real after-load font tests to prevent that hidden wait from returning.
- Consequences: `00-product.md`, `01-packaging.md`, `02-clone-engine.md`, `03-clone-format.md`,
  `05-element-inventory.md`, `08-testing.md`, `10-ethics.md` and `ARCHITECTURE.md` change in this
  commit for current product behavior, evaluation, font bounds and version literals. Both plugin
  manifests, package/lock, CLI version/help/tests and reproducible distribution move to 0.2.0;
  English/Korean examples and CLI documentation describe the same workflow. No dependency,
  harness change, external publication or installed-plugin evaluation is introduced.

## ADR-023: Measured responsive fidelity and implementation-ready analysis
- Date: 2026-09-27 · Status: accepted (explicitly user-approved implementation plan)
- Context: all 454 unit and 117 E2E tests pass, but PNG byte size and structural invariants do
  not establish visual fidelity. Local probes reproduced URL coverage gaps and misleading token
  extraction. The user selected static responsive fidelity, automatic evidence-led repair, and
  an implementation-ready design blueprint across multiple site types.
- Decision: independently capture source states at requested viewports, preserve immutable source
  observations/assets, compare the same editable clone offline, and report pass/fail/unverified.
  Add clone --viewports, fidelity, validate-design, and comprehensive/batch shadow-aware inspect.
  Source observations are capture provenance, never an edit manifest; inspect remains ephemeral.
  Capture repair may reconstruct bounded static regions using source evidence, preserving IDs,
  with at most three skill-driven rounds and all-viewport revalidation. Original captures remain
  unchanged. Unsupported or truncated evidence cannot certify fidelity.
- Dependencies: allow pixelmatch 7.2.0 (ISC), pngjs 7.0.0 (MIT), and pngjs typings for PNG
  comparison in the bundled runtime. Record their licenses in NOTICE and retain the 2 MiB limit.
- Compatibility: existing single-viewport capture/verify and legacy project reads remain valid.
  Missing evidence yields unverified. Token schema 2 explicitly represents alpha and unavailable
  spacing; migrate internal consumers. DESIGN.md keeps twelve headings and gains implementation
  recipes plus validated observation tables. New validate-design requires agent-authored analysis;
  structural verify does not. Prepare version 0.3.0 after all implementation and evaluation pass.
- Consequences: update 00-product.md, 02-clone-engine.md, 03-clone-format.md,
  04-design-analysis.md, 05-element-inventory.md, 06-customization.md, 07-skills.md,
  08-testing.md, CONVENTIONS.md and ARCHITECTURE.md in this commit. These additions supersede
  the earlier ban on automated visual thresholds and persisted capture observations, not ADR-002's
  prohibition on edit manifests. Runtime capture remains a single public page without source JS.

## ADR-024 — Bounded capture and honest embedded-document verification (2026-09-27)

The T38 source review found that iframe pixels can be retained while a small required element
inside the frame escapes the parent image tolerance. Until frame-scoped observations are
available, accessible frames remain editable static documents but make source coverage incomplete;
fidelity must return unverified. This narrows the implementation claim, not the acceptance policy.
Source state is anchored by an optional manifest evidenceHash and checked against prior reports.

Chromium disables browser timers when JavaScript is globally disabled, including the measurement
runner's readiness timers. Offline fidelity therefore applies a script-src none response policy
before parsing, audits recursive active content, and retains browser instrumentation with a
Node-side readiness deadline. No captured source program executes. Navigation's native timeout
replaces an uncancelled Promise.race timer; both viewport and full-page pixel budgets are checked.
Minimal clarifications update specs/02-clone-engine.md and specs/03-clone-format.md.

## ADR-025 — Precise observation and blueprint interfaces (2026-09-27)

T39 implements the approved breaking token schema 2: alpha-preserving CSS/OKLCH and cluster
values, unknown font usage when the selector subject does not establish a role, nullable spacing
bases without alignment evidence, and explicit declaration provenance, assumptions and unresolved
values. Repeated direct values remain useful when no 4/8 grid is supported. Existing meaningful
regressions remain, with hairline/schema assertions updated to the newly approved contract.

Inspect retains the default role inventory and extends detailed/batch/all measurements through
one shared observation. Source body measurements are optional for old evidence compatibility.
An explicit ID still addresses document roots and hidden nodes as well as open shadow descendants.
The design validator checks required recipes and a capture-scoped observation table, with units
and decimal precision declared per row. Valid source measurements remain usable when a clone
report is absent or stale; only clone claims depend on that current render. Prose interpretation
and implementation sufficiency require independent evaluation. Exact field and table contracts
replace obsolete wording in specs/04-design-analysis.md and specs/05-element-inventory.md.

## ADR-026 — Portable repair and blueprint workflows (2026-09-27)

T40 connects all five skills to T38/T39 evidence and validation, including a maximum of three
source-grounded repair rounds with best-result restoration, all-viewport checks and unchanged
source hashes. Intentional customization differences remain authorized differences; they are
never undone simply to match the source. New clone-only elements receive unique numeric IDs
without acquiring identity from another capture. Original stamps remain unchanged.

An existing edit rule requiring all overrides in the document stylesheet cannot address an
open shadow descendant. specs/06-customization.md permits a newly appended scoped override
style in the owning declarative shadow template when an exposed host property/part is absent;
captured styles remain untouched and the appended block is recorded for undo. This is an
implementation consequence of the approved shadow-aware inspection, not a new product scope.

The workflows are evaluated with independent local tasks: real responsive clone repair, source
analysis with validated recipes, and a separate developer reproducing the design from only the
blueprint. Outcomes and limits are recorded in test/evaluations rather than inferred from CLI
format checks or fluent analysis prose.

## ADR-027 — Prepare the coherent 0.3.0 release (2026-09-27)

The approved T41 release replaces the previous 0.2.0 lock with 0.3.0 in both plugin manifests,
CLI package and lock metadata, VERSION, release assertions and the rebuilt CJS bundle. This
updates the current contract and examples in specs/00-product.md, specs/01-packaging.md,
specs/02-clone-engine.md, specs/03-clone-format.md, specs/10-ethics.md and ARCHITECTURE.md.
Historical releases, ADRs, evaluation outcomes and completed task descriptions retain their
original versions. No assertion is removed or relaxed to accommodate the version change.

English/Korean entry points, installation guidance and the CLI reference describe the actual
three-view skill versus legacy single-view CLI default, fixed fidelity policy, immutable evidence,
capture-local IDs, bounded agent repair, schema-2 token compatibility and read-only blueprint
validation. Accessible frame snapshots remain unverified for incomplete child measurements.
A locally prepared package is not a claim of npm/GitHub publication or installed cache updates.

The bundle must reproduce from committed sources; package contents, matching notices and both
plugin versions are checked locally, followed by the complete strict sealed gate. Runtime setup,
remote publication and changing the user's installed plugin are separate actions from preparing
this release.

## ADR-028 — Preserve sampled responsive DOM and repair capture losses (2026-09-28)

The user approved direct Tenity reproduction and engine fixes, including responsive structure
preservation. A fresh 0.3.0 run produced a fully transparent WebGL hero, an unrestored Percy video
poster, ongoing RAF mutations, mobile navigation with a 1ms budget, and no diagnostic comparisons.
Tenity also deletes inactive device DOM and creates block children inside paragraphs that HTML
parsing reparents. These are reproducible capture/serialization gaps, not clone customization.

Whole captured DOM variants in declarative open shadow roots avoid guessing correspondence among
deleted nodes and text animation wrappers. CSS midpoint ranges select sampled states; they are
not claims about original breakpoints. Root/body proxies, media-gated document fonts, shared
overrides, globally unique canonical IDs and explicit capture provenance preserve the existing
inspection/editing contract. Detached paragraph normalization uses selector-aware aliases rather
than altering the original evidence or copying all computed styles into fixed dimensions.

This updates specs/02-clone-engine.md and specs/03-clone-format.md: the first capture is no longer
the sole canonical DOM for explicit multi-viewport requests, and canonical resources include all
composed variants. Source files and their hashes remain immutable. Incomplete but intact evidence
may generate diagnostic comparisons without earning a pass. Existing numerical thresholds and
negative controls remain unchanged. No dependency addition or source JavaScript replay is needed.

Implementation is split into T42–T47, with local-only regression fixtures and a separate manual
live-web validation. Unsupported transformations and original server failures remain disclosed;
completion does not mean every source page can be certified. No publishing or installed-runtime
replacement is part of this change.

ADR-028 implementation clarification (T46): specs/03-clone-format.md records a separate composition
hash because source correspondence lives outside clone/. Saved clone measurements must become
stale after metadata edits. Manifest-backed identities, shadow paths and generated wrappers are
validated before they affect fidelity; raw DOM attributes cannot grant exemptions. Inactive
variants do not consume ordinary active-page measurement limits. Static shadow isolation cannot
retarget future shared html/body/:root override selectors, so that limitation is diagnosed and
proxy IDs remain the supported root-edit address. No source evidence or numerical policy changes.

## ADR-029 — Preserve screenshot state and remembered offscreen layout (2026-09-28)

T47's live evaluation found exact first-viewport pixels at all three Tenity sizes but two remaining
full-page defects. Chromium's screenshot operation dispatches resize events that can clear a frozen
WebGL buffer. Separately, a fresh static renderer loses content-visibility:auto's remembered footer
size, although the captured child layout is intact. Local fixtures reproduce both independently.

Update specs/02-clone-engine.md with a temporary screenshot-only script pause and detached intrinsic
size fallbacks. Restore script execution in all completion/failure paths and retain later source
consistency checks. Intrinsic fallbacks retain auto skipping and normal editable layout rather than
forcing hidden content to paint or setting fixed element dimensions. The live DOM, saved evidence,
comparison thresholds and intermediate-viewport guarantee remain unchanged.

## ADR-030 — Reference-faithful builds, measured build QA and stabilized capture (2026-10-06)
- Date: 2026-10-06 · Status: accepted
- Context: A four-arm comparison (one Korean public-program landing page built from one
  technology-lab reference; two arms used the 0.3.0 plugin, two used the same models without it;
  n=1 per arm, LLM judges) ranked both plugin arms below the pure arms, mainly on reference
  fidelity (judge averages 7.20 and 6.30 against 8.30 and 8.28). Observed causes: (1) the brief
  asked to build from the clone while build-from-design forbade clone markup, so the clone was
  copied and discarded (0 retained data-dl-id) and a self-written lineage file overstated reuse;
  (2) DESIGN.md capped Signature Moves at two or three and recorded the display face only as
  family and size, so the pixel/techno face, corner squares, clipped-corner buttons, carousel
  chrome, marquee hero and light closing footer band were lost; (3) builds added full-bleed dark
  bands (14–42% of page height against 0% in the reference) and fonts no document specified;
  (4) a direction was chosen before DESIGN.md existed, several writers overwrote VARIATIONS.md,
  and every variation dropped the same signatures; (5) verification missed dead span tabs,
  stand-in in-page links, a fixed button over a CTA, a solid white icon, a masked 5 px overflow and
  invented durations, and screenshots were created but not viewed; (6) every capture was
  incomplete (skipped videos, unloaded lazy images, state changes), so fidelity stayed unverified;
  (7) `inspect --all --details` produced about 57 MB per viewport and helper CLI runs left no
  per-phase timing. Dark bands and dead tabs also occurred in a pure arm, so these checks are
  value the plugin can add, not only plugin regressions.
- Decision:
  - Build modes. `derive` (default) never copies the clone into the target. `clone-base`, only on
    an explicit user or brief request, copies the editable clone into the target once, keeps its
    skeleton, grid, layout stylesheets and data-dl-id values, deletes every copied captured image,
    font, icon and media file, replaces all text, imagery, logos, icons, fonts and media with
    customize-clone mechanics on the copy, and gives retained controls real behavior or removes
    them. The study clone stays untouched. Lineage is measured by `qa` (`build-lineage.json`),
    never self-described.
  - DESIGN.md gains three required tables: `### Typeface forms` (form classes from the glyphs,
    OFL substitutes of the same class; at least one row whose Role matches
    `/display|heading|headline|title|hero|디스플레이|헤드라인|헤딩|제목|타이틀|히어로/i` (Korean role names count,
    because skills write prose in the user's language); Form features fails when, ignoring case, quotes and
    whitespace, it equals the row's source family or an OFL substitute family, or names fewer than
    two distinct features from an exported English/Korean vocabulary listed in LENSES.md), `### Tone budget` (pixel-derived shares from a new `tone`
    command that reads the source screenshots and writes `tone.json`) and `### Signature priority`
    (five to ten ranked devices with Kind, cited evidence, transfer and build check).
  - VARIATIONS.md gains `## Signature retention` (per-variation decisions scored
    deterministically), a `**Design basis:**` hash of the three tables, an optional quoted
    `**Selection basis:**`, a parsed `### Build contract` (mode, fonts, display-fonts, dark maxima,
    stylesheets, `check:<rank>` rows) and `## Reference fidelity`, required once build QA ran and
    bound to the newest confirmed QA run. validate-design stays read-only and reports schemaVersion
    2 with `documents`, `variationScores` and `referenceFidelity`.
  - New `qa` and `qa-confirm` commands measure a built page (dead controls, stand-in links, fixed
    overlap, clipped content, solid icons, unsourced numbers, images, fonts, requests, source
    assets/text, brand residue, font/tone drift, signature checks, lineage) and require review
    images to be viewed: each carries a random code whose salted hash is stored, and only matching
    codes write `review.json`, whose proof value validate-design checks against qa.json, so a
    hand-written confirmation does not count. A cited run must also have used `--project`.
  - `inspect --lite`, repeatable `--selector` and `--viewports` give compact targeted measurements
    in one browser run; default inspect output is unchanged.
  - Capture stabilization: `--media` (default `poster`), `--lazy-images` (default `eager`),
    `--readiness-ms`, `--readiness-retries`, `--freeze-timers` (opt-in) and `--capture-attempts`.
    Disclosed substitutions and stabilizations keep a capture complete; motion is never verified.
  - Review amendments before release: qa fails a main document with HTTP ≥ 400 (`navigation`);
    dead-control counts scroll and popover/details toggle events; solid-icon skips an icon an
    overlay covers (not status-affecting); hash routes (`#/x`, `#!/x`) are destinations; a
    fragment target inside a shadow root fails with that reason unless a click scrolls it into
    view; font-drift fails display headings whose glyphs a platform fallback paints (CDP
    `getPlatformFontsForNode`); inlined captured style blocks are counted against the contract's
    `stylesheets`. Capture removes `--remove-selector` matches re-inserted after stamping, judges
    unloaded images hidden only by CSS or explicit zero size, keeps `<noscript>` unrendered during
    paused screenshots, and the fidelity re-render uses the capture's media policy. Lite elements
    carry `src` (`<captureId>/<dl-N>`). validate-design fails Reference fidelity whose cited run
    checked another Build contract or mode, and accepts emphasis around the selected letter.
  - Evaluation amendments (false-positive and cost reductions, enforcement unchanged): fidelity
    masks the boxes of stopped marquees on both sides of the pixel comparison (their stop offset
    differs between capture and re-render; geometry is still compared); fixed-overlap does not
    report coverage below 5% by a bar pinned to the viewport top unless it covers the centre;
    the five-labels-share-one-URL warning applies to bare site roots only (card grids share real
    listing pages); compare sheets scale both pages by one factor (taller ≤ 1568 px) and pad the
    shorter; qa.json records per-viewport `controls` counts and console errors carry their script
    location; run-log records carry verdict commands' `verdict`, and an `abort` mark closes an
    interrupted window that the summary reports apart.
  - A local, best-effort, opt-out `RUNLOG.jsonl` in the enclosing `.design-lens` directory records
    each command (agent role, exit code, duration, phases) plus `runlog` phase marks.
  - Skills: one writer for DESIGN.md/VARIATIONS.md; direction selection only after DESIGN.md
    validates without `fail`, an explicit user choice always wins, otherwise the highest retention
    score when the brief prioritizes the reference's design language; completion is claimed only
    after a confirmed QA run and validate-design without `fail`. Both brand checklists become
    identical and gain the clone-base markup/stylesheet item.
- Consequences: update specs/00-product.md, specs/01-packaging.md (version literals),
  specs/02-clone-engine.md, specs/03-clone-format.md, specs/04-design-analysis.md,
  specs/05-element-inventory.md, specs/06-customization.md, specs/07-skills.md,
  specs/08-testing.md, specs/10-ethics.md and ARCHITECTURE.md. This supersedes, explicitly:
  spec 04's two-or-three Signature Moves wording and its fixed required-subheading list; its ban on
  an "automated design score" and "extra analysis-state files" for `variationScores`,
  `referenceFidelity.score`, `tone.json`, `qa/<runId>/*` and `RUNLOG.jsonl`; its "not identical
  reference pixels" sentence for tone budgets; and its CSS-count-versus-painted-area rule, which
  now permits labelled pixel-derived tone from source screenshots while declaration counts stay
  non-area evidence. Spec 05's out-of-scope image-derived analysis line is narrowed to allow
  `tone`, and inspect still writes nothing in the project. Spec 06's captured-CSS and
  captured-asset restrictions apply to the study clone only. Spec 07 and 10's "copy zero
  assets/text/logos" holds for both modes: clone-base keeps markup and stylesheets only, disclosed
  through the checklist. Spec 08's ban on numerical LLM quality scores stands: the new numbers are
  deterministic consistency gates over agent-authored tables, not design-quality judgments.
  Spec 05 adds `--lite`, `--selector` and `--viewports` to the inspect command line and selection
  rules. Spec 03's evidence and manifest shapes gain the optional `stabilization` and
  `substituted[]` fields, REPORT.md gains disclosure lines under existing headings, and the
  project layout gains `tone.json`, `qa/<runId>/` and the run-log location. Spec 02's media
  default changes from leaving media remote to `poster` (`--media remote` keeps the old behavior)
  and its command table gains the stabilization flags. Spec 00's command list, output root and
  zero-copy build rule gain `tone`, `qa`, `qa-confirm`, `runlog` and the clone-base mode. Spec 01's
  version literals become 0.4.0.
  Unchanged: ADR-002 (no edit manifest; inventory stays ephemeral), clone inertness, REPORT
  headings and notice, the remote[] reason enum (substitutions use a new optional
  `substituted[]`), fidelity thresholds and the ADR-028 negative controls, five skills and their
  descriptions. No dependency addition, harness change or publication. Version 0.4.0 moves through
  code, manifests, specs and docs together (ADR-017); the 0.4.0 skills are evaluated with fresh
  local runs before the release task, recorded under test/evaluations/0.4.0.
  Evaluation consequences (test/evaluations/0.4.0/RESULTS.md): the live recapture showed that part
  of the baseline's cause (6) was a capture-tool artifact present since 0.3.0 (`<noscript>`
  rendered after a paused screenshot, shifting every later element), not the site; capture now
  keeps it unrendered, and a fixture reproduces it. The tone margins measured on the four builds
  separate full-bleed dark cleanly but darkShare only narrowly, so the template relies on
  `full-bleed-dark-max` and keeps `dark-share-max` at the loosest accepted value. The end-to-end run
  showed that Reference fidelity could cite a QA run made under another Build contract, which led
  to the contract binding above and to one recorded build per study project. Accepted limits:
  Korean Role names do not satisfy the display-row rule (English role words are required); a
  qa.json written before the binding (no recorded contract) is not rejected; validate-design does
  not recompute tone.json profiles; dead-control clicks at most six members per group; the
  clone-base skeleton comparison is trivial on short pages.
