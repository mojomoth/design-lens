# Recorded fidelity and blueprint evaluation — 2026-09-27

The clone repair and analysis-only runs passed independent review. A third fresh agent then
reproduced the dashboard's measured layout from the two design documents alone. These are local
authored examples, not a claim of perfect capture of arbitrary websites.

## Setup

- Protocol and briefs: [README](README.md), [repair](repair.md), [analysis](analysis.md),
  [implementation](implementation.md).
- Fixtures: `../../fixtures/sites/fidelity-study/`, served at `http://127.0.0.1:60878`.
  The analysis used dashboard.html; the repair run used responsive.html.
- Runtime: T38/T39 bundle at commit `8f36260`, still bearing the pre-packaging 0.2.0 version.
  Chromium 149.0.7827.55, Playwright 1.61.1, DSF 1, light scheme, reduced motion.
  The T40 clone/reverse-design procedures were supplied from isolated drafts matching this commit.
- Three independently loaded source states: 1440×900, 768×1024 and 390×844.
  Consent filtering was disabled for banner-free local pages; all traffic stayed on loopback.
- The skills' fixed launcher explicitly mapped to the built repository CLI. No real runtime,
  installed skill cache, plugin discovery, remote service or published package was changed.
- Local artifact root:
  `/var/folders/lx/2l4_myln77j11v_rskxlc7kr0000gn/T/design-lens-evaluation-v030-3xox1rwa`.
  Paths below are relative to it. Artifacts are retained locally, not committed; temporary
  directory retention is not guaranteed. Fixtures, protocol, briefs and comparison script are
  committed to make the evaluation repeatable. Evaluation servers were stopped after review.

## Outcomes

| Evaluation | Observed result |
|---|---|
| Initial responsive clone | Mobile failed: image mismatch 4.423%, eight failed elements, maximum geometry difference 24px. Desktop/tablet passed. |
| Agent repair | One round added the source-evidenced mobile Menu structure with clone-only ID dl-10 and responsive CSS. Existing IDs and source evidence were preserved. |
| Final repair fidelity | All three sizes passed with zero pixel and geometry differences; all nine format checks passed. The evaluator directly viewed the final images. |
| Source integrity | The evaluator independently recomputed all 32 repair source/control file hashes: unchanged. |
| Analysis capture | All three sizes passed with zero pixel/geometry differences; no repair needed. |
| Blueprint | DESIGN retains twelve sections, six recipe tables, concrete HTML/CSS, and 188 source observation rows. VARIATIONS provides three conditional directions without inventing a target brief. |
| Validation feedback | First validation correctly rejected two image natural-size rows using unitless instead of px. The agent corrected its document; the failed draft/report remain preserved. Second validation passed all 220 checks, including 188 measurements. Independent rerun also passed. |
| Analysis integrity | Independent recomputation confirmed 37 source/evidence file hashes unchanged. |
| Blind reproduction | A fresh agent received only DESIGN/VARIATIONS and operational browser/server context. It produced static HTML/CSS with a neutral 24px logo and no external resources. |
| Independent comparison | All 988 checks passed at each of three sizes (2,964 total): element existence and geometry, recorded computed type/layout/color/spacing/borders, logo slot geometry, fonts, overflow, external requests and browser errors. |
| Image review | Evaluator directly viewed all three original dashboard images and all three independent implementation images, in addition to the repaired responsive images. Layout, wrapping, controls and table treatment agreed. |

The comparison uses [compare-implementation.mjs](compare-implementation.mjs), original immutable
observations and a fresh browser context. Geometry tolerance is 1 CSS px; selected computed values
must match exactly. It excludes logo identity styling, but checks the logo's position and size.
It does not mask any difference in the clone fidelity result. No agent answer was patched by the
evaluator to achieve these results.

The independent reading also confirmed that inactive shared stylesheet card/grid colors were not
claimed as painted dashboard components; transparent values were not called black paint; native
input defaults, system font uncertainty and collapsed margins were explained. Motion/interaction
remained unavailable rather than invented. Responsive breakpoint declarations were distinguished
from the three measured viewport states. Proposed variations stayed conditional on a future brief.

## Artifact map

| Artifact | Relative path |
|---|---|
| Repair clone and command log | `repair/.design-lens/127-0-0-1-responsive-html/`, `repair/evaluation-commands.md` |
| Repair initial/final results and hashes | `repair/evaluation-result.json`, `repair/source-hashes-baseline.json`, `review/repair-integrity.json` |
| Blueprint and source evidence | `analysis/.design-lens/dashboard-study/` |
| Analysis commands and failed/successful validation | `analysis/COMMANDS-AND-RESULTS.md`, `analysis/validation-round-1.json`, `analysis/validation-round-2.json` |
| Independent analysis validation and preservation | `review/independent-validation.json`, `review/analysis-integrity.json` |
| Blind implementation | `implementation/app/`, supplied `implementation/DESIGN.md` and `VARIATIONS.md` |
| Independent measurements and images | `review/implementation-comparison.json`, `review/implementation-{1440,768,390}-full.png` |
| Evaluated implementation hashes | `review/implementation-app-hashes.json` |

The evaluated DESIGN SHA-256 is `3fdffce9f376c72e855285596b7ed9b655ac590906a0de627a9937dcea87dfa5`;
VARIATIONS is `6fc80c558357e272df85b2dcd0a9dfa4e6d9e0d76168a4bb29881681caaea434`.
Repair evidence hash is `5757560c2b83cb5b197bfe26fe7a3b5dca573674fa528d2e2adb26d4ed36d6ce`;
analysis evidence hash is `b57a382386cf2c959a88ee28664c12aae3a0f95e8aea4eae3f39263c74e81368`.

## Limits

This evaluates a compact dashboard and one JavaScript-responsive static appearance. The supplied
blueprint includes a concrete CSS recipe and content scaffold; the blind run tests whether that
handoff is sufficient, not invention of a design from sparse prose. It does not establish accuracy
for complex live sites, inaccessible embeds, closed shadow roots, different operating systems,
other browser engines, arbitrary intermediate widths, long translated content or source JavaScript
behavior. The reproduction intentionally supplies no filtering backend. The numeric check count
describes this fixture's comparisons, not a universal quality score. Deterministic fixtures cover
other capture families and negative controls separately in the E2E suite.
