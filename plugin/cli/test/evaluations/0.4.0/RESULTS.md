# Recorded 0.4.0 evaluation — 2026-10-06

Three evaluations measured the 0.4.0 changes against the failures of the external four-arm
experiment summarized in the [baseline](README.md). E1 re-checked the experiment's four finished
builds with `qa` and `tone`. E2 recaptured the experiment's live reference. E3 ran the skills end to
end on a local fixture, through a derive build and a clone-base build. Every generated artifact
stayed outside the repository in temporary directories that were deleted afterwards; only the
numbers below are kept. These are single runs by LLM agents, not proof of better designs.

## Bundles

| Bundle | MD5 | Used for |
|---|---|---|
| Evaluated 0.4.0 build | `58a6333ebbb96764ad3668a731f1ea09` | E1, E2 and E3 as first run |
| Post-evaluation build | `6665b3e094034b9b65ba22002315140f` (SHA-256 `89180f4fdf56d3be2d54af3c4cc070620e694603f81e339dc65fdae3934d89d0`) | E1 rerun, fixture reproductions, first release-gate run |
| Final 0.4.0 build | `adcfa38705906c7b806b6de9ec2146bd` (SHA-256 `8155aa4dc46c089a7dea4eb963d7fb31a0bd7c628b0a602af83a0f0a3452c592`) | final release gates; differs from the post-evaluation build only in validate-design accepting Korean display-role names in Typeface forms |

The evaluated build predates the review and evaluation fixes listed under "Changes made because of
the evaluation". E1 was rerun in full on the final build. E2 and E3 were not rerun as a whole on
the final build; the parts they found broken were reproduced on fixtures and fixed (see each
section).

## Baseline: the swmaestro experiment (0.3.0)

A Korean public-program landing page (swmaestro.ai content) was built in the design language of a
technology-lab reference (ChainGPT Labs) by two models, each with and without the 0.3.0 plugin.
One run per arm, three blind LLM judges plus one fidelity judge, six criteria averaged.

| Arm | Plugin | Overall | Reference fidelity | Wall time | Shell commands / CLI calls |
|---|---|---|---|---|---|
| astra-ultra | no | 8.41 | 8.30 | 21 min | 32 / 0 |
| design-lens-ultra | 0.3.0 | 8.03 | 7.20 | 32 min | 74 / 18 |
| sol-high | no | 7.73 | 8.28 | 15 min | 26 / 0 |
| design-lens-sol | 0.3.0 | 7.05 | 6.30 | 23 min | 55 / 22 |

Within each model the plugin arm scored lower overall (−0.38 and −0.68) and lower on reference
fidelity (−1.10 and −1.98), and took about 52% longer. Six failure themes came out of the process
audit:

1. **Brief and skill conflicted.** The brief said to build from the clone; build-from-design forbade
   clone markup. Both plugin arms copied the clone and discarded it (0 `data-dl-id` in the final
   HTML), and a self-written lineage file claimed reuse.
2. **Signatures were not ranked.** DESIGN.md recorded the pixel/techno display face as family and
   size only, and missed the orange corner squares, clipped-corner buttons, carousel chrome,
   marquee hero and light closing band.
3. **Builds left the documents.** Builds added full-bleed dark bands (reference: about 2.6% dark,
   0% full-bleed) and fonts no document named.
4. **Direction came before evidence.** One arm chose its direction before DESIGN.md existed;
   several writers overwrote VARIATIONS.md.
5. **Defects passed verification.** Dead span tabs, `#footer` stand-in links, a fixed button over a
   CTA, a white-square icon, a masked 5 px overflow and invented "09 MONTHS"/"11 MONTHS"; the
   screenshots were never viewed.
6. **Captures were incomplete.** Every capture was `complete:false` (media skipped, lazy images
   not loaded, state changes), so fidelity stayed unverified and repair never ran.

Cost was a further gap: `inspect --all --details` produced about 57 MB per viewport and helper CLI
runs left no per-phase timing.

## E1 — Ground-truth qa on the four experiment builds

Command per arm, with the default three viewports (1440x900, 768x1024, 390x844):

```bash
design-lens qa --dir <experiment>/<arm>/final --content <experiment>/_shared/target/CONTENT.md --out <tmp>/gt/<arm>
```

Results on the final build (rerun 2026-10-06, serialized, load average about 2.8). Fail counts are
identical to the evaluated build's; warn counts fell because of the two noise fixes below.

