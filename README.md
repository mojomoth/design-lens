# Design Lens

[한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Start from great reference designs, not from a blank AI canvas.**

Design Lens is a plugin for **Claude Code**, **OpenAI Codex CLI**, **Cursor**, and **OpenCode**
that helps you build aesthetically excellent frontends by starting from reference designs
(awwwards-class sites):

1. **Clone** — capture a reference page into a self-contained, pretty-printed local mirror:
   JS-rendered final DOM, CSS-in-JS/shadow-DOM styles preserved, every asset localized, every
   element stamped with a stable `data-dl-id`.
2. **Reverse-design** — read the clone like a senior designer and produce `DESIGN.md`
   (why every decision was made) + `VARIATIONS.md` (new directions that keep the principles).
3. **Customize** — conversationally swap the logo, rewrite nav text, replace the hero image,
   change colors and sizes — the agent edits the clone directly, anchored by `data-dl-id`.

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
