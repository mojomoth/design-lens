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
~/.design-lens/bin/design-lens --version   # this release: 0.2.0
```

If that file is missing, run `npx -y design-lens setup` and check again. Then confirm to the
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