| Arm | Status | Fail / warn (evaluated build) | Fail / warn (final build) | Wall time (final) | Review images |
|---|---|---|---|---|---|
| design-lens-sol | fail | 69 / 13 | 69 / 10 | 58.5 s | 17 |
| sol-high | fail | 76 / 15 | 76 / 12 | 68.8 s | 18 |
| design-lens-ultra | fail | 15 / 19 | 15 / 5 | 61.9 s | 17 |
| astra-ultra | fail | 15 / 6 | 15 / 0 | 65.8 s | 15 |

Fail findings per viewport (1440 / 768 / 390), final build:

| Arm | dead-control | stand-in-link | fixed-overlap | solid-icon | clipped-content | unsourced-number |
|---|---|---|---|---|---|---|
| design-lens-sol | 8 / 8 / 8 | 11 / 11 / 11 | 0 / 0 / 2 | 1 / 1 / 1 | 0 / 0 / 4 | 1 / 1 / 1 |
| sol-high | 8 / 8 / 8 | 16 / 16 / 16 | 1 / 1 / 1 | 0 | 0 | 1 / 0 / 0 |
| design-lens-ultra | 0 | 0 | 0 | 0 | 0 | 5 / 5 / 5 |
| astra-ultra | 0 | 0 | 0 | 0 | 0 | 5 / 5 / 5 |

**Recall: 12 of 12 known defects, each at the right viewport.**

- design-lens-sol (6 of 6): dead span tabs (8 per viewport); `#footer` stand-ins (self-anchored
  policy links and five labels sharing `#footer`); `.quick` over the hero CTA at 390 (coveredRatio
  0.178, centre free; a 0.05 warn at 768); the white-square step icon (`solid-icon` at all three
  viewports); the 5 px clipped project cards at 390 (`clipped-content` on 4 cards); "09 MONTHS".
- sol-high (4 of 4): dead span tabs; `#footer` stand-ins; `.quick` over the carousel next button at
  390 (0.5, including its centre); "11 MONTHS" at 1440 only — its ancestor is `display:none` at
  768 and 390, so 0 there is correct.
- design-lens-ultra and astra-ultra: the invented cohort captions (11기–15기), 5 per viewport. The
  judges had flagged these as invented; qa fails them against CONTENT.md.

**False fails: none found.** The astra-model builds have working tabs and real links: 0
dead-control fails (the per-viewport `controls` summary now shows 9–13 candidates, every clicked
one live, and one hover-timeout skip at 768 and 390) and 0 stand-in-link fails (0 of 106 and 0 of 125
links). The other fails outside the known list were judged real on screenshots: ↗-labelled links
pointing in-page, ten labels sharing `#program`, `.quick` covering a footer link at 390
(design-lens-sol) and sol-high's hero scroll cue at 1440 (0.569 including its centre). One is
borderline: sol-high's cue at 768 is 16.2% covered with the glyph still visible.

**Warnings** never affect status. On the evaluated build 22 of 53 were noise: sticky-header
slivers of 0.5–2.1% and "five or more labels share one URL" on real listing pages. Both rules were
narrowed (a top-pinned cover below 5% is not reported unless it covers the centre; the shared-URL
warning applies only to a bare site root), and the final build reports 27 warnings: in-page
navigation groups, sol-high's intentional glyph bleed (labelled as such), `#site-map` used for
login and sign-up, the 0.05 `.quick` overlap at 768, and two side-bar slivers (3.8% and 0.8%) at
390 on design-lens-ultra.

**Cost.** Determinism: the four 2-viewport runs repeated on the evaluated build gave byte-identical
findings, tone and full-page PNGs, with wall times within 0.4 s. The controls phase (clicking
candidates) takes 51–64% of a viewport's time on the evaluated build and 56–73% on the final
build. Each run asks the reviewer to open 15–18 images.

**Tone against the reference.** `tone` on the experiment's reference project exits 0 in about
2 s. Reference: darkShare 0.0270 / 0.0219 / 0.0273, fullBleedDarkShare 0, 0 bands, `tiles` at all
three viewports (measured on the 0.3.0 source images, which carry the `<noscript>` artifact of E2).
Builds at 1440 (identical on both bundles):

| Arm | darkShare | fullBleedDarkShare | Bands | darkUsage |
|---|---|---|---|---|
| reference | 0.0270 | 0 | 0 | tiles |
| design-lens-sol | 0.4468 | 0.4150 | 6 | mixed |
| sol-high | 0.3853 | 0.3356 | 3 | mixed |
| design-lens-ultra | 0.2074 | 0.1454 | 2 | mixed |
| astra-ultra | 0.0874 | 0 | 0 | tiles |

