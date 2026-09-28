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

## Capture the reference

Resolve the URL and single-page scope from the request and current context. Ask for a URL only
when none can be established. Carry forward an already-requested analysis or new build.
From the user's project root, run:

```
~/.design-lens/bin/design-lens clone <URL> --viewports 1440x900,768x1024,390x844
```

Use the user's requested viewport list when provided. Never combine explicit `--viewport` and
`--viewports`. Add `--project <name>` for a named study, `--out <directory>` for a requested
location, and repeated `--remove-selector <css>` for requested exclusions. Consent blocking is
on by default; report any limitations. A clone captures editable static appearance, including
responsive layout, rather than reproducing the source application's JavaScript behavior.

Explicit multi-viewport captures compose each available sample's full static DOM in a separate
declarative open shadow tree. CSS selects the nearest captured width, choosing the larger at a
midpoint; equal widths use the same rule for height. These generated ranges are not original
breakpoints. Verify exact matches at recorded viewport pairs only. Intermediate sizes can be
inspected, but do not claim their original appearance was captured. Missing samples stay unverified.

Read `projectDir` from stdout JSON and use that returned path for every later command. Repeated
captures may create suffixed directories. Substitute the actual path for `.design-lens/<slug>`
below. A failed capture command requires inspection of its error and partial output before any
retry; its exit code alone is not a visual fidelity result.

## Preserve and inspect the source evidence

Read `manifest.json`, `REPORT.md`, `evidence.json` and `fidelity.json`. Record capture IDs,
viewports, device scale factors, source URLs, capture times, completeness and warnings. Each
capture's observation IDs are scoped to that capture: `dl-N` in two captures does not prove
that the nodes represent the same element. In a composed clone, canonical numeric IDs are unique
across all variants. Use `data-dl-source-capture` and `data-dl-source-id`, plus manifest composition
correspondence, to find the original observation. Do not substitute a source ID for a clone ID.

Use the paths recorded in `evidence.json` to view each source viewport/full image and inspect
its saved markup and resources with targeted reads. View the current clone and difference
images recorded by `fidelity.json` at every captured size. Inspect every failed region, missing
image/font, geometry error, text difference and external request; a low overall pixel ratio can
hide a missing logo. Run a current comparison:

```
~/.design-lens/bin/design-lens fidelity .design-lens/<slug> --json
```

Exit 0 means the current clone passed all captured checks. Exit 1 covers both `fail` and
`unverified`; read the report to distinguish them. `verify` checks document structure only.

Before editing, save the current clone and comparison report under an unused directory such as
`.design-lens/<slug>/repair-history/round-0/`. Backups contain only the editable clone and reports;
keep them outside `clone/` and every evidence path. Record the initial `evidenceHash` and source
file hashes. Never edit `evidence.json`, its listed files, source snapshots/images, `manifest.json`
or `REPORT.md` to describe a later edit. `fidelity.json` may be regenerated: its `cloneHash`
identifies the current editable result and its `evidenceHash` must remain unchanged.

A legacy clone without usable source evidence cannot earn a visual pass. If fresh source capture
is needed for this request, capture into a new project; preserve the earlier clone and its edits.
Incomplete source evidence, source font failures, inaccessible frames or capture limits remain
unverified. Repairing the clone cannot manufacture the missing original observation.
Intact but incomplete source captures may have `diagnosticOnly` images and measurements. Use those
to diagnose visible defects while retaining `unverified`; they cannot support a complete pass.

## Repair visual differences

When source evidence is complete and differences are repairable, perform at most three edit
rounds. Diagnose each change from the source snapshot, source measurements and difference image.
Use targeted searches and small reads; never load the entire cloned HTML into context.

- Restore missing local assets and correct references, font faces, CSS rules and element geometry.
  Preserve editable HTML/CSS and local resources. Never hotlink a missing asset.
- For a composed clone, edit the sampled variant identified by source provenance and the intended
  viewport. Preserve its shadow boundary and all existing `data-dl-id` values. Append ID-scoped
  styling rules to `clone/assets/dl-overrides.css`, shared by the document and every generated
  shadow tree. Do not overwrite captured styles or source files. Repair missing structure only
  from that sample's available evidence, and recheck every recorded size.
  For source root/body styling, target the generated proxy IDs; newly appended `html`, `body`
  or `:root` rules do not select them. Unsupported root overrides remain a disclosed limitation
  and cannot earn a verified pass.
  New elements receive unused numeric IDs above the highest ID in the clone and all captures;
  record these as clone-only repair IDs, without assigning them a source identity.
- Never replace the page with a screenshot, hide differences with comparison masks, remove failing
  evidence, change image dimensions to fit the test, or relax comparison tolerances. A source
  canvas or individually inaccessible embed may retain its captured image only with its scope and
  analysis limit disclosed; never represent that limited result as a complete capture.

After each round, run both commands and examine every viewport and failed region:

```
~/.design-lens/bin/design-lens verify .design-lens/<slug>
~/.design-lens/bin/design-lens fidelity .design-lens/<slug> --json
```

Check source hashes against the recorded baseline. Reject a candidate that changes source
identity, breaks structure, introduces a missing required asset, or makes a previously passing
viewport fail or become unverified. Among eligible results, prefer fewer failed/unverified
captures, then fewer failed elements, then fewer unmatched image dimensions, then lower worst
image mismatch ratio across full/viewport/region images, then lower maximum geometry delta.
Use this ordered comparison consistently; a tie is not an improvement. Save each improved clone
and report as the new best result outside the evidence tree.

Stop as soon as all checks pass. Stop after a non-improving round or after three rounds total.
If the last candidate is worse or tied, restore the best clone backup and rerun both checks
across all captured sizes; the final report must describe the restored bytes. Do not retain a
stale report from before restoration. If source verification is unavailable, retain the best
supported result and clearly identify what could not be compared.

## Complete the requested task

Report the project link, verified viewports, repair rounds, final fidelity/format outcomes and
remaining source or clone limitations in the user's language. Only call the capture visually
matched when its current `fidelity` result is `pass` and the immutable source evidence is complete.
Briefly explain that the clone is for design study and derived work must replace source branding.

For clone-only work, finish with this result. For an already-requested analysis, continue into
reverse-design. For an already-requested new build, continue through reverse-design and
build-from-design with verification. Continue authorized inspection/customization requests in
their respective flow; do not ask for the same authorization again.
