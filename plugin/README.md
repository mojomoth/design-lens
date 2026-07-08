# Design Lens

**Start from great reference designs, not from a blank AI canvas.**

Design Lens is a plugin for **Claude Code** and **OpenAI Codex CLI**. It captures a reference page
into a self-contained local mirror, reads that mirror like a senior designer, and helps you build
new work from what it teaches — without dragging the original's brand along with it.

## Skills

Invoke with `/design-lens:<name>` in Claude Code, or `$<name>` in Codex.

| Skill | What it does |
| --- | --- |
| `clone-reference` | Capture a reference URL into `.design-lens/<slug>/` — a pretty-printed, inert local mirror. |
| `reverse-design` | Read the clone and write `DESIGN.md` (why every decision was made) + `VARIATIONS.md`. |
| `inspect-elements` | List the clone's elements and their roles (logo, nav, hero, CTA) with `data-dl-id` anchors. |
| `customize-clone` | Conversationally swap the logo, copy, imagery, colors and sizes inside the clone. |
| `build-from-design` | Build **new** work from the extracted principles — zero assets copied. The clean path. |

## CLI

The skills drive `~/.design-lens/bin/design-lens`, which you can also run directly. Human progress
goes to **stderr**; machine-readable JSON goes to **stdout**.

```
design-lens clone <url>            # capture → .design-lens/<slug>/{clone,manifest.json,REPORT.md,screenshots}
design-lens tokens <projectDir>    # distill the captured CSS → tokens.json (colors, typography)
design-lens inspect <projectDir>   # element inventory + roles, as JSON on stdout
design-lens screenshot <projectDir> | --url <url>   # PNG of a clone or a live URL
design-lens serve <projectDir>     # serve clone/ on 127.0.0.1
design-lens verify <projectDir>    # check the clone-format invariants; exit 1 on violation
```

Useful `clone` flags: `--viewport 1440x900`, `--timeout <seconds>`, `--settle <ms>`,
`--remove-selector <css>` (repeatable), `--filter-list <file>`, `--no-scroll`, `--no-block-cookies`.

### What a clone contains

```
.design-lens/<slug>/
├── clone/
│   ├── index.html              # final JS-rendered DOM, every element stamped data-dl-id
│   ├── assets/<host>/<path>    # every localized asset, host-namespaced
│   └── assets/dl-overrides.css # yours to edit; linked last so it always wins
├── manifest.json               # every asset's originalUrl + sha256; remote[] for anything left off-box
├── REPORT.md                   # capture results, font hosts, and the license & usage notice
└── screenshots/                # desktop / tablet / mobile PNGs
```

The clone is **inert by design** — no `<script>`, no `on*` handlers. It is a photograph of a page,
not a running program.

## Installation and first run

Install via the marketplace (see the repository root `README.md` for both install blocks). A
`SessionStart` hook then runs `scripts/bootstrap.sh`, which provisions `~/.design-lens/`: the CLI
bundle, the pinned Playwright runtime, and Chromium. It is idempotent, and it never blocks session
start — on failure it prints one actionable line to stderr and exits 0.

### Codex: trusting the hook

**Codex does not run non-managed (plugin) hooks until you trust them.** Until you do, the
`SessionStart` bootstrap silently does not fire and `~/.design-lens/bin/design-lens` will not
exist. Either:

- trust the hook interactively when Codex prompts you, via `/hooks`; **or**
- run the bootstrap yourself, once:

```bash
bash <plugin-cache-dir>/scripts/bootstrap.sh
```

Claude Code runs plugin hooks without this step.

## Fair use & respect for designers

**Reference-driven design is how designers have always worked.** Nobody learns typography, layout,
or motion from first principles in a vacuum — they study work they admire, name what makes it
good, and carry the principle (not the pixels) into something new. Architects sketch buildings.
Painters copy in galleries. Design Lens is that sketchbook, made legible to an AI agent.

**Design Lens keeps you honest by separating studying a design from shipping one.** Those are two
different activities, and this plugin refuses to blur them:

- **Studying** — `clone-reference` and `reverse-design`. Capture the page, take it apart,
  understand *why* it works. The clone exists to be read.
- **Shipping** — `build-from-design` and the `## Before you ship — brand checklist`. Build new
  work from the extracted principles: no logos, no copy, no photography, no assets carried over.
  `build-from-design` is the promoted clean path, and it requires zero assets copied from the
  clone. The checklist runs before you ship, and it ends by grepping your output for the
  reference's brand name — it must return nothing.

**Clones are never to be deployed or redistributed.** A clone is for private design study and
derivation, full stop. Everything inside it — content, images, logos, fonts, text — remains the
property of its owners, and Design Lens licenses none of it to you. Every clone therefore ships
with its provenance recorded: a `## License & usage notice` in `REPORT.md`, a source-URL mapping
for every asset in `manifest.json`, and the origin host of every font file so you can check its
license. The stance is transparency, not blocking: Design Lens records what it took and warns you
loudly, and it trusts you to do the right thing with it.

If you would be uncomfortable showing the original designer what you shipped, the checklist is not
finished.

## License

Design Lens is MIT licensed. Third-party bundled and runtime dependencies are enumerated in
[`NOTICE.md`](./NOTICE.md). Content captured by `clone` is **not** covered by that license and
remains the property of its owners.
