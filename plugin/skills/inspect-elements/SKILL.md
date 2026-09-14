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

2. Read `manifest.json` for the capture width and height, and REPORT.md for capture limits. Run
   fresh measurements at those dimensions instead of assuming inspect's 1440x900 default:

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --details --pretty
   ```

   Use `--kind <role>` when only one role is relevant. For an actual layout parent or a target
   found in a small HTML window, use a direct ID instead of inventing a semantic role:

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport <width>x<height> --id <dl-id> --pretty
   ```

   Direct ID lookup implies details, includes hidden elements, and cannot be combined with
   `--kind`. Follow `parentDlId` and `childDlIds` for direct relationships; consult `page.body`
   and `page.rootFontSize` when the parent is unstamped. Lookup is light DOM only. A missing
   shadow descendant is unavailable evidence, not proof that no component exists.

3. When the request concerns responsive appearance, layout, or an element that changes across
   screen sizes, repeat relevant inspection with `--viewport 390x844`. Record the viewport for
   each result. Distinguish the clone's retained CSS response from unobserved source behavior;
   the inert clone does not recover JavaScript menus or other original interactions.

4. Present a compact grouped list in the user's language, never the raw JSON: role or container,
   short description, stable `dl-N` address, and the few measured values that matter to the task.
   Include viewport and material limits such as hidden state, missing assets, or `page.fonts`
   timeout/failed families. A role's confidence is a heuristic label score, not certainty about
   design intent. Every edit anchors to its actual `data-dl-id`.

5. Use `tokens.json` for captured color/font candidates; generate it if missing:

   ```
   ~/.design-lens/bin/design-lens tokens .design-lens/<slug>
   ```

   Color counts describe CSS occurrences, not painted-area shares. Static relative-unit values
   assume 16px and palette/type/spacing guesses may include inactive rules. Prefer the live
   computed measurements for the component and viewport being discussed; note differences.

6. State that this is a LIVE inventory, not a saved manifest: inspect writes no inventory into
   the project and measurements go stale after edits. Re-run it when needed. If inspection is a
   prerequisite for a change already requested, continue into customize-clone with that target;
   do not ask the user to pick it again. For inspection-only work, finish with the useful inventory
   and limits. Never open the cloned index.html's full contents into context; use targeted reads.
