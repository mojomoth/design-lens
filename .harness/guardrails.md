# guardrails.md — tunable Signs (loaded by every iteration)

The human edits this file between runs when the agent misbehaves ("tuned like a guitar"), then
re-runs `./.harness/bootstrap.sh` to re-seal the harness. Every sign below is a hard rule.

## Signs

- Search before building; never assume a thing is unimplemented because one search missed it
  (this is the classic Ralph failure mode — duplicated implementations).
- ONE task per iteration. If the repo starts going off the rails, the human will narrow scope here.
- The sealed fixture (`.harness/fixture/`, ports 4630/4631) is the harness's e2e target — read it,
  never edit it. The plugin's OWN test fixtures live at `plugin/cli/test/fixtures/sites/` and are
  served on EPHEMERAL ports (--port 0). Tests never touch the live web.
- Never install packages outside the `CONVENTIONS.md` allowlist; a new dependency requires an ADR
  first. AGPL packages are forbidden entirely (notably single-file-cli).
- Never run `playwright install` yourself; bootstrap already provisioned Chromium at the pinned
  version (see PLAYWRIGHT_VERSION in `.harness/config.env`; browser cache:
  `$PLAYWRIGHT_BROWSERS_PATH`, default `~/Library/Caches/ms-playwright`). If Playwright reports
  "Executable doesn't exist", the version in package.json has drifted from the pin — fix the pin
  mismatch, do not download a new browser.
- Skills must stay argument-free: no `$ARGUMENTS`, `$<digit>`, backtick-command interpolation, or
  `{{…}}` in any SKILL.md (they break Codex). Skill bodies reference only
  `~/.design-lens/bin/design-lens`, never `${CLAUDE_PLUGIN_ROOT}`.
- Keep the customization layer thin: inventory to stdout only, edits via `data-dl-id` anchors and
  `dl-overrides.css`; NO persistent manifest files, NO op-layer edit scripts (ADR-002).
- The clone output is inert by design: no `<script>`, no `on*` attributes ("a photograph, not a
  program"). Do not "improve" it with interactivity.
- Do not "improve" this prompt or the harness; suggestions go into PROGRESS.md for the human.
- When a Playwright/browser step behaves oddly, log the exact error + versions to PROGRESS.md
  BEFORE retrying, so the next iteration doesn't repeat the same blind retry.
- CLI I/O contract: human progress → stderr, machine JSON → stdout. Tests rely on this.
- `--timeout` flags on the CLI are SECONDS for the whole operation; convert to ms where
  Playwright APIs expect ms.

## Human-added signs (append below during/between runs)
