---
name: inspect-elements
description: "Inspect a design-lens clone's live layout, typography, responsive reflow and customizable elements using stable IDs. Use when the user asks what can be changed, wants computed measurements or container relationships, or needs inspection before editing a clone. Measures the local clone, not original JavaScript behavior."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

1. Resolve the intended clone from the conversation, a previous command's returned `projectDir`,
   and available project manifests. Use source URLs and capture times to distinguish candidates.
   Ask only when multiple projects remain plausible after those checks. If no clone exists,
   continue through clone-reference using the known reference. Substitute the actual project path
   for `.design-lens/<slug>/` in the examples below.

2. Read `manifest.json`, REPORT.md and any `evidence.json` / `fidelity.json`. Source observations
   belong to a particular capture ID and viewport in `evidence.json`; the same `dl-N` in another
   capture does not establish the same element. `inspect` measures the current editable clone,
   including overrides. Its `page.source` is `clone`, so do not present these measurements as
   original-source facts. A missing or stale fidelity report does not prove a match.

   In a composed multi-viewport clone, canonical numeric IDs are unique across every sampled
   shadow tree. `data-dl-source-capture` and `data-dl-source-id` retain the capture-qualified
   source identity; the manifest composition maps it to the canonical element. Use the inspected
   clone ID for edits and that provenance for source lookup.

   Use the capture dimensions for a focused question. For a complete inventory, measure all
   stamped elements instead of limiting the result to the original role heuristics:

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --all --details --pretty
   ```

   This covers text, cards, forms, tables, containers, hidden alternatives and open shadow roots.
   Use `--kind <role> --details` when only one existing role is relevant. For actual layout
   parents and targets identified in a small HTML window, batch direct IDs:

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --id <target-id> --id <parent-id> --pretty
   ```

   Direct lookup implies details and searches open shadow roots as well as the document. It
   preserves requested order and reports missing or ambiguous IDs. Do not combine `--id` with
   `--kind`, or `--all` with either selection option. Follow `parentDlId`, `childDlIds` and
   `rootPath` for relationships and shadow boundaries; consult `page.body` and `page.rootFontSize`
   for the document root. Ordinary CSS selectors cannot cross a shadow boundary: resolve the
   recorded host path when inspecting that descendant. Read `pseudo`, `visual` and image
   readiness for generated content, backgrounds, gradients, cropping and missing media.

3. For responsive appearance, repeat relevant measurements at 1440x900, 768x1024 and 390x844.
   Record each viewport and include any additional requested capture size. Match a source
   observation only to its recorded viewport. When a claim depends on source fidelity, run:

   ```
   ~/.design-lens/bin/design-lens fidelity .design-lens/<slug> --json
   ```

   Read per-viewport issues and inspect the referenced images; command completion alone is not
   a pass. A failed comparison qualifies the clone's measurements, while valid source observations
   remain usable. Incomplete captures, failed fonts, inaccessible content and frame-scoped coverage
   limits remain unverified. A legacy clone without source evidence can still be inspected; label
   original appearance unavailable. If the already requested task requires original measurements,
   use its known reference URL to capture a new project through clone-reference and retain the old
   project. Never manufacture source observations from clone measurements. The inert clone's CSS
   reflow does not establish original JavaScript menus, triggers or interaction states.

4. Present a compact grouped list in the user's language, never the raw JSON: role or container,
   short description, stable `dl-N` address, and the few measured values that matter to the task.
   Include the evidence source, viewport and material limits from `page.complete`, `page.warnings`
   and `page.fonts`, including hidden state, missing assets and failed families. A role's confidence
   is a heuristic label score; `semantic` and measured values do not prove design intent. Every
   edit anchors to its actual `data-dl-id` within the recorded document or shadow root.

   Composed samples are chosen by nearest captured width, with midpoint ties choosing the larger;
   equal widths use the same rule for height. These are generated selection ranges, not observed
   source breakpoints. Exact fidelity applies only to captured viewport pairs. Identify the
   selected sample when reporting another size. Diagnostic comparisons from intact but incomplete
   evidence stay unverified, even when their available images match.

   The shared `clone/assets/dl-overrides.css` is linked last in the document and each generated
   shadow tree. Append rules using the intended variant's canonical IDs and re-inspect after edits.
   Use generated root/body proxy IDs for root styles; newly appended `html`, `body` or `:root`
   selectors do not select them. Keep unsupported root override warnings and unverified status.
   This does not cross additional shadow boundaries created by the original page; those still
   need an observed host property/part or an override inside their own root.

5. Use `tokens.json` for captured color/font candidates; generate it if missing:

   ```
   ~/.design-lens/bin/design-lens tokens .design-lens/<slug>
   ```

   Color counts describe CSS occurrences, not painted-area shares. Check the token schema version,
   alpha information and declared unit assumptions. A null spacing basis means no basis was
   established; do not substitute a convenient grid. Palette/type/spacing candidates may include
   inactive rules. Prefer actual computed values for the component and viewport being discussed.

6. State that this is a LIVE inventory: inspect itself writes no inventory into the project and
   measurements go stale after edits. Fidelity comparisons produce their own dated images and
   current report without changing source evidence. Re-run the relevant measurement after edits.
   If inspection is a
   prerequisite for a change already requested, continue into customize-clone with that target;
   do not ask the user to pick it again. For inspection-only work, finish with the useful inventory
   and limits. Never open the cloned index.html's full contents into context; use targeted reads.
