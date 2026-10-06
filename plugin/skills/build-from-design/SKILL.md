---
name: build-from-design
description: "Build and verify a NEW page or interface from a reference's design principles, adapted to the user's product, content, and stack. Use when the user wants a site like a reference for their own product, or wants to apply DESIGN.md or VARIATIONS.md to a project. Continue through missing analysis, a recommended direction, implementation, and responsive verification; analysis-only requests belong to reverse-design."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

1. **Read the project and conversation before asking.** Find the target product, audience,
   primary task, supplied content/assets, required interactions, reference, and any chosen
   direction. Inspect the framework config, package scripts, routes, components, and design tokens.
   Follow existing project conventions. A request for a new page authorizes the necessary
   analysis, recommendation, implementation, and checks; do not pause at each transition. Ask only
   for missing essentials or an unresolved choice that materially changes the required outcome.
   Explain progress and results in the user's language.

   Choose the build mode now. `derive` is the default: new markup is written from the analysis and
   the clone is never copied into the target (no copytree, no working copy). Use `clone-base` only
   when the user or the brief explicitly asks to build on or from the captured clone. One study
   project records one build: its VARIATIONS.md holds one Build contract and one Reference fidelity
   table. For a second build (another mode or target), capture or copy the study into a new project
   so each contract and fidelity table describes exactly one build.

   One agent owns DESIGN.md and VARIATIONS.md. Helpers (subagents, parallel sessions) return
   findings as text and never write those files. Before each rewrite, run validate-design and
   compare `documents.design.sha256` and `documents.variations.sha256` with the values from your
   last read; if either changed, re-read and merge first. Helpers prefix every CLI call with
   `DESIGN_LENS_AGENT=<role>` (for example `DESIGN_LENS_AGENT=qa-helper`). Mark each phase once
   `.design-lens` exists (clone-reference creates it; in a fresh project run step 2 first, or create
   the empty directory), otherwise `runlog` exits 1:

   ```
   ~/.design-lens/bin/design-lens runlog .design-lens --mark build --event start
   ~/.design-lens/bin/design-lens runlog .design-lens --mark build --event end
   ```

   When resuming interrupted work, close the stale window with `--event abort` and start a new one.

2. **Establish the design evidence.** Require `.design-lens/<slug>/DESIGN.md` and
   `.design-lens/<slug>/VARIATIONS.md`. If the clone is missing, use clone-reference, then
   reverse-design; if the analysis is missing or lacks the Typeface forms, Tone budget or
   Signature priority tables, run reverse-design and return here. Preserve the user's decisions
   and valid analysis. Source observations in `evidence.json` are the reference; current clone
   measurements are observed-clone evidence. Fill measurement gaps with targeted lite inspection:

   ```
   ~/.design-lens/bin/design-lens validate-design .design-lens/<slug> --json
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --lite --viewports 1440x900,768x1024,390x844 --id <dl-id> --selector "<css>"
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --viewport 390x844 --id <parent-id> --id <target-id> --pretty
   ```

   Use `--all --details` only for a specific recipe gap at one viewport. Select a direction only
   when `documents.design.status` is not `fail`; otherwise repair DESIGN.md through reverse-design.
   Never modify source evidence or rewrite observations to justify a build. Keep observed-reference,
   observed-clone, inferred, proposed, and unavailable claims distinct; token counts are CSS
   declarations, not painted area (pixel tone comes from `tone.json`).

3. **Choose the direction and record the build contract before coding.** An explicit user choice
   always wins. Otherwise, when the brief prioritizes the reference's design language, choose the
   highest `variationScores` entry from validate-design, breaking ties by target fit; else choose
   the best target fit. A lower-scoring choice when the brief prioritizes the reference, and any
   choice more than 0.10 below the highest, needs a `**Selection basis:**` bullet (`User: "…"` or
   `Brief: "…"`). Every quoted clause (Selection basis, Drop basis, contract Source) must appear
   verbatim in `## Target brief`; copy the user's words into its Quoted requirements bullet first.
   Never drop a rank 1–3 signature without a `Brief:` or `Content:` quote in the retention
   matrix's Drop basis. In `## Selected direction` of VARIATIONS.md record:
   - `**Direction:** Variation <letter>: <name>` and why it fits;
   - `**Design basis:** sha256:<documents.design.basisSha256>` from the latest validate-design run;
   - the `### Build contract` table exactly as in reverse-design's VARIATIONS template: `mode`;
     `fonts` (every family the build loads, each an OFL substitute in Typeface forms);
     `display-fonts` (substitutes of the same form class as the display/heading rows);
     `dark-share-max` and `full-bleed-dark-max` from the largest `tone.json` darkShare and
     fullBleedDarkShare (at most +0.10 and +0.03 unless Source quotes the brief, content or user);
     `stylesheets` for clone-base; and a `check:<rank>` row for every kept, adapted or substituted
     rank 1–3 whose Kind is not tone or motion (add rows for lower ranks when checkable).

   Update `Target brief`, `Structural changes` and `Verification criteria` (checks stay planned
   until run). Draft missing copy only from known product facts; never invent customers, prices,
   durations, counts, testimonials, or results. Rerun validate-design and resolve every
   VARIATIONS.md `fail` before writing code.

