# Installing design-lens (guide for LLM agents)

You are an LLM coding agent asked to install **design-lens** — a plugin that captures reference
pages, measures design evidence, and applies reusable principles to the user's frontend through
implementation and verification. Read this file end to end, then follow the section that matches the
environment you are running in. Do not summarize this file to the user; act on it.

## 1. Detect your environment

- You are **Claude Code** if you have `/plugin` commands or the `claude` CLI is on PATH.
- You are **Codex CLI** if the `codex` CLI is on PATH.
- You are **Cursor**, **OpenCode**, or another agent otherwise.

Prerequisite for every path: Node.js >= 20 (`node --version`).

## 2. Install

### Local 0.4.0 checkout

Version 0.4.0 is prepared in this repository. Do not claim it is available from npm or a GitHub
release until publication has been confirmed. When asked to validate this checkout, run from its
repository root:

```bash
npm --prefix plugin/cli ci
npm --prefix plugin/cli run build
bash plugin/scripts/bootstrap.sh
~/.design-lens/bin/design-lens --version
```

The expected local CLI version is `0.4.0`. Load or install this checkout's `plugin/` through the
agent's local plugin mechanism to use its updated skills. CLI setup alone does not replace skill
files already installed elsewhere. The public channels below remain available and install the
version published in that channel; they do not guarantee the local 0.4.0 changes.

### Claude Code

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

The install identifier is exactly `design-lens@design-lens` (plugin `design-lens` from
marketplace `design-lens`) — a bare `design-lens` will not resolve. Skills become available as
`/design-lens:clone-reference`, `/design-lens:reverse-design`, `/design-lens:inspect-elements`,
`/design-lens:customize-clone`, `/design-lens:build-from-design`. The runtime provisions itself
on the next session start; no further action needed.

### Codex CLI

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

Codex skips non-managed plugin hooks until trusted: tell the user to run `/hooks` once and trust
the design-lens SessionStart hook, or provision manually right now:

```bash
npx -y design-lens setup
```

### Cursor, OpenCode, and other skills-capable agents

```bash
npx -y skills add mojomoth/design-lens --all -y
npx -y design-lens setup
```

The first command installs the five SKILL.md files where your agent discovers skills
(`.agents/skills/`, `.claude/skills/`, or your agent's global directory — the `skills` CLI
auto-detects). The second provisions the shared runtime at `~/.design-lens/` (CLI bundle, pinned
Playwright, Chromium — the one-time Chromium download is ~150 MB).

### No skills support at all — plain CLI

```bash
npx -y design-lens setup
~/.design-lens/bin/design-lens clone https://example.com
```

## 3. Verify the install

```bash
~/.design-lens/bin/design-lens --version
```

For the local checkout, expect `0.4.0`; for a public channel, report its actual installed version.
If that file is missing, repeat the chosen local bootstrap or public setup path and check again.
Then confirm to the
user which skills are available. Continue an already requested build or analysis; if no task was
given, explain the entry points in the [Korean usage guide](docs/USAGE.ko.md) or
[plugin guide](plugin/README.md).

## 4. Constraints to relay to the user

- Clones are for **private design study**: never deploy or redistribute a clone. Each skill
  carries a pre-ship brand checklist (replace logos, rewrite copy, license photography/fonts).
- Capture handles one page per command. Authenticated-session import is not supported. Rendering
  and asset collection make network requests; source screenshots requested by the skills can load
  the page again. Captured scripts are removed, so application behavior must be implemented and
  verified separately.
- The clone skill captures 1440×900, 768×1024 and 390×844, then compares one editable
  clone with saved source evidence. The CLI diagnoses differences; the skill can make at most
  three repair rounds. A bare CLI `clone` retains its single-viewport default.
- Preserve `evidence.json` and `evidence/`. `fidelity` reports `pass`, `fail` or `unverified` against
  the current clone hashes; missing evidence never means a pass. Older clones without evidence
  remain usable, and any needed recapture belongs in a new project.
- In 0.4.0, captures replace painted videos with posters and retry readiness by default, and
  disclose those substitutions; motion is never verified. `--freeze-timers` is opt-in.
- `validate-design` checks required recipes, recorded measurements, ranked signatures, typeface
  forms, the tone budget (from `tone.json`) and the build contract without editing files; it does
  not establish design intent or application behavior.
- Builds are checked with `qa`, whose review images the agent must open and confirm with
  `qa-confirm`. Builds copy nothing from the clone unless the user explicitly asks for a
  clone-base build. A local `.design-lens/RUNLOG.jsonl` records command timings
  (`DESIGN_LENS_RUNLOG=off` disables it). See the [CLI reference](plugin/cli/README.md).
