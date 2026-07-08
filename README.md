# Design Lens

**Start from great reference designs, not from a blank AI canvas.**

Design Lens is a plugin for **Claude Code** and **OpenAI Codex CLI** that helps you build
aesthetically excellent frontends by starting from reference designs (awwwards-class sites):

1. **Clone** — capture a reference page into a self-contained, pretty-printed local mirror:
   JS-rendered final DOM, CSS-in-JS/shadow-DOM styles preserved, every asset localized, every
   element stamped with a stable `data-dl-id`.
2. **Reverse-design** — read the clone like a senior designer and produce `DESIGN.md`
   (why every decision was made) + `VARIATIONS.md` (new directions that keep the principles).
3. **Customize** — conversationally swap the logo, rewrite nav text, replace the hero image,
   change colors and sizes — the agent edits the clone directly, anchored by `data-dl-id`.

## Install

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

On first session a `SessionStart` hook provisions `~/.design-lens/` (CLI, pinned Playwright,
Chromium). **On Codex you must trust the plugin hook via `/hooks` first, or run
`bash <plugin-cache-dir>/scripts/bootstrap.sh` once by hand** — see
[`plugin/README.md`](./plugin/README.md).

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
