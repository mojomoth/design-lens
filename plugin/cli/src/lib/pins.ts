/**
 * Load-bearing version pins the runtime records but does not resolve from disk.
 *
 * `PLAYWRIGHT_PIN` is written into `manifest.tool.playwright` (spec 03 schema; ADR-008 makes the
 * pin the provenance of the render engine). It is hard-coded rather than read from a package.json
 * at runtime because the committed CJS bundle ships without `playwright` in scope (it is external),
 * so there is no reliable in-bundle path to `playwright/package.json`. It MUST stay in lockstep with
 * `plugin/cli/package.json`'s `playwright` dependency, `plugin/scripts/bootstrap.sh`, and
 * `PLAYWRIGHT_VERSION` in `.harness/config.env` (the config.env comment names the same three files).
 */
export const PLAYWRIGHT_PIN = '1.61.1';