4. **Adapt structure to the user's task.** Apply each selected principle's evidence, reuse
   conditions, implementation, and check. Translate measured container/grid, typography, spacing,
   color roles, image treatment and component anatomy into the target stack, carrying observed
   responsive values per tested width and labeling new states as proposals. Change hierarchy,
   density, navigation, and composition where the target needs it, recording the reason in
   VARIATIONS.md, while every kept signature stays visibly present.

5. **Build to the contract in the USER'S stack.** Reuse the project's components, design system,
   content, and interaction patterns; with no project, use plain HTML and CSS plus the JavaScript
   the behavior requires. Load exactly the contract `fonts` as web fonts (qa resolves each element
   to the first loaded family of its stack, so a font that never loads counts as its fallback),
   set h1/h2 in `display-fonts`, stay within the dark maxima (no full-bleed dark bands the
   reference lacks), and make every `check:<rank>` hold. Text in the target's language comes first
   in a family that covers its script (qa fails a display heading whose glyphs fall back to a
   platform font). Take each OFL font from its official distribution; when offline, record the
   file's source and licence in Verification criteria. A font deviation first adds the family as
   an OFL substitute of the matching role in DESIGN.md Typeface forms (a proposal column, not an
   observation), then reruns validate-design, re-confirms the direction and copies the new
   `documents.design.basisSha256` into the Design basis. Other deviations change the Build contract
   with a Source and rerun validate-design. Never edit measured observations to match the build.

   - **derive:** write new markup from the recipes. Copy ZERO assets, text, or logo files from the
     clone: no images, icons, fonts, sentences, markup or stylesheets.
   - **clone-base:** copy the editable `.design-lens/<slug>/clone/` folder into the target once;
     the study clone stays untouched. Keep its section skeleton, grid, captured layout stylesheets
     and `data-dl-id`s. Delete every copied captured image, font, icon and media file (keep
     stylesheets, `assets/dl-overrides.css` and `assets/custom/`; captured stylesheet files the
     copy's HTML never loads are unused copies, delete them). Replace ALL text, images, logos,
     icons, fonts and media using customize-clone's mechanics on the copy: text-node edits,
     ID-scoped rules appended to the copy's `assets/dl-overrides.css`, replacements under
     `assets/custom/`, repeated in every sampled variant. On the copy you may also change `href`,
     `alt`, `title` and `aria-label` values and add the attributes or script a retained control
     needs; never remove or renumber `data-dl-id` values. New elements carry no `data-dl-id`
     (lineage measures only retained ids). Replace the copied "Cloned by design-lens" header comment
     with a note naming the source project path. The copy is inert: give every retained control
     real behavior or remove it. In a multi-viewport copy each variant lives in a shadow root, so
     `#id` links cannot scroll there: give them a small script that scrolls the active variant's
     target (qa clicks them and accepts a link whose click brings the target into view), or link to
     real pages. Record `stylesheets` as `retained` or `rewritten`; qa counts the copy's inlined
     captured style blocks (`style[data-dl-captured-styles]`) and fails `rewritten` while any
     remain. `verify` and `fidelity` check the study clone, not the copy: qa `--mode clone-base` is
     the copy's check.

   Never write your own lineage file; lineage comes only from qa's measured `build-lineage.json`.
   Use semantic elements, keyboard access and visible focus. Every control performs its promised
   task (tabs and filters change state). Every link needs a real destination from the content, the
   live target site or the project's routes; when none exists, render plain text, never `#`, a
   self-anchor or an unrelated section. Use the user's own material and original or licensed
   alternatives; honor DESIGN.md `## 11. What NOT to Copy`. Keep the study clone, `manifest.json`,
   `REPORT.md`, `evidence.json` and every capture image intact.

6. **Verify with build QA and view every review image.** Pass every file that supplies copy or
   facts with repeated `--content`; if facts exist only in the conversation, save the user's words
   verbatim to a file in the target project and pass it, never adding a number nobody supplied.
   Pass the reference's brand names with repeated `--brand`. Use `--dir` for a static build (qa
   serves it) or `--url` for a running dev server:

   ```
   ~/.design-lens/bin/design-lens qa --dir <build-dir> --project .design-lens/<slug> --content <content-file> --brand "<reference brand>"
   ~/.design-lens/bin/design-lens qa --url <local-page-URL> --project .design-lens/<slug> --content <content-file> --brand "<reference brand>"
   ~/.design-lens/bin/design-lens qa-confirm <qa-out-dir> --codes <code-1>,<code-2>,<code-3>
   ```

   Each run writes a new `.design-lens/<slug>/qa/<runId>` and prints `status`, `out`, `counts`
   and `review` image paths; pass that `out` to `qa-confirm`. Always pass `--project` and never
   `--out`: validate-design only accepts runs under the project's `qa/` made with `--project`.
   Fix every `fail` finding, then rerun; resolve or justify each `warn`. `unverified` lists skipped
   checks: supply what is missing instead of ignoring it. Open and examine every review image of
   every run: hierarchy, wrapping, density, clipping, overflow, fonts and each signature. Compare
   sheets show REFERENCE left and BUILD right at one scale. Each image carries six yellow badges,
   one character per horizontal sixth; read them left to right. Badges hide parts of the page: examine the
   badge-free `screenshots/<WxH>-full.png` of the run for any region a badge covers. Middle
   viewports get only their first screen as a review image; scroll-check the rest of those pages
   with `screenshot --url`. After the final run, pass its codes to `qa-confirm` in the order of its
   `review` list; on a mismatch reopen the listed images.

   qa does not exercise menus, forms, carousels, keyboard order, or long, empty and error content.
   Check those with available browser tools and the project's own checks, restoring stress data
   afterward. Use `screenshot --url` for extra states with new filenames. After a shared layout,
   type or component change, rerun qa so all viewports are rechecked. If browser interaction tools
   are unavailable, mark those checks unverified; never imply a blocked check passed.

