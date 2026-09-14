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

2. **Establish the design evidence.** Require `.design-lens/<slug>/DESIGN.md` and
   `.design-lens/<slug>/VARIATIONS.md`. If the clone is missing, use clone-reference, then
   reverse-design; if the analysis is missing, run reverse-design and return here. If older
   documents lack evidence, responsive recipes, or handoff fields needed for this build, refresh
   those parts using reverse-design's measurements and templates. Preserve the user's decisions
   and valid analysis. Keep observed-reference, observed-clone, inferred, proposed, and unavailable
   claims distinct. Do not turn stylesheet frequencies or token guesses into measured design facts.

3. **Choose and record the adaptation before coding.** Use a direction the user already chose;
   otherwise select the best fit from VARIATIONS.md and briefly explain the recommendation.
   Update its `Target brief`, `Selected direction`, `Structural changes`, and `Verification
   criteria` with current product context, the selected DESIGN.md section 12 principles, and
   observable acceptance checks. Mark checks planned until actually run. No separate variation or
   copy approval is required when the brief is sufficient. Draft missing descriptive copy from
   known product facts and record consequential assumptions; do not invent customers, prices,
   testimonials, or results. Ask when an essential fact cannot be supplied honestly from context.

4. **Adapt structure to the user's task.** Use each selected principle's evidence, possible
   reason, reuse conditions, implementation, and check. A marketing page can foreground an offer;
   a management interface should foreground its data and controls. Change hierarchy, density,
   navigation, and component composition where the target needs it, recording the reason in
   VARIATIONS.md. Its clone-compatible token table is only one part of a new build; new work may
   also apply the documented structural adaptations. Proposed design-role labels are not literal
   token JSON paths. Derive an implementation from the analysis, not a copy of the clone markup.

5. **Build in the USER'S stack.** Reuse the project's components, design system, content, and
   interaction patterns. If there is no project, default to plain HTML and CSS, adding the small
   amount of JavaScript required for the requested behavior. Use semantic elements, meaningful
   navigation/CTA destinations, keyboard access and visible focus. Implement relevant responsive,
   validation, empty, loading, error, and reduced-motion behavior; distinguish reference-observed
   states from new proposals. A control must perform its promised task. When a service is absent,
   identify local demo behavior or the unresolved integration honestly rather than claiming a real
   submission occurred.

   Copy ZERO assets, text, or logo files from the clone: no images, icons, fonts, or sentences.
   Use the user's own material and original or appropriately licensed alternatives available to
   the project. Honor DESIGN.md's `## 11. What NOT to Copy`, including structures that do not fit
   this product. Keep the source clone, `manifest.json`, `REPORT.md`, and capture images intact.

6. **Verify by viewing the rendered page.** Serve the actual target route using the project's
   normal development workflow. Capture desktop, tablet, and mobile at explicit DSF 1:

   ```
   ~/.design-lens/bin/design-lens screenshot --url <local-page-URL> --width 1440 --height 900 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/build-desktop-full-1.png
   ~/.design-lens/bin/design-lens screenshot --url <local-page-URL> --width 768 --height 1024 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/build-tablet-full-1.png
   ~/.design-lens/bin/design-lens screenshot --url <local-page-URL> --width 390 --height 844 --dsf 1 --full-page --out .design-lens/<slug>/screenshots/build-mobile-full-1.png
   ```

   Open and examine all three images. Check the chosen hierarchy, type/spacing relationships,
   content density, readable long text, and usable controls. Check for clipping and document-level
   overflow; intentional scrolling belongs inside a usable component. For first-screen or focus
   detail, take another shot without `--full-page` and give it a descriptive viewport/state name.
   Increment each filename's suffix for subsequent runs; never overwrite source capture images.
   Compare against the selected principles and adaptations, including intentional differences
   from the reference. A screenshot being created is not a visual review.

7. **Exercise behavior and repair failures.** Run the existing project's relevant checks. Use
   available browser tools to exercise actual navigation and CTA outcomes, keyboard focus, and
   relevant long/empty/error content states. Use temporary stress data and restore the intended
   content afterward. Fix failed visual or functional checks and repeat the affected checks and
   screenshots until they pass. If browser interaction tools are unavailable, still perform the
   image review and existing checks, and mark interaction checks unverified. Likewise report a
   blocked service or missing verification capability specifically; do not imply it passed.

8. **Record and show the result.** Add actual results and evidence paths to VARIATIONS.md's
   `Verification criteria`, alongside any remaining limits. Report the applied principles,
   deliberate structural changes, implementation paths, checks performed, and unverified behavior
   concisely. Keep the application and analysis reviewable locally. Deploy or publish only when
   the user explicitly requests it. In the checklist below, brand names refer to the source
   reference; the user's own identity belongs in the new work.

## Before you ship — brand checklist
Run through every line before the user deploys anything derived from a reference:
- Logo and all brand assets replaced
- All copy rewritten in the user's own voice
- Photography replaced or licensed (font/image source hosts are listed in REPORT.md)
- Fonts licensed for the user's use
- No trademarks, mascots, or brand names remain — finish with `grep -ri "<brand-name>"` over the output
- The shipped work is a derivation, not a copy
Report anything that still contains original brand material.
