# Installing design-lens (guide for LLM agents)

You are an LLM coding agent asked to install **design-lens** — a plugin that clones reference
websites into editable local mirrors, reverse-engineers their design thinking, and customizes
them conversationally. Read this file end to end, then follow the section that matches the
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
~/.design-lens/bin/design-lens --version   # must print a version, e.g. 0.1.0
```

If that file is missing, run `npx -y design-lens setup` and check again. Then confirm to the
user which skills are available and offer to clone their first reference page.

## 4. Constraints to relay to the user

- Clones are for **private design study**: never deploy or redistribute a clone. Each skill
  carries a pre-ship brand checklist (replace logos, rewrite copy, license photography/fonts).
- Single pages only; no login-protected pages; the capture never touches the live site beyond
  the one page load.