With a stand-in Build contract at the loosest values validate-design accepts (dark-share-max
0.1273, full-bleed-dark-max 0.03), `qa --project` gave 4 `tone-drift` fails (both metrics at both
checked viewports) to each of the three dark-band builds and none to astra-ultra. Full-bleed share
separates cleanly (0 against at least 0.11); darkShare only narrowly (astra-ultra reaches 0.1046 at
390), so the template now relies on `full-bleed-dark-max` and keeps `dark-share-max` loose. A
tampered source screenshot made `tone` exit 1 with no output written.

`validate-design` on the experiment's 0.3.0 reference documents: 129 checks, 27 pass, 94
unverified (the captures are incomplete), 8 fail — all 8 are new 0.4.0 checks for tables those
documents lack. None of the checks that existed before 0.4.0 fails.

## E2 — Live recapture of the reference

`clone https://labs.chaingpt.org/ --viewports 1440x900,768x1024,390x844` with the evaluated build,
compared with the 0.3.0 capture from the experiment:

| | 0.3.0 | 0.4.0 (evaluated build) |
|---|---|---|
| Captures complete | false ×3 | true ×3 |
| Warnings per capture | 16 (7 unread bodies, 141–152 slow images, 2 state changes, 6 media skipped) | 0 |
| Remote media | 6 | 0 (9 substitutions: 3 videos per capture as captured frames) |
| Disclosures per capture | — | lazy-promoted 144/157/147, media-substituted 3, late-stamped 2, body-unread-reconciled 1, body-unread-nondesign 6 |
| Wall time | about 31–34 s per viewport (capture spacing) | about 37–39 s per viewport, 174.4 s in all (two state attempts each) |
| Fidelity | unverified | fail at all three viewports |

**A tool artifact behind the fail.** Fidelity failed with viewport mismatches of 0.113 / 0.156 /
0.172, and 1447 / 1304 / 1282 elements off by one exact offset per viewport (22.41 / 41.72 /
98.98 px). The cause was in design-lens, not the site, and dated from 0.3.0: paused screenshots
disable script execution through CDP, after which the page's two analytics `<noscript>` blocks
rendered as visible text. The first attempt saw a state change; the second attempt photographed
the shifted page and called it consistent, while the clone (which strips `<noscript>`) did not
have the band. Capture now keeps `<noscript>` unrendered during paused screenshots.

**Retrospective:** part of the 0.3.0 failures blamed on the site came from this artifact. The 0.3.0
full-image failures (0.0697 at 1440, 0.1000 at 768) show the same uniform 23 px and 42 px shift,
and at least part of its "source state changed" warnings were this band. The genuine page change
was a carousel advancing one slide (408.67 px). The 390 tone profile above was measured on a
441 px-wide source image widened by the same artifact.

**After the fix: not re-measured live.** The fixed build was not run against the live site. A
fixture page (`stabilization/noscript.html`) reproduces the artifact: the 0.3.0 bundle gives 2
state-change warnings and fidelity `unverified`, the final build 0 warnings and `pass`. An offline
estimate on the live images with the band removed left full-image differences of 0.9% / 0.6% /
0.1% spread evenly down the page, so a live pass at 1440 and 768 should not be assumed.

**Inspection cost on the clone:** `inspect --lite --viewports` (three viewports) returned 15.7 KB in
about 2 s; `--lite --all` 1.65 MB in 2.6 s; `--all --details` at one viewport 56.9 MB in 15 s, as
in the baseline. `RUNLOG.jsonl` recorded every command with per-viewport clone phases (navigate,
sweep, attempts, refetch, compose, re-render, fidelity), and `runlog --summary` reproduced
byte-identically.

## E3 — End-to-end skill run (derive and clone-base)

One agent followed the skills against the authored `fidelity-study/marketing.html` fixture served
on 127.0.0.1, for a fictional product with a supplied CONTENT.md, using the evaluated build. The
launcher was mapped to the built bundle and `DESIGN_LENS_AGENT` was set.