7. **Record the result; claim completion only after validation.** Fill `## Reference fidelity`
   from the confirmed run's compare sheets and `signatureChecks`: one row per DESIGN rank with the
   selected Decision, Verdict `present`, `partial`, `missing` or `dropped` (drop decisions only),
   and Evidence citing that single `qa/<runId>`, which must be the newest run under `qa/` (any
   later qa run, including a helper's, must be confirmed and cited instead). A kept, adapted or
   substituted signature cannot be `missing`: implement it, rerun qa, view and confirm the new
   run, and cite it. If the direction changed, update every row's Decision first. A Build contract
   or mode edited after the run invalidates it: rerun qa, confirm and cite the new run. Record actual
   results with `qa/<runId>` paths in `Verification criteria`. Run validate-design: finish only
   when no check is `fail`, and report each remaining `unverified` check with its reason. Never
   claim completion or create completion markers before that. Report applied principles, structural
   changes, implementation paths, the qa run and reference fidelity score, unverified behavior, and:

   ```
   ~/.design-lens/bin/design-lens runlog .design-lens --summary
   ```

   Keep the work local; deploy or publish only when the user explicitly requests it. In the
   checklist below, brand names refer to the source reference; the user's own identity belongs
   in the new work.

## Before you ship — brand checklist
Run through every line before the user deploys anything derived from a reference:
- Logo and all brand assets replaced
- All copy rewritten in the user's own voice
- Photography replaced or licensed (font/image source hosts are listed in REPORT.md)
- Fonts licensed for the user's use
- No trademarks, mascots, or brand names remain — finish with `grep -ri "<brand-name>"` over the output
- Clone-base builds: before deploying, rewrite the retained captured markup and stylesheets or confirm the right to reuse them (they are the reference's code); local comparison builds may keep them
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
