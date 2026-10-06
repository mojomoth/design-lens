# Design Variations: {site}

## How to use this file

These directions transfer supported principles from DESIGN.md to a different brand or product.
Each direction cites verified measurement rows and rules from DESIGN.md. Clone customization applies only the clone-compatible token changes. New work may also change
structure to serve its target task. Proposed design-role names are labels for the new design,
not literal paths in tokens.json; cite real token keys or computed fields separately.

Write explanations in the user's language. Use known conversation/project context before asking
for essentials. A sufficient brief does not require another approval pause. Write this file only
after DESIGN.md exists and validate-design reports `documents.design.status` other than `fail`.
If this is analysis only and no target was supplied, state that and make the recommendation conditional.

## Target brief

- **Product and audience:** {known context, or not supplied}
- **Primary user task and success:** {what the intended user needs to accomplish}
- **Content, data, and required interactions:** {supplied content and functional needs, or not supplied; do not invent them}
- **Existing stack/components and constraints:** {known project context, or not yet inspected}
- **Quoted requirements:** {each user, brief or content sentence that a later Drop basis, Selection basis or contract Source quotes, copied verbatim inside double quotes; or none}

## Signature retention

| Rank | Variation A | Variation B | Variation C | Drop basis |
|---|---|---|---|---|
| 1 | {keep: how the device appears in A} | {adapt: the changed form in B} | {substitute: the replacement of the same form in C} | {none, or Brief: "verbatim clause" when a rank 1–3 is dropped} |

## Selected direction

- **Direction:** Variation {letter}: {name}
- **Design basis:** sha256:{documents.design.basisSha256 from validate-design}
- **Why it fits:** {target need, retention score and supported principles behind the choice}
- **Principles carried forward:** {references to DESIGN.md section 12}
- **Choice status:** {user-selected, or recommended without a mandatory pause}

### Build contract

| Contract | Value | Source |
|---|---|---|
| mode | {derive or clone-base} | {default, or User: "verbatim request to build on the clone"} |
| fonts | {Family; Family; Family} | {Typeface forms OFL substitutes} |
| display-fonts | {Family} | {Typeface forms display/heading row} |
| dark-share-max | {number from 0 to 1} | {tone.json largest darkShare plus at most 0.10} |
| full-bleed-dark-max | {number from 0 to 1} | {tone.json largest fullBleedDarkShare plus at most 0.03} |
| check:{rank} | {selector} :: {property} {op} {value} | {Signature priority rank and device} |

## Structural changes

Summarize the selected direction's adaptations for new work. For clone customization, state that
only the token-change table applies. If no structural change is needed, say why.

| Reference decision and evidence | Target decision | Reason for adapting | Build check |
|---|---|---|---|
| {source component, hierarchy, or layout} | {proposed target structure} | {target task and principle} | {observable acceptance} |

## Verification criteria

Record what the build will check, then let build-from-design add actual evidence/results. Planned
checks are not completed checks. Use the project's existing checks and available browser tools;
report any unavailable verification honestly.

| Check | Expected behavior | Evidence or result |
|---|---|---|
| Desktop, 1440x900 | {selected hierarchy, spacing, and primary task} | Planned; not run during analysis |
| Tablet, 768x1024 | {appropriate layout and usable controls} | Planned; not run during analysis |
| Mobile, 390x844 | {appropriate reflow, long content, and no document overflow} | Planned; not run during analysis |
| Interaction and content stress | {relevant CTA/navigation, keyboard focus, and long/empty content behavior} | Planned; not run during analysis |

## Reference fidelity