| Step | Result |
|---|---|
| clone (3 viewports) | exit 0, 17.5 s, 0 warnings, all captures complete, fidelity pass |
| tone | darkShare 0.033 / 0.0301 / 0.0321, full-bleed 0, `tiles` |
| inspect `--lite --viewports` | 7.8 KB and 25 KB outputs, about 0.4 s each |
| DESIGN.md | 54 measured rows, 2 Typeface forms rows, 7 Tone budget rows, 6 Signature priority rows |
| VARIATIONS.md | scores A 0.905, B 0.738, C 0.869; A selected (highest), Design basis recorded |
| derive build qa | two runs, both pass with 0 fail / 0 warn (about 7 s each); lineage 0 clone ids; signature checks pass; final run confirmed |
| clone-base build qa | run 1 fail (3 dead-control, 3 console-error warns from an escaping bug the agent wrote in an inline handler); run 2 pass, 0 fail / 2 warn, 12.8 s; 18 of 18 retained ids (retainedRatio 1); confirmed 5 of 5 codes first try |
| validate-design | 126 of 126 checks pass, referenceFidelity score 1, citing the newest confirmed run (`qa-1791229345420-fe0c0f82`) |
| interaction (clone-base build) | keyboard order and focus outlines at 1440 and 390; the button opens the sign-up URL |
| run log | 31 records, 23 commands, 58.9 s of CLI time; phase windows reverse-design 227 s, derive build 146 s, clone-base 152 s after resuming |

The evaluating agent also viewed the derive compare sheets itself and checked font provenance. Six
commands exited 1: four intended validate-design verdicts, the qa run that caught the agent's bug,
and one mistyped review code.

**Frictions found and what changed:**

| Friction | Change |
|---|---|
| After the contract's mode and check selectors changed, validate-design still accepted Reference fidelity citing a run under the old contract | qa.json records the Build contract and mode; `reference-fidelity-qa` fails "the Build contract changed after qa/<run>" (verified end to end with two real runs) |
| One VARIATIONS.md cannot record two builds | build-from-design: one recorded build per study project |
| Clone-base needs href/alt/title/aria-label edits, new elements and no verify/fidelity on the copy; the copied header comment pointed at a missing path | build-from-design and customize-clone state each rule |
| Retained captured style blocks were not detected; unused captured stylesheet files stayed | captured style blocks count toward `stylesheets: rewritten`; the skill says to delete unused copies |
| A console error gave no location | console and uncaught-error details carry the script location |
| Compare sheets drew the taller page smaller | both pages at one scale, the shorter one padded |
| Run-log gaps: no clone/reverse-design marks, an interrupted window counted as 3152 s, verdict exits counted as errors | both skills mark their phase; `--event abort`; verdict records counted apart |
| Whole-file reads of evidence.json and fidelity.json | skills ask for targeted reads |
| The 768 review image shows only the first screen | build-from-design: scroll-check middle viewports |
| Headings in the body face, offline fonts | VARIATIONS template pins h1; build-from-design records font source and licence |

Not changed: review badges still sit on the page (a margin strip would let codes be read without
viewing; the skill points to the badge-free full screenshot), and there is no evidence crop
command.

## Changes made because of the evaluation

E1: top-sliver suppression in `fixed-overlap`, shared-URL warning for bare site roots only,
per-viewport `controls` counts in qa.json, tone guidance on full-bleed share, emphasis-tolerant
selected-direction parsing with the expected format in the detail. E2: `<noscript>` hidden during
paused screenshots with a reproducing fixture, deduplicated non-design disclosures. E3: the
frictions above. Code review before release added further fixes (ADR-030, review amendments). ADR-030 records each, including the contract deviations.

## Limitations

- n=1 per arm and per mode; all agents and judges were LLMs. E1's "real defect" calls for fails
  outside the known list are one evaluator's judgement, checked on screenshots.
- E1 measures recall only for the 12 named defects plus the astra builds' working tabs and links;
  defects outside that list that qa missed were not measured. font-drift and signature checks were
  not exercised on the experiment builds (the stand-in contract used the builds' own fonts).
- E2 was one live capture of one reference, before the `<noscript>` fix; the fix was verified on a
  fixture, not live.
- E3 ran on a small loopback fixture, not the swmaestro site. One agent produced both builds
  in sequence, after an interruption; the derive half was verified rather than redone. The
  protocol's two fresh agents were not run. Fonts came from local copies (no network). The
  clone-base skeleton comparison had one block per width, so its similarity of 1 means little.
- The evaluated build predates the fixes; only E1 was rerun on the final build.
- Wall times come from a shared machine with other Chromium runs (load average 2–4).
- Known gaps left open: dead-control clicks at most six members per group (the 7th dead tab is never
  reported); hover timeouts skip one filter button at 768 and 390; five footer elements stay
  unmapped at 768 and 390 in the live clone (also in 0.3.0); the lite role inventory labels the
  footer logo as `logo` at 1440.
