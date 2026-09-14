# Design Lens

[한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Turn reference designs into frontends for your product.**

Design Lens helps **Claude Code**, **OpenAI Codex CLI**, **Cursor**, and **OpenCode** study a
reference page and build a new interface from the principles it demonstrates. Version **0.2.0**
connects measured design evidence, adaptable directions, implementation, and verification:

1. **Clone** a rendered reference page into an editable local snapshot. Available styles and
   assets are localized; the report identifies resources and content that could not be captured.
2. **Gather evidence** from source/clone screenshots, computed layout and typography, and desktop
   and mobile views. Keep observations, inferences, proposals, and missing evidence distinct.
3. **Reverse-engineer** the design into `DESIGN.md`: supported patterns, possible reasons,
   component recipes, and transferable principles.
4. **Adapt** those principles in `VARIATIONS.md`: three directions by default, with a target brief,
   selected direction, structural changes, and verification criteria.
5. **Build** in your existing stack using your content and assets. The same reference can inspire
   a landing page or a management interface with different navigation, density, and components.
6. **Verify** the rendered result at desktop, tablet, and mobile sizes, exercise relevant controls
   with available browser tools, and fix failures. Checks that could not run stay explicit.

Clone customization remains available for local study: change copy, imagery, colors, and sizes
while preserving the captured source. New product structures belong in a new implementation.

## Try it

Claude Code:

```text
/design-lens:build-from-design Use https://example.com as a reference for our analytics dashboard. Build in this repo and verify the result.
```

Codex:

```text
$build-from-design Use https://example.com as a reference for our analytics dashboard. Build in this repo and verify the result.
```

A build request includes any missing capture and analysis, a recommended direction, implementation,
and checks. The agent uses the conversation and repository first, asking only for missing essentials
or consequential unresolved choices. It does not require approval again at every transition.

For study alone, use `reverse-design` and say “analyze only”; for just a capture, use
`clone-reference` and say “clone only.” Those requests finish at their stated scope. Publishing
requires a separate explicit request. See the [five skills and CLI options](./plugin/README.md).

## Install

| Agent | Recommended channel | Runtime provisioning |
| --- | --- | --- |
| Claude Code | plugin (below) or `npx skills` | automatic (SessionStart hook) |
| Codex CLI | plugin (below) or `npx skills` | trust the hook via `/hooks`, or the fallback below |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` on first use |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` on first use |

### Channel 1 — plugin (Claude Code / Codex)

Claude Code:

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

Codex CLI:

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

On first session a `SessionStart` hook provisions `~/.design-lens/` (CLI, pinned Playwright,
Chromium). **On Codex you must trust the plugin hook via `/hooks` first, or run
`bash <plugin-cache-dir>/scripts/bootstrap.sh` once by hand** — see
[`plugin/README.md`](./plugin/README.md).

### Channel 2 — `npx skills` (any skills-capable agent)

```bash
npx skills add mojomoth/design-lens          # auto-detects installed agents
npx skills add mojomoth/design-lens -a cursor -a opencode   # or target specific ones
```

Agents installed this way have no provisioning hook; the skills self-heal by running
`npx -y design-lens setup` on first use (or run it yourself once).

### Channel 3 — plain CLI via npm

```bash
npx design-lens setup                        # one-time: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # or use the CLI directly, no plugin at all
```

**For LLM agents** — paste this into your agent:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Dev loop (no install): `claude --plugin-dir ./plugin`. A local absolute path also works in place
of `mojomoth/design-lens` for `marketplace add`.

Skills (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> The clone feature is for **private design study and derivation**. Every clone ships with a
> license notice and a pre-ship brand checklist: replace logos, rewrite copy, license or replace
> photography and fonts before shipping anything derived. Clones are never to be deployed or
> redistributed — see [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Repository layout

Development checks include CLI regression tests and a separate
[two-brief skill evaluation](./plugin/cli/test/evaluations/README.md) using the same local
reference for a product introduction page and a management interface. Its recorded results
describe inspected evidence and limitations; structural `verify` is not a design-quality score.

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Autonomous development (the harness)

This plugin is built one-shot by a Ralph loop — fresh agent context per iteration, all memory on
disk, a sealed programmatic verification gate. To run it:

```bash
./.harness/bootstrap.sh     # one-time: git init, Chromium, fixture self-test, integrity seal
./.harness/ralph.sh plan    # planning loop: 3-critic debate → IMPLEMENTATION_PLAN.md
# recommended human checkpoint: skim .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # build loop: one task per iteration until the strict gate is green
```

Monitor from another terminal:

```bash
./.harness/ralph.sh status                     # current task / iteration / cost
tail -f .harness/logs/current/*.stderr         # live agent output
cat .harness/status/verify-feedback.md         # what the gate told the next iteration to fix
touch .harness/STOP                            # graceful stop; resume with: ralph.sh resume
```

Budgets and models are tunable in `.harness/config.env`. The loop exits only when the agent's
completion claim AND the independent sealed gate (`.harness/verify.sh --strict`) both pass.

## License

MIT. Third-party bundled and runtime dependencies are enumerated in
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Content captured by `clone` is not covered by that
license and remains the property of its owners.
