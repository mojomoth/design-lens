# Independent fidelity and blueprint evaluation

This supplements the earlier adaptation evaluation. It exercises the built CLI and the five
portable skill procedures, using only authored local fixtures and network requests on 127.0.0.1.
It does not test plugin installation or discovery. Never modify fixtures to fit generated output.

Serve `../../fixtures/sites/fidelity-study/` on an ephemeral loopback port with the CLI's `serve`
command, using a temporary project whose `clone/` contains the fixture files. Give each fresh
agent an empty temporary workspace and separate `DESIGN_LENS_HOME`. Map the skills' fixed launcher
explicitly to `node <absolute-plugin-cli-path>/dist/design-lens.cjs`; do not modify the launcher,
HOME, or CODEX_HOME. Use `clone --no-block-cookies` for these banner-free fixtures, avoiding an
external filter download. Existing local Playwright dependencies may be used; no new installs.

Give two fresh agents only their brief below, skills and operational context. Do not provide test
code, reference answers, the scoring criteria below, or access to the other's output.

- [Repair brief](repair.md): clone `responsive.html` through the actual bounded repair procedure.
- [Analysis brief](analysis.md): reverse-engineer `dashboard.html`, without a target product brief.

After analysis completes, copy only DESIGN.md and VARIATIONS.md into a third empty workspace.
Give a third fresh agent the [implementation brief](implementation.md), with no original source,
images, observations, fixture path or server URL. This private regression reproduction may use
the authored fixture's generic content. Supply no source assets; a neutral 24px logo is allowed.

The independent evaluator checks the following after the agents finish:

| Check | Passing evidence |
|---|---|
| Repair diagnosis | An initially failing viewport is repaired using saved source evidence within three rounds. |
| Repair result | All three widths pass unchanged fidelity thresholds; editable HTML/CSS and existing IDs survive. |
| Preservation | Independently recomputed source/control hashes match the pre-repair baseline. |
| Numeric traceability | validate-design passes against immutable source observations; sampled claims also agree with source measurements. |
| Interpretation | Observations, inference and proposals remain distinct; no target brief or unobserved behavior is invented. |
| Document usability | A blind implementer can recover container widths/gutters, header/main boundaries, heading family/size/line height/tracking, form direction/gap, input/button boxes, table cell padding and footer sizing at all three widths. |
| Responsive result | Independent browser measurements at 1440×900, 768×1024 and 390×844 agree within 1 CSS px for geometry and exactly for computed type/layout/color values; images are directly viewed. |
| Honest limits | Missing assets and untested states are recorded; logo identity pixels are excluded from the document-usability comparison. |

Preserve commands, initial failures, repair attempts, final documents, implementations, images,
hashes and independent comparison results in temporary workspaces. Do not silently patch a
generated answer and call it a successful skill run. If a skill defect remains, record it, fix
the procedure, and rerun with a fresh agent. Record actual outcomes and artifact paths in
RESULTS.md. This evaluation is not a universal design-quality score or a live-web fidelity claim.
