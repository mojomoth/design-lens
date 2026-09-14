# design-lens

**Capture references and measure the design you can actually see.**

Design Lens **0.2.0** captures a rendered reference page into an editable local snapshot and
measures its layout, typography, responsive reflow, and addressable elements. Available assets
are localized; warnings and remote-resource entries describe capture limits. Original scripts
are removed, so the result does not recreate the source application's behavior.

This package is the CLI engine of the [design-lens plugin](https://github.com/mojomoth/design-lens)
for Claude Code, OpenAI Codex CLI, Cursor, and OpenCode. Its skills turn evidence into `DESIGN.md`
and adaptable `VARIATIONS.md`, then build and verify new work when requested. The CLI itself
supplies capture and measurement; it does not generate those design documents or application code.

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
| `clone <url>` | Capture one page with localized assets, provenance, warnings and source/clone images. |
| `tokens <projectDir>` | Write captured CSS color, typography, spacing and motion statistics to `tokens.json`. |
| `inspect <projectDir>` | Print the current visible role inventory; optional detailed or direct-ID measurements. |
| `screenshot <projectDir>` | Render a clone to PNG; use `--url <url>` instead for a live page. |
| `serve <projectDir>` | Preview the clone on a loopback server. |
| `verify <projectDir>` | Check clone-format integrity: provenance, IDs, asset paths and inertness. |
| `setup` | Provision `~/.design-lens` when no plugin hook did it. |

Use the `projectDir` returned by `clone`; repeated captures may receive suffixed names. Examples
below use an illustrative project path. Inspection prints JSON to stdout and progress/warnings
to stderr, without writing an inventory file.

## Responsive and detailed inspection

```bash
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 390x844 --details --pretty
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 1440x900 --kind hero-heading --details
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 390x844 --id dl-17 --pretty
```

| Option | Behavior |
| --- | --- |
| `--viewport WxH` | Measure at positive integer CSS-pixel dimensions; default 1440×900. |
| `--details` | Add computed styles, parent/child IDs, selected image source and page metadata. |
| `--id dl-N` | Measure one stamped light-DOM element, including hidden elements; implies details. |
| `--kind <role>` | Restrict to logo, nav-link, hero-heading, hero-image, cta, footer or section. |
| `--pretty` | Indent JSON instead of the default single line. |

Bare `inspect` keeps the original `{elements, colors}` shape, 1440×900 viewport and DSF 1.
Roles now exclude hidden candidates. `--viewport` alone keeps that JSON shape; `--details` and
`--id` add `page` and per-element `details`. Inspection always describes the current local clone,
including custom overrides; repeat it after edits.

Direct ID lookup is independent of role selection and cannot be combined with `--kind`.
An unclassified target has `role: null` and `confidence: null`; a hidden or `display: contents`
container can still return useful style details. A missing/duplicate ID or malformed option exits
1; an empty role result exits 0. Shadow-root descendants are outside this lookup.

Details include typography, box sizes and spacing, borders, grid/flex layout, overflow, visibility,
`parentDlId`, `childDlIds` and `currentSrc`. Parent/child IDs describe direct relationships,
including hidden children. Follow a parent ID to inspect its container. `page` includes viewport,
DSF, root font size, body measurements and font readiness; body itself has no capture ID.
`currentSrc` reports the selected image separately from its editable `src` attribute.

An initial font request that stalls before the load event is aborted after five seconds so fallback can
render; normal stylesheet/image loading still waits for completion. Redirected font hops retain normal
browser navigation/CORS behavior and the after-load readiness check; if navigation itself fails,
the command exits 1 without returning measurements. If font readiness itself times out or is
unavailable, screenshots capture the current painted fallback with a warning, without waiting
for the same fonts again. Font readiness waits up to 5000ms after navigation. `page.fonts` reports `ready`, `timeout` or
`unavailable` and any `failedFamilies`; failures also produce stderr warnings. Ready means the
font-loading check settled, not proof that every glyph used the intended face. A fallback can
change wrapping and dimensions, so retain that limit when interpreting measurements.

## Interpret and verify the evidence

`tokens.json` is a source-CSS summary. Its color counts are declaration occurrences, not screen
area or semantic importance. Palette, spacing and type-scale values are estimates; rem/em lengths
are converted with a fixed 16px assumption. Inactive rules, CSS variables and inherited values may
make these differ from rendered measurements. Use detailed inspection at the relevant viewport
for actual component values, and keep missing source behavior unknown.

For a matched mobile comparison, use equal viewport, scale and full-page mode, and new filenames:

```bash
~/.design-lens/bin/design-lens screenshot .design-lens/example-com --width 390 --height 844 --dsf 1 --full-page --out clone-mobile-1.png
~/.design-lens/bin/design-lens screenshot --url https://example.com --width 390 --height 844 --dsf 1 --full-page --out reference-mobile-1.png
```

Use unused paths and preserve capture images. The screenshot command defaults to DSF 2 and a
viewport-only image, so set comparison flags explicitly. A fresh source image is a later
observation, not the original capture. Open the images to assess fidelity: creating a PNG or
passing `verify` does not validate appearance, links, keyboard behavior or a new application's
functional states. The agent skills perform those additional checks with available tools and
report any unverified behavior.

Cloned pages are private study material. The
[fair-use policy](https://github.com/mojomoth/design-lens/blob/main/plugin/README.md#fair-use--respect-for-designers)
applies: clones are never to be deployed or redistributed. New work uses the user's own content
and assets, with source-specific brand material excluded.

## License

MIT © mojomoth. Bundled and runtime third-party licenses are enumerated in
[NOTICE.md](./NOTICE.md).
