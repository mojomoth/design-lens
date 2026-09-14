# Recorded adaptation evaluation — 2026-09-14

**Both briefs passed independent evidence, image and behavior review.** Two fresh agents used
the same local Fieldwork reference and the actual five skills, without generated design answers
or access to the other run. Each completed capture, analysis, three directions, selection,
implementation, viewed screenshots and browser checks. Repairs within the skill's verification
loop are recorded below; these were not zero-error first drafts.

## Setup and evidence

- Protocol and complete inputs: [README](README.md), [marketing](marketing.md),
  [management](management.md), [reference fixture](../fixtures/sites/design-study/index.html).
- Source: `http://127.0.0.1:59382/index.html`, served through the built CLI's loopback server.
  Both captures used 1440×900 and disabled banner blocking for this banner-free fixture.
- Skills: committed procedures from `2961234` (T34), including T33's lenses/templates.
  Initial captures/measurements used the T32 implementation bearing version 0.1.1. Later commands
  used the rebuilt 0.2.0 CLI; independent final 0.2.0 detailed inspection of both clones returned
  11 mobile elements, no warnings, the measured 10px root and ready fonts. Font-network edge cases
  are covered separately by the release's deterministic E2E suite.
- The fixed launcher was explicitly mapped to the repository's built bundle. No bootstrap,
  dependency installation, real launcher modification, publishing or live-web test was performed.
- Artifact root on the evaluation machine:
  `/var/folders/lx/2l4_myln77j11v_rskxlc7kr0000gn/T/design-lens-evaluation-6xogmknt`.
  Paths below are relative to that root. Generated artifacts are retained locally, not committed;
  temporary-directory retention is not guaranteed. Fixture, briefs and protocol are reproducible.
  Evaluation servers were stopped after review; the workspace READMEs explain how to restart apps.

## Observed outcomes

| Criterion | Relay Desk introduction | Relay Operations management |
|---|---|---|
| Traceable principles | Seven principles link screenshots/measurements including dl-9/12/15/17/31 to implementation and checks. | Six principles cite actual dl-1/12/15/17/31 measurements and source states. |
| Applied design | Prominent promise and CTA, ruled benefits, a grouped original handoff example, explicit process and working demo form. | Compact heading, current-result totals, search/status controls, aligned queue rows and detail dialog. |
| Structural adaptation | Replaced journal art/prose with a product example, process and form; original sans-serif identity and teal actions. | Removed the promotional hero/art, prioritized records and comparison; metadata reflows under each subject on narrow screens. |
| Honest interpretation | Rejected unused purple declarations as a primary-color guess; distinguished 10px rendered root from static 16px conversion; did not claim unbound keyframes ran. | Independently reached the same three distinctions; source observations, clone measurements, inferences and proposed app states remain separate. |
| Responsive images | Full-page 1440×900, 768×1024, 390×844 captures viewed; mobile first-screen and long-preview details also viewed. | Full-page captures at all three sizes viewed; mobile long-record dialog also viewed. |
| Behavior | Navigation/CTA destinations, required and whitespace errors, entered-value confirmation, long text, edit/repeat and visible keyboard focus passed at all three widths. | Eight records, owner/ID search plus status filter, empty/reset, details, resolution/count updates, close-focus restoration and reload reset passed at all three widths. |
| Rendering/network | No document overflow, browser errors or non-loopback requests; no form submission occurred. | No document overflow, browser errors or non-loopback requests; changes remain in memory. |
| Preservation | Three original capture hashes unchanged; source brand/copy/assets absent from app. | Three original capture hashes unchanged; source brand/copy/assets absent from app. |

Both agents recorded target context, their chosen direction and structural reasons before coding,
then replaced planned checks with actual evidence in VARIATIONS.md. The introduction supports
understanding and trying a product; the management screen supports finding and resolving work.
The reviewed results are visibly different compositions, not the same hero with substituted text.

## Verification and repairs

The marketing agent recorded **45 passing browser checks**, after fixing native anchor navigation
overriding CTA focus, whitespace around a responsive line break, and offscreen skip-link rendering
in scrolled full-page screenshots. Its last app edit was 06:53:47 UTC. Earlier failures and repairs
remain in `marketing/logs/`; final checks are in `marketing/verification-results.json`.

The management agent recorded **120 passing browser checks**, after fixing dialog Tab wrapping
and a close-event race during rapid reopening. Its last app edit was 06:51:46 UTC. Earlier failures
remain in `management/logs/`; final checks are in `management/logs/verification-4.json`.

The independent evaluator then exercised the final apps in separate Chromium contexts at all
three widths. It reviewed the six full-page images plus mobile first-screen/preview/dialog states,
checked the analysis against actual source values and output structure, and independently verified
all six original hashes. Final captures are byte-identical to the already viewed images. These
checks did not modify either implementation. Reproducible browser check scripts, JSON outcomes,
final images and 0.2.0 inspection results are in `review/final/`; artifact hashes are in
`review/integrity.json`.

Both agents generated working controls and performed their own repair loop before final review.
No skill failure requiring a fresh replacement run remained. These counts describe checks within
these two examples, not a numerical design-quality score or proof of universal reliability.

## Artifact map and limits

| Artifact | Relative path |
|---|---|
| Marketing app and serving instructions | `marketing/app/`, `marketing/README.md` |
| Marketing design and adaptation | `marketing/.design-lens/relay-desk-reference/DESIGN.md`, `VARIATIONS.md` in that directory |
| Management app and serving instructions | `management/app/`, `management/README.md` |
| Management design and adaptation | `management/.design-lens/management-study/DESIGN.md`, `VARIATIONS.md` in that directory |
| Independent final viewport images | `review/final/marketing-{1440,768,390}-full.png`, `management-{1440,768,390}-full.png` |
| Independent behavior results | `review/final/marketing-result.json`, `management-result.json` |

This evaluation used local Chromium and complete empty-project briefs. It does not verify plugin
auto-discovery/installation, framework-component reuse in an existing application, other browser
engines, physical devices, screen-reader behavior, real service integrations, or live-web capture
fidelity. Both apps explicitly identify their local demo behavior. No baseline comparison or
general performance/quality improvement percentage is claimed.
