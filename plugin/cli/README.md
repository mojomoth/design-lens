# design-lens

**Start from great reference designs, not from a blank AI canvas.**

The Design Lens CLI clones a reference web page into a self-contained, editable local mirror:
JS-rendered final DOM, CSS-in-JS and shadow-DOM styles preserved, every asset localized, every
element stamped with a stable `data-dl-id` for conversational editing by a coding agent.

This package is the CLI engine of the [design-lens plugin](https://github.com/mojomoth/design-lens)
for Claude Code, OpenAI Codex CLI, Cursor, and OpenCode.

## Install

Pick the channel that matches your tool (full matrix in the
[repository README](https://github.com/mojomoth/design-lens#install)):

```bash
# Claude Code / Codex — plugin channel (skills + auto-provisioning hook)
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens

# Any skills-capable agent (Claude Code, Codex, Cursor, OpenCode, …)
npx skills add mojomoth/design-lens

# Direct CLI use — no plugin system at all
npx design-lens setup        # provisions ~/.design-lens (Playwright + Chromium, one time)
npx design-lens clone https://example.com
```

## Commands

| Command | What it does |
| --- | --- |
| `clone <url>` | Capture a page into `.design-lens/<slug>/` — final DOM, localized assets, report |
| `tokens <projectDir>` | Extract the design-token inventory (colors, fonts, spacing) to `tokens.json` |
| `inspect <projectDir>` | List customizable elements (logo, nav, hero, CTAs) with stable ids |
| `screenshot <projectDir>` | Render the clone to PNG for visual comparison |
| `serve <projectDir>` | Preview the clone on a loopback server |
| `verify <projectDir>` | Check clone-format integrity (provenance, ids, inertness) |
| `setup` | Provision `~/.design-lens` when no plugin hook did it for you |

Cloned pages are inert study material: scripts are stripped, provenance is stamped, and the
[fair-use policy](https://github.com/mojomoth/design-lens/blob/main/plugin/README.md#fair-use--respect-for-designers)
applies — clones are never to be deployed or redistributed.

## License

MIT © mojomoth. Bundled and runtime third-party licenses are enumerated in
[NOTICE.md](./NOTICE.md).
