# Local skill adaptation evaluation

This is a recorded agent evaluation, separate from deterministic CLI tests. Run two fresh agents
against the same authored `../fixtures/sites/design-study/` reference, giving each one only its
brief (`marketing.md` or `management.md`), the installed skills and the operational context below.
Do not supply generated designs, expected HTML, the other run's output or this scoring rubric.

Serve the reference on an ephemeral 127.0.0.1 port using the built CLI's `serve` command: create a
temporary project directory and symlink its `clone/` to the fixture site. Keep that process alive
until both runs finish. Create a separate empty workspace and `DESIGN_LENS_HOME` for each run.
All capture and test traffic must stay on 127.0.0.1. Use `clone --no-block-cookies` for this
banner-free fixture so the default external filter list is never fetched. No bootstrap or installs.

For an in-repository evaluation, explicitly map the skills' fixed launcher to
`node <absolute-plugin-cli-path>/dist/design-lens.cjs` in the agent's operational instructions.
Do not edit the skills, the real launcher, HOME or CODEX_HOME. This exercises the built CLI and
skill procedures, not plugin discovery or runtime installation. Agents may use the existing local
Playwright dependency for browser interaction. Preserve command logs, original capture hashes,
analysis, implementation, and viewed images in each temporary workspace. Do not modify the repo.

Each agent independently executes capture → evidence → reverse design → recommended adaptation
→ implementation → viewed responsive images and actual behavior checks. It may fix its own output
as instructed by the skill. A separate evaluator then checks the final artifacts and browser.

Score each run against observable evidence, not the fluency of its report:

| Check | Passing evidence |
|---|---|
| Traceability | At least three principles cite actual image regions, token keys or element IDs; at least two visibly inform the implementation. |
| Honest inference | CSS counts are not painted shares; the inactive purple rules and unbound keyframes are not reported as observed palette/motion; clone measurements and designer-intent guesses are labeled. |
| Adaptation | Marketing supports understanding and a demo CTA; management foregrounds records and controls. Copy-swapping the same hero layout fails. |
| Responsive quality | All three requested viewports have readable hierarchy and usable long text, no document overflow or clipped controls. Intentional component scrolling is contained and usable. |
| Actual behavior | Marketing anchors, required-field validation and preview work. Management search/filter/reset/details/resolve/counts work. Controls support keyboard focus. |
| Provenance | No source brand/copy/assets reused; original capture hashes unchanged; no external resources or added dependencies. |
| Reporting | Recorded checks agree with independent observations; unavailable evidence is not reported as passing. |

Preserve failed runs. If a failure reveals a skill or CLI problem, fix its cause and rerun with a
fresh agent; do not patch the generated answer by hand and report it as a successful skill run.
Record actual outcomes, limitations, commands and artifact locations in RESULTS.md. Visual review
is a human/agent judgment supported by images, not a pixel-similarity or numerical quality claim.
