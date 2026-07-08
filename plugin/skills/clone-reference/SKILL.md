---
name: clone-reference
description: "Clone a reference website into a self-contained local folder for design study. Use when the user gives a URL to clone, capture, mirror, save, or use as a design reference. Single pages only; not for whole-site crawls or pages behind logins."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry.

1. The target URL is in the user's request. If none was given, ask for one before running anything.
   One page per clone — if the user names a whole site, clone the single page they care about most
   and say so.

2. From the project root, run:

   ```
   ~/.design-lens/bin/design-lens clone <URL>
   ```

   Add `--project <name>` if the user named the project (otherwise the directory is derived from
   the URL host). Add `--remove-selector <css>` for elements the user wants excluded from the
   capture; the flag repeats. Consent and cookie banners are already blocked by default.

   The command prints progress to stderr and one JSON result line to stdout, then writes
   `.design-lens/<slug>/` containing `clone/`, `manifest.json`, `REPORT.md`, and `screenshots/`.
   A non-zero exit means the page was never captured — report the error rather than guessing.

3. Read `.design-lens/<slug>/REPORT.md`. Summarize for the user, in a few lines:
   - what was localized (pages, styles, images, fonts),
   - what stayed remote and why (the `## Left remote` section gives a reason per URL),
   - any fidelity warnings (the `## Fidelity notes` section).

   If the user asks how faithful the capture is, show them `screenshots/clone-full.png` next to
   `screenshots/original-full.png` — the first is the written clone re-rendered from disk, the
   second is the live page.

4. Remind the user, in one sentence: the clone is for design study; brand assets must be replaced
   before shipping anything derived from it.

5. Offer the natural next steps:
   - `reverse-design` — analyze the design and write DESIGN.md,
   - `inspect-elements` — list what can be customized,
   - `customize-clone` — start editing.

Never open the cloned index.html's full contents into context — it is large; use grep and targeted reads.
