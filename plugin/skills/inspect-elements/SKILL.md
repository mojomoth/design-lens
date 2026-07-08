---
name: inspect-elements
description: "List the customizable elements of a design-lens clone (logo, nav, hero, CTAs, colors, fonts) with their stable ids. Use when the user asks what can be changed or customized in a clone, or before making edits."
---

Before anything else, verify the CLI is available: run `~/.design-lens/bin/design-lens --version`.
If that file is missing, the plugin bootstrap has not run: ask the user to restart the session
(a SessionStart hook provisions the runtime), or locate the installed plugin directory with
`claude plugin list` (Claude Code) or `codex plugin list` (Codex) and run
`bash <plugin-dir>/scripts/bootstrap.sh`, then retry.

1. Find the clone the user means. Clones live under `.design-lens/<slug>/`; if there is more than
   one and the user did not say which, ask. If there is no clone yet, run the clone-reference flow
   first.

2. Run the inventory:

   ```
   ~/.design-lens/bin/design-lens inspect .design-lens/<slug> --pretty
   ```

   It serves the clone on a loopback port, probes the rendered page, and prints JSON to stdout.
   Restrict the output with `--kind <role>` when the user only cares about one role.

3. Present a compact grouped list — never dump the raw JSON. Group by role, one line per element:

   ```
   logo           "Acme"                     dl-3
   nav-link       "Product" / "Pricing" / …  dl-7, dl-8, dl-9
   hero-heading   "Ship design faster"       dl-14
   hero-image     hero-photo.jpg             dl-16
   cta            "Start free"               dl-21
   ```

   The `dl-N` value is the element's `data-dl-id`: the stable address every edit is anchored to.

4. Point the user at colors and fonts, which are not elements: they live in
   `.design-lens/<slug>/tokens.json`. If that file is missing, generate it first with:

   ```
   ~/.design-lens/bin/design-lens tokens .design-lens/<slug>
   ```

5. State plainly that this is a LIVE inventory, not a saved manifest — nothing was written to the
   clone directory, and the ids are read back from the page each time. Re-run `inspect` after any
   edit rather than trusting the list above.

6. Invite the user to pick the elements they want to change, and hand off to `customize-clone`.
