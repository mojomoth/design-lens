# 10-ethics — copyright & ethics guardrails

## Purpose
Design Lens clones other people's work in order to study it. The guardrails are baked into three
layers — CLI (mechanical, on every clone), skills (behavioral, at the moment of editing/shipping),
docs (framing) — so that *studying* a design stays clearly separated from *shipping* one. The
governing stance is transparency over blocking: the tool records provenance and warns loudly, it
does not refuse.

## Requirements

### Layer 1 — CLI (mechanical; runs on EVERY clone, no flag can disable it)
- Every successful `clone` MUST write a `## License & usage notice` section into
  `.design-lens/<slug>/REPORT.md` containing the notice text below VERBATIM (the sealed gate
  greps REPORT.md for the heading string — ACCEPTANCE.md AC-07).
- `clone/index.html` MUST begin with the provenance comment, before `<html>`. Its exact template is
  owned by `specs/03-clone-format.md` §Provenance comment (see below). The version in the comment
  MUST equal `manifest.json` `tool.version` and the CLI `--version` output.
- `manifest.json` MUST carry the full source-URL mapping: every localized asset appears in
  `resources[]` with its `originalUrl`, and every non-localized reference appears in `remote[]`
  with `url`, `reason`, and `referencedBy` (schema in specs/03-clone-format.md). Nothing in the
  clone may have untraceable origin.
- Font provenance MUST be visible for commercial-font licensing checks: the REPORT.md
  `## Capture results` section MUST list every localized font file with its origin host. The
  deterministic `assets/<host>/<path>` layout already encodes the host in the local path; the
  report MUST surface it as a list, not leave the user to spelunk directories.
- `clone` MUST fetch `<origin>/robots.txt` out-of-band during capture. If the target path is
  disallowed for the capture user agent, the CLI MUST set `source.robotsDisallowed: true` in
  `manifest.json` AND write a robots note in REPORT.md `## Source` — and MUST proceed with the
  clone (single-page private study; transparency over blocking). A robots fetch failure MUST NOT
  abort or warn fatally; record `robotsDisallowed: false`.
- On clone completion the CLI MUST print the one-line notice defined below to stderr (stderr is
  the human channel; stdout stays machine-only).

### Layer 2 — Skills (behavioral)
- `clone-reference/SKILL.md` MUST state that the clone's purpose is private design study and
  derivation, and MUST include a step reminding the user in one sentence that brand assets must
  be replaced before shipping anything derived.
- `customize-clone/SKILL.md` AND `build-from-design/SKILL.md` MUST each embed the exact heading
  `## Before you ship — brand checklist` (byte-exact; sealed gate AC-14 greps both files)
  followed by the checklist items below. The checklist MUST instruct running a recursive
  case-insensitive grep for the reference's brand name over the shipped output as the final
  check. The grep MUST be written as plain fenced/backticked text — NEVER prefixed with `!`
  (Claude's `` !`cmd` `` inline-bash form is a Codex importer skip-marker, ADR-004/AC-12).
- `customize-clone` MUST trigger the checklist on ship intent ("ship it", "deploy", "publish",
  "go live") and report which items still contain original brand material
  (specs/06-customization.md "Ship intent").
- `build-from-design` is the promoted clean path: its skill body MUST present building NEW work
  from extracted principles as the intended way to ship, MUST require zero assets, text, or
  logos copied from the clone, and MUST honor DESIGN.md §11 "What NOT to Copy".

### Layer 3 — Docs
- `plugin/README.md` MUST contain a section headed `## Fair use & respect for designers` making
  exactly this argument: reference-driven design is how designers have always worked; Design
  Lens keeps you honest by separating studying a design (clone-reference + reverse-design) from
  shipping one (build-from-design + the brand checklist); clones are never to be deployed or
  redistributed.

## Interfaces & contracts

- REPORT.md notice section — VERBATIM (heading + body):

  ```markdown
  ## License & usage notice
  This clone is for private design study and derivation. All content, images, logos, fonts and text
  remain the property of their owners. Do not deploy or redistribute this clone. Before shipping any
  work derived from it: replace the logo and all brand assets, rewrite all copy, replace or license
  all photography, and check font licenses (font files and their source hosts are listed above).
  ```

- `clone/index.html` provenance comment (first line of the file; substitute the ISO capture date).
  Template owned by `specs/03-clone-format.md`; the raw source URL is deliberately absent, because
  sealed assertion A4 forbids the capture host anywhere inside `clone/` (ADR-011):
  `<!-- Cloned by design-lens v0.1.0 at <capturedAt ISO-8601> for private design study and derivation only. Source URL and capture metadata: see ../manifest.json and ../REPORT.md. -->`
- Completion one-liner (stderr, last line of clone output):
  `Note: this clone is for private design study only — see REPORT.md "License & usage notice" before shipping anything derived.`
- Brand checklist block for BOTH `customize-clone/SKILL.md` and `build-from-design/SKILL.md`
  (heading byte-exact; item wording MAY vary slightly but every item MUST be present):

  ```markdown
  ## Before you ship — brand checklist
  - Logo replaced — no original logo files or references remain
  - All copy rewritten — no sentences from the reference remain
  - Photography replaced or licensed
  - Fonts licensed for your use (origin hosts are listed in REPORT.md)
  - No trademarks, mascots, or brand names remain
  - Final check: run `grep -ri "<brand-name>"` over the output — it must return nothing
  ```

- Manifest fields owned by this spec: `source.robotsDisallowed` (boolean, always present),
  `resources[].originalUrl`, `remote[].{url,reason,referencedBy}` (specs/03-clone-format.md).

## Out of scope
- Legal advice, jurisdiction analysis, or TOS parsing — these are guardrails, not counsel.
- Blocking, refusing, or degrading clones on robots disallow or any heuristic (transparency over
  blocking is the decided stance; changing it requires an ADR).
- Authentication, paywalls, DRM circumvention (already excluded by specs/00-product.md).
- Dependency licensing and `plugin/NOTICE.md` contents — governed by ADR-005 and CONVENTIONS.md.
- Telemetry, watermarking, or any phone-home mechanism (forbidden by CONVENTIONS.md).

## Verified facts
- The sealed gate requires REPORT.md to contain "License & usage notice" on every e2e clone
  (ACCEPTANCE.md AC-07; gate script sealed in `.harness/`).
- The sealed gate greps `customize-clone/SKILL.md` and `build-from-design/SKILL.md` for the exact
  heading `## Before you ship — brand checklist` (ACCEPTANCE.md AC-14).
- Codex's skill importer skips bodies containing `$ARGUMENTS`, `$1-$9`, `{{}}`, or `` !`cmd` ``
  interpolation and never substitutes `${CLAUDE_PLUGIN_ROOT}` in bodies — the checklist and all
  ethics text must be plain prose (research/codex-plugin.md; ADR-004; ACCEPTANCE.md AC-12).
- Prior art honors robots.txt by default for whole-site crawls (kage, `--no-robots` to skip);
  Design Lens is single-page study, so the reconciled decision is record-and-proceed, never
  block (research/kage-clone.md; design/plugin-design.md §5.2 stage-3 note, §8).
- `single-file-cli` is AGPL and is never vendored or imported; the MIT plugin's own licensing
  hygiene lives in ADR-005 — not re-litigated here (research/clone-tech.md; ADR-005).
- The three-layer structure (CLI / skills / docs) and the promoted-clean-path role of
  build-from-design come from the source design (design/plugin-design.md §8, §5.6, §7.5).
- CLI I/O convention: human output → stderr, machine JSON → stdout — the completion notice
  therefore goes to stderr (README.md canonical contract; specs/00-product.md).
