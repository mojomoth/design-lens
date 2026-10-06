# 0.4.0 evaluation: baseline findings and protocol

This record has two parts. The **baseline** summarizes the external four-arm experiment that
motivated 0.4.0 (ADR-030). It was run on the public web outside this repository, so none of its
artifacts are committed and it is not a repository test. The **protocol** describes the fresh
local evaluation of the 0.4.0 skills that must run before the release task; its outcome goes in
[RESULTS.md](RESULTS.md).

## Baseline: four-arm reference-to-target build (0.3.0)

Task: build a Korean public software-program landing page (swmaestro.ai content) in the design
language of a technology-lab reference page (ChainGPT Labs), in an unattended Codex session.
Two arms used the 0.3.0 plugin, two used the same models without it. One run per arm; all judges
were LLMs; criteria were averaged with equal weight. Treat differences of 0.3–0.7 as possibly noise.

| Arm | Plugin | Overall | Reference fidelity | Content | Technical | Minutes |
|---|---|---|---|---|---|---|
| astra-ultra | no | 8.41 | 8.30 | 8.50 | 8.80 | 21 |
| design-lens-ultra | 0.3.0 | 8.03 | 7.20 | 8.55 | 8.60 | 32 |
| sol-high | no | 7.73 | 8.28 | 7.83 | 7.10 | 15 |
| design-lens-sol | 0.3.0 | 7.05 | 6.30 | 7.45 | 6.55 | 23 |

Within the same model the plugin lowered fidelity by 1.10 and 1.98 points and took about 52%
longer. The fidelity judge listed 19 reference traits; the traits that separated plugin from pure
arms were the pixel/techno display face, small orange corner squares, carousel chrome, black
inverse tiles instead of full dark bands, the cropped marquee hero word, the light closing footer
grid band, and (for one arm) clipped-corner buttons.

Observed causes, with the 0.4.0 response:

| Finding | Evidence | 0.4.0 response |
|---|---|---|
| Brief and skill conflicted | The brief said to build from the clone; the skill forbade clone markup. Both plugin arms copied the clone, then overwrote it; 0 `data-dl-id` survived, yet a self-written lineage file claimed reuse. | `derive` and explicit `clone-base` modes; lineage measured by `qa` (`build-lineage.json`). |
| Signatures not recorded | The template asked for "two or three" signature moves; both arms wrote three. The display face was recorded as family and size only; replacements were of another form class (grotesk, poster-heavy). | `### Signature priority` (5–10 ranked devices), `### Typeface forms` with form classes and same-class OFL substitutes, `display-fonts` and `font-drift`. |
| Unspecified tone and fonts in the build | Reference full-page dark share 2.1–2.6%, full-bleed dark 0%. Builds: 20.5% and 44.4% dark, 14.6% and 42.0% full-bleed (a pure arm also had 33.6%). One build loaded fonts no document named. | `tone` and `### Tone budget`; Build contract dark maxima; qa `tone-drift` and `font-drift`. |
| Direction chosen too early | One arm chose its direction before DESIGN.md or VARIATIONS.md existed; three writers overwrote VARIATIONS.md; every variation dropped the same signatures. | `## Signature retention` scores, Design basis hash, single-writer rule, selection by retention when the brief prioritizes the reference. |
| Defects passed verification | Dead `<span>` filter tabs, up to 15 labels pointing at `#footer`, self-anchors with ↗, a fixed button covering 18% of a CTA, an opaque PNG made a white square by `brightness(0) invert(1)`, cards overflowing 5 px under `overflow-x:hidden`, invented "09 MONTHS"/"11 MONTHS" and cohort captions. No image-view events were logged. | `qa` checks (`dead-control`, `stand-in-link`, `fixed-overlap`, `clipped-content`, `solid-icon`, `unsourced-number`, …) and review images confirmed by `qa-confirm`. |
| Captures incomplete | All captures `complete:false`: six media-skipped videos, 138–152 lazy images that never loaded, state changes during capture. Fidelity stayed unverified; repair never ran. | Poster media, eager lazy images, readiness retries, capture attempts, opt-in timer freezing, disclosures. |
| Cost invisible | `inspect --all --details` reported about 8,000 elements (about 57 MB) per viewport; helper CLI runs never reached the main log; no per-phase timing existed. | `inspect --lite`, `--selector`, `--viewports`; `RUNLOG.jsonl` with agent roles and phases. |

Caveats recorded by the experiment: one reference and one target only; the reference is video-
and animation-heavy; models and effort levels were confounded; the plugin was used by reading
SKILL.md under Codex; command counts for one arm disagree between sources; the fidelity criterion
rewards surface signatures and may undervalue principled adaptation.

## Protocol: fresh local evaluation of 0.4.0

Follow the operational rules of the [two-brief evaluation](../README.md): authored fixtures under
`../../fixtures/sites/` served on an ephemeral 127.0.0.1 port, separate empty workspaces and
`DESIGN_LENS_HOME` per agent, the launcher mapped explicitly to the built bundle, `clone
--no-block-cookies`, no installs, no repository edits, generated artifacts kept outside the repo.

Run two fresh agents on the same reference with a supplied content file:

1. **Derive:** a brief stating that the result must clearly apply the reference's design
   language for a different product. Expect `mode | derive`, a retention-based selection, and no
   clone files in the build.
2. **Clone-base:** a brief explicitly asking to build on the captured clone. Expect the study
   clone unchanged, the copy's captured images/fonts/media deleted, all text replaced, and the
   checklist's clone-base item reported.

The evaluator checks, from artifacts and a browser, not from the agents' reports:

| Check | Passing evidence |
|---|---|
| Ranked signatures | Signature priority has 5–10 rows with at least three Kinds; the display face is classified by form from a glyph crop. |
| Direction discipline | VARIATIONS.md's Design basis matches validate-design; selection follows the brief; one writer. |
| Contract and tone | Build fonts and dark shares stay within the Build contract; qa reports no `font-drift` or `tone-drift`. |
| QA and viewing | The final qa run has no `fail`; `review.json` exists for the run cited in Reference fidelity; the agent viewed every review image. |
| Reference fidelity | Every kept rank 1–3 signature is present or partial, and an independent comparison of reference and build agrees. |
| Lineage | derive: build id count 0; clone-base: best retained ratio at least 0.3, measured by qa. |
| Honest limits | Unverified checks, skipped qa checks and disclosed capture substitutions are reported. |
| Cost | `runlog --summary` lists phases and helper roles; inspection used lite mode. |

Record commands, hashes, qa run ids, scores and limits in RESULTS.md. If a skill or CLI defect
fails a run, keep the failed run, fix the cause and rerun fresh; a manually repaired output is not
a skill pass.

The recorded evaluation (RESULTS.md) followed this protocol in part: one agent produced the derive
and clone-base builds in sequence rather than two fresh agents, and two further evaluations
re-checked the baseline experiment's builds and live reference. RESULTS.md states each deviation.