| Rank | Device | Decision | Verdict | Evidence |
|---|---|---|---|---|
| {rank} | {device from Signature priority} | {selected variation's decision} | planned | {not run during analysis} |

## Variation A: {name}

**Concept:** {one sentence describing the change and whom it serves}

**Keep:** {supported principles and component decisions retained, with DESIGN.md references}

**Clone-compatible token changes**

| Proposed design role | Reference value and evidence | Proposed value | Apply to |
|---|---|---|---|
| {semantic role, not a tokens.json path} | {observed old value with real key, ID, and viewport} | {concrete color, type, spacing, radius, or duration} | {existing CSS property or addressed elements} |

**New-build structural adaptations**

| Reference pattern and evidence | Proposed structure | Target need and retained principle |
|---|---|---|
| {layout, hierarchy, component, or content pattern} | {concrete new arrangement or behavior} | {why it serves this product} |

These structural changes apply to new work, not a token-only edit of the clone. If none are
needed, replace the table with a short explanation.

**Best for:** {product, audience, and task situations that fit this direction}

**Tradeoff:** {what this direction sacrifices or needs to verify, including dropped signatures}

**Verification:** {specific visual or functional checks for this direction}

---

## Filling this template

Remove this guidance section from the finished document.

- Default to three named variations; three to five are allowed when they add a meaningful choice.
  Include a conservative direction, a bold direction, and a direction adapted to the target task.
  When no target exists, name the kind of task the adapted direction would serve without inventing
  a user brief. Repeat the variation block as B, C, and further letters when needed.
- **Signature retention:** one row per DESIGN.md Signature priority rank, each rank once. Columns
  are `Rank`, then `Variation <letter>` for every `## Variation <letter>:` heading in heading order,
  then `Drop basis`. Every variation cell is `<decision>: <treatment>` with decision `keep`,
  `adapt`, `substitute` or `drop` and a concrete treatment. A rank 1–3 dropped by any variation
  needs a Drop basis starting `Brief:` or `Content:` (or `User:`) with a double-quoted clause that
  appears verbatim in `## Target brief`, and so does any rank that every variation drops; otherwise
  write `none` or a short reason. validate-design scores each variation (keep 1, adapt and
  substitute 0.75, drop 0, higher ranks weigh more) and fails when no variation reaches 0.75. Make
  the variations differ in what they retain; at least one must keep the reference's top signatures.
- **Selected direction:** `**Direction:**` names an existing variation letter. Run validate-design
  after DESIGN.md is final and copy `documents.design.basisSha256` into `**Design basis:**` as
  `sha256:` plus 64 lowercase hex characters and nothing else on the line; any later change to
  Typeface forms, Tone budget or Signature priority requires re-selecting and a new basis. Preserve
  an explicit user choice. Otherwise, when the brief prioritizes the reference's design language,
  select the highest score. A selected score more than 0.10 below the highest needs a bullet
  `- **Selection basis:** User: "verbatim words"` (or `Brief:`) quoting `## Target brief`.
- **Build contract:** columns `Contract | Value | Source`; each key at most once and no other keys.
  Required: `mode` (`derive`, or `clone-base` only on an explicit request), `fonts` and
  `display-fonts` (`;`-separated families; every `fonts` family is an OFL substitute in DESIGN.md
  Typeface forms; `display-fonts` is a subset of `fonts` with at least one substitute of every
  display, heading, headline, title or hero role), `dark-share-max` and `full-bleed-dark-max`
  (decimals from 0 to 1; at most the largest tone.json darkShare + 0.10 and fullBleedDarkShare +
  0.03 unless Source is a `Brief:`, `Content:` or `User:` quote). Add `stylesheets` (`rewritten` or
  `retained`) when mode is `clone-base`. Add `check:<rank>` rows whose Value is
  `<selector> :: <property> <op> <value>`: op is `=`, `!=`, `~` (contains), `!~`, `>=` or `<=`;
  property is a kebab-case computed CSS property of the first visible match, or `count` for the
  number of visible matches (whole numbers with `=`, `!=`, `>=`, `<=`); text comparisons ignore
  case and repeated spaces; numbers may carry `px`. qa passes a row that holds at any one viewport.
  Every kept, adapted or substituted rank 1–3 whose Kind is not tone or motion needs one. Examples:
  `h1, h2 :: font-family ~ Orbitron`, `.button-primary :: clip-path != none`,
  `.frame-corner :: count >= 4`, `footer :: background-color = rgb(245, 245, 245)`. Selectors
  cannot target pseudo-elements: check a real element that carries the device. When headings use
  the body face, add a check row pinning h1 to the display family (with the body face in
  display-fonts, font-drift accepts an h1 set in it). The full-bleed maximum separates dark bands from dark tiles;
  keep `dark-share-max` at the loosest accepted value unless the brief asks for less dark.
  A font the build needs that Typeface forms does not list is not a contract-only change: add it
  as an OFL substitute of the matching role in DESIGN.md first (a proposal column, not an
  observation), rerun validate-design, re-confirm the direction and update the Design basis.
- **Reference fidelity:** analysis-only documents keep Verdict `planned`, but every row's Decision
  already equals the selected variation's decision for that rank; update the Decisions whenever the
  selected direction changes. After build QA, one row per DESIGN rank with the selected variation's
  Decision, Verdict `present`, `partial`, `missing` or `dropped` (only for `drop`), and Evidence
  citing the newest run under `qa/`, made with `--project` and confirmed by qa-confirm, as
  `qa/qa-<epoch>-<8 hex>` in every row. Once any qa run exists or a Verification criteria result is
  no longer planned, this section is required and checked against that run. The cited run must have
  checked the current Build contract and mode: editing the contract after qa requires a new run.
- Give every measured value swap a real old value and source plus a concrete proposed new value.
  When a needed value has no reference evidence, label it a proposed addition and do not invent
  an old value. Use tone.json shares for visible dark/light area, never CSS occurrence counts.
- A conservative direction can preserve structure. A bold or product-adapted direction may change
  hierarchy, density, navigation, and component composition for new work; justify the changes from
  the target need and the reusable principles. A management UI need not inherit a marketing hero.
- Carry DESIGN.md section 11 forward. New work uses original content/assets and must not copy
  source logos, mascots, proprietary font files, photography, icon artwork, or distinctive copy.
