# Tenity capture repair evaluation — 2026-09-28

The repaired engine preserves all three requested source DOMs and produces usable diagnostic
comparisons. The live result remains **unverified**. Matching aggregate images do not erase
source warnings, regional video differences or unsupported intermediate-width behavior.

## Reproduction

Manual live evaluation, outside the automated localhost-only test suite:

```sh
node plugin/cli/dist/design-lens.cjs clone https://www.tenity.com \
  --viewports 1440x900,768x1024,390x844 \
  --out /tmp/design-lens-tenity-diagnosis-20260928 --project repaired-v3
```

Bundle SHA-256: `26cdeb801d13867baae66177dd1b9f724bab8051ce95d317b953300fc9368409`.
The version remains 0.3.0; this is a repository implementation evaluation, not a published release.
The original baseline used the 0.3.0 bundle at `97a62b8`.

## Observed results

| Observation | Original baseline | Repaired capture |
| --- | --- | --- |
| Requested source captures | Desktop and tablet; mobile navigation failed at 1ms | All three captured |
| Desktop WebGL image | All 1,296,000 pixels transparent | Opaque rendered content in every capture |
| Generated video poster | One fake serialized resource reference | Restored image data; zero fake references |
| Incomplete evidence comparison | Skipped | Explicitly diagnostic, still unverified |
| Responsive DOM | First capture canonical | Three isolated, selectable complete DOM samples |

| Capture | Source / clone full height | First-viewport mismatch | Full-page mismatch | Largest geometry difference |
| --- | ---: | ---: | ---: | ---: |
| 1440×900 | 9663 / 9663 | 0 pixels | 10,393 pixels (0.074691%) | 0.015625px |
| 768×1024 | 12641 / 12641 | 0 pixels | 0 pixels | 0.015625px |
| 390×844 | 10873 / 10873 | 0 pixels | 0 pixels | 0px |

Source, clone and difference images were inspected for all three captures. All 509 recorded
evidence files and 690 recorded clone files match their hashes. The aggregate evidence hash
`57554085b9468e1255465206b7288a8832314395511c2f9f5d5d03aa3f941b4c` matches both
manifest and fidelity report. Original evidence was not edited. The final capture localized
197 desktop, 147 tablet and 147 mobile assets. No source refetch-timeout or capture-deadline
warnings remain. There are 44 CLI warnings; baseline's 20 warnings covered fewer completed
captures and are not a comparable success metric.

Default desktop inspection resolves the active shadow tree (hero `dl-181`). Mobile inspection
at 390×844 resolves hero `dl-1938` to source `viewport-390x844` / `dl-97`. Both return the
expected roles without requiring an explicit element inventory selector.

## Retained limitations

- The desktop globe video's restored static frame differs from the photographed source frame:
  10,393 pixels, 4.745142% of its 468×468 region. Its two containing regions also fail the
  unchanged regional threshold. A successful aggregate image check does not override these failures.
- There are 48 desktop, 152 tablet and 266 mobile region diagnostics outside the captured image.
  They remain reported; they are not counted as verified visual matches.
- Source consistency and unsupported CSS parsing warnings remain. The source server returns
  404 for the duotone font files and arrow image, and 500 for the theme-directory resource.
  Optional bulk video is skipped by default; replay blocks the external globe.mp4 request.
- Eleven offline sizes (390, 540, 578, 579, 580, 768, 960, 1103, 1104, 1105 and 1440px)
  selected one expected sample, with no horizontal overflow, visible broken images, painted
  header overlap or local HTTP errors. These are smoke checks, not exact fidelity guarantees.
  At 1103px the tablet sample has a logo-only header and its captured canvas ends around 768px;
  at 1104px the desktop sample restores navigation and a wider canvas. Sample selection does
  not recover the source site's breakpoints. Exact comparisons cover the three captured pairs.

## Verification

- `npm run verify`: passed typecheck, build, 561 unit tests and 210 browser E2Es.
- `bash .harness/e2e-assert.sh --all`: all 18 sealed assertions passed.
- `bash .harness/verify.sh --strict`: all green, including all 18 sealed assertions,
  plugin validation, fresh bundle, portable skills and the completed 47-task plan.
- Browser regressions cover WebGL pixels, generated posters, RAF freeze, screenshot state
  restoration, viewport budgets, media exclusions, malformed paragraph trees, responsive DOM
  deletion, cascade/rem/fixed layout, nested shadows, SVG/ARIA, override edits, inspect,
  evidence integrity and external-request blocking. Content-removal and identity-spoofing
  negative controls remain effective.

The final evaluation additionally found screenshot-triggered resize callbacks and lost
`content-visibility:auto` intrinsic-size caches. ADR-029 records the narrow screenshot script
pause and detached intrinsic-size preservation. Native visibility and source evidence remain
unchanged. The media refetch path now honors the existing `--include-media` contract.

## Local artifacts

These large live-capture artifacts are intentionally outside Git:

- Baseline: `/tmp/design-lens-tenity-diagnosis-20260928/baseline`
- Final project: `/tmp/design-lens-tenity-diagnosis-20260928/repaired-v3`
- Source images: final project `evidence/viewport-WxH/screenshots/original-full.png`
- Comparison images: final project
  `screenshots/fidelity-1790571663705-fbc71e71-5c99-49c4-8a1b-bbb495af6e8b/`
- Audit: `/tmp/design-lens-tenity-v3-audit.json` (final entry is repaired-v3)
- Width checks and screenshots: `/tmp/design-lens-tenity-v3-smoke/`
- Default inspect: `/tmp/design-lens-tenity-v3-inspect-desktop.json`
- Mobile inspect: `/tmp/design-lens-tenity-v3-inspect-mobile.json`
- Test logs: `/tmp/design-lens-final-npm-verify.log`,
  `/tmp/design-lens-final-strict.log`, `/tmp/design-lens-final-sealed-all.log`
