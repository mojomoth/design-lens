---
name: clone-reference
description: "Clone a reference website into a self-contained local folder for design study. Use when the user gives a URL to clone, capture, mirror, save, or use as a design reference. Single pages only; not for whole-site crawls or pages behind logins."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry. If design-lens was installed without a
plugin system (for example via `npx skills add` on Cursor or OpenCode), provision the runtime
with `npx -y design-lens setup` instead, then retry.

1. Resolve the target URL and scope from the user's message and current context. Ask for a URL
   only when none can be established. Capture one page per clone. Respect a request to clone only;
   when the user already asked to build a new product from the reference, carry that intent forward.

2. From the user's project root, run:

   ```
   ~/.design-lens/bin/design-lens clone <URL>
   ```

   Add `--project <name>` when the user named the study, `--out <directory>` for a requested
   output location, and repeated `--remove-selector <css>` flags for requested exclusions.
   Consent and cookie banners are blocked by default, with any limitations reported by the CLI.

   Progress goes to stderr; stdout contains one JSON result. Use its returned `projectDir` as
   the project path for every later step, rather than guessing a slug: repeated captures can
   create suffixed directories. The examples `.design-lens/<slug>/` below stand for that actual
   path. A non-zero exit is a failed operation; report the concrete error and inspect any partial
   output before retrying, without claiming a completed capture.

3. Read the returned project's `manifest.json` and `REPORT.md`. Record its source URL, capture
   time and viewport. Look at `screenshots/original-viewport.png`, `original-full.png`, and
   `clone-full.png`; image inspection is part of the capture check, not an optional follow-up.
   The original images show the source at capture time; clone-full is the written clone rendered
   from disk. Compare the full-page pair under its recorded capture conditions.

   Summarize localized styles, images and fonts; resources left remote and their reasons; and
   visible or reported capture limits, including font fallback. If an image is missing or cannot
   be viewed, name the unavailable evidence. A passing format check and an existing PNG do not
   establish visual fidelity. Preserve the capture images and provenance documents.

4. Explain briefly that the clone is for design study and source brand assets must be replaced
   in derived work. Write the summary in the user's language and link the actual project path.

5. Continue the task the user requested. For clone-only work, finish with the capture result and
   its limits. For an already-requested analysis, continue into reverse-design. For an
   already-requested new build, continue through reverse-design and build-from-design, including
   verification; do not stop at offering those next steps or ask for the same authorization again.
   An inspection or clone customization request continues into its corresponding flow.

Never open the cloned index.html's full contents into context — it is large; use grep and targeted reads.
