import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Reproducibility and no-drift invariants for the two COMMITTED build artifacts named by spec
 * 01-packaging: `plugin/cli/dist/design-lens.cjs` and `plugin/cli/package-lock.json`.
 *
 * Why these need a unit test at all — the sealed gate's coverage of them is thinner than it looks:
 *
 *   - S5 (`verify.sh`) rebuilds and runs `git diff --quiet -- dist`. That fires only under
 *     `--strict`, i.e. once at completion, and it can only tell you the bytes CHANGED — never that
 *     the config grew a timestamp or an absolute path that happens to be stable on this one
 *     machine. AC-11 ("the tsup config MUST be deterministic — no timestamps, no
 *     environment-dependent banners") is a property of the CONFIG, and nothing asserted it.
 *   - B5 installs deps with `npm ci --no-audit --no-fund || npm install --no-audit --no-fund`.
 *     The fallback means a `package-lock.json` that `npm ci` REJECTS (out of sync with
 *     package.json) silently falls through to `npm install`, which rewrites the lockfile in the
 *     worktree — and no later check looks at it, because S5's `git diff` is scoped to `dist` only.
 *     So the lockfile half of spec 01 ("`npm ci` MUST succeed there from a clean checkout") had
 *     zero enforcement. These tests are that enforcement, and they run every iteration.
 *
 * The pin tests close the last leg of a lockstep that `src/lib/pins.ts` documents but nothing
 * checked: `bootstrap.test.ts` already ties bootstrap.sh's literals to package.json, leaving
 * `PLAYWRIGHT_PIN` (which is stamped into `manifest.tool.playwright`) free to drift.
 */

// Repo root, four levels up from test/unit/ (plugin/cli/test/unit → plugin/cli → plugin → repo).
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const CLI = path.join(REPO, 'plugin/cli');

const BUNDLE = path.join(CLI, 'dist/design-lens.cjs');
const TSUP_CONFIG = path.join(CLI, 'tsup.config.ts');
const PKG = path.join(CLI, 'package.json');
const LOCK = path.join(CLI, 'package-lock.json');
const PINS = path.join(CLI, 'src/lib/pins.ts');
const CONFIG_ENV = path.join(REPO, '.harness/config.env');
const GITIGNORE = path.join(REPO, '.gitignore');

/** The repo-hygiene ceiling enforced by the sealed gate's B2c (`> 2097152` bytes fails). */
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

/** Kept `external` by tsup so the CJS bundle stays small; bootstrap.sh installs them at runtime. */
const EXTERNALS = ['playwright', 'playwright-core', '@ghostery/adblocker-playwright'];

interface Manifest {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
}

interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: number;
  packages: Record<string, Partial<Manifest> & LockEntry>;
}

const read = (file: string): string => readFileSync(file, 'utf8');
const pkg = (): Manifest => JSON.parse(read(PKG)) as Manifest;
const lock = (): Lockfile => JSON.parse(read(LOCK)) as Lockfile;

describe('reproducible bundle (dist/design-lens.cjs)', () => {
  // why: AC-11's determinism clause lives in tsup.config.ts, where no typechecker and no e2e can
  // see it. A `banner` stamping a build date, or `sourcemap: true` (whose output embeds absolute
  // sourcesContent paths), makes `npm run build` emit different bytes on every machine — turning
  // S5 into a permanent red that looks like "someone forgot to commit dist" rather than the config
  // bug it is. Each token below has broken a real build system; this test is the only thing
  // standing between them and the committed artifact.
  it('builds from a config with no timestamp, banner, or sourcemap', () => {
    const config = read(TSUP_CONFIG);
    // Strip comments: the config's prose legitimately discusses "no timestamps" and "banners".
    const code = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code, 'tsup config must not emit sourcemaps (they embed absolute paths)').toContain('sourcemap: false');
    expect(code, 'esbuild minification is deterministic; keep it explicit').toContain('minify: true');
    for (const token of ['banner', 'footer', 'Date.now', 'new Date', 'Math.random', '[hash]']) {
      expect(code, `tsup config must stay deterministic — found \`${token}\``).not.toContain(token);
    }
  });

  // why: these three packages are `external` precisely so the bundle stays under B2c's 2 MB gate
  // (cheerio+undici alone was 1.0 MB). Dropping one from `external` inlines a browser driver into
  // dist/ and blows the ceiling; ADDING one silently strips a dependency the bundle needs. Neither
  // failure is visible until the gate or a user's install breaks.
  it('keeps exactly the three runtime-external packages out of the bundle', () => {
    const code = read(TSUP_CONFIG).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const declared = /external:\s*\[([^\]]*)\]/.exec(code);
    expect(declared, 'tsup.config.ts must declare an `external` array').not.toBeNull();

    const names = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...EXTERNALS].sort());
  });

  // why: the bundle is a COMMITTED artifact, so anything machine-specific baked into it becomes a
  // permanent diff for the next contributor and leaks the builder's home directory to every user
  // who installs the plugin. `sourceMappingURL` would additionally point at a file that is never
  // shipped. These three greps are cheap; the failure they catch is embarrassing and irreversible
  // once released.
  it('ships no absolute path, sourcemap reference, or embedded build timestamp', () => {
    expect(existsSync(BUNDLE), 'dist/design-lens.cjs must be committed').toBe(true);
    const bundle = read(BUNDLE);

    expect(bundle, 'bundle must not embed the builder home directory').not.toContain('/Users/');
    expect(bundle, 'bundle must not embed a build-machine path').not.toContain(REPO);
    expect(bundle, 'sourcemap: false means no sourceMappingURL comment').not.toContain('sourceMappingURL');
    expect(bundle, 'no build timestamp may be baked in').not.toMatch(/20\d{2}-\d{2}-\d{2}T\d{2}:/);
  });

  // why: B2c fails the gate on any tracked file > 2 MiB, and the bundle is the only file in the
  // repo that grows on its own — one careless `import` of a fat package (undici, iconv-lite) adds
  // half a megabyte. Failing here names the cause; failing at B2c just says "files >2MB".
  it('stays under the 2 MiB repo-hygiene ceiling', () => {
    const bytes = statSync(BUNDLE).size;
    expect(bytes, 'bundle must be non-empty').toBeGreaterThan(1024);
    expect(bytes, `bundle is ${bytes} bytes, ceiling is ${MAX_BUNDLE_BYTES} (gate B2c)`).toBeLessThan(MAX_BUNDLE_BYTES);
  });
});

describe('lockfile integrity (package-lock.json)', () => {
  // why: spec 01 requires `npm ci` to succeed from a clean checkout. `npm ci` hard-refuses a
  // lockfileVersion it cannot read and refuses a lock whose root entry disagrees with
  // package.json's name/version. The gate's `npm ci || npm install` fallback would mask exactly
  // that failure by regenerating the lock instead of reporting it.
  it('is a v3 lockfile that identifies this package', () => {
    const l = lock();
    const p = pkg();
    expect(l.lockfileVersion, 'npm ci in CI expects lockfileVersion 3').toBe(3);
    expect(l.name).toBe(p.name);
    expect(l.version).toBe(p.version);
  });

  // why: THE guard for T29's lockfile half. `npm ci` aborts when the lock's root entry does not
  // mirror package.json's dependency ranges — but B5 catches that abort and runs `npm install`,
  // which rewrites package-lock.json in place and exits 0. The drift then rides into the next
  // commit unnoticed, and the "reproducible" build silently resolves different dependency versions
  // (tsup/esbuild float on carets, and minified output is NOT stable across esbuild minors).
  // Deleting this test re-opens a hole nothing else in the repo covers.
  it('root entry mirrors package.json dependencies and devDependencies exactly', () => {
    const p = pkg();
    const root = lock().packages[''];
    expect(root, "lock must carry a root ('') entry").toBeDefined();
    expect(root.dependencies, 'lock root dependencies must equal package.json').toEqual(p.dependencies);
    expect(root.devDependencies, 'lock root devDependencies must equal package.json').toEqual(p.devDependencies);
  });

  // why: a lock entry stripped of `resolved`/`integrity` (hand-edited, or produced by an old npm
  // against a private registry) still parses and still satisfies the mirror test above, but makes
  // `npm ci` either fail or install UNVERIFIED tarballs. Since the bundle inlines these packages'
  // source, an unverified tarball is a supply-chain hole in a redistributed artifact.
  it('pins every declared dependency to a resolved, integrity-checked tarball', () => {
    const p = pkg();
    const packages = lock().packages;
    const missing: string[] = [];

    for (const name of Object.keys({ ...p.dependencies, ...p.devDependencies })) {
      const entry = packages[`node_modules/${name}`];
      if (!entry?.version || !entry.resolved || !entry.integrity) missing.push(name);
    }
    expect(missing, 'every dependency needs version+resolved+integrity in the lock').toEqual([]);
  });
});

describe('version pin lockstep', () => {
  // why: `PLAYWRIGHT_PIN` is stamped into every clone's `manifest.tool.playwright` as the
  // provenance of the render engine (ADR-008). It is hard-coded because the CJS bundle ships
  // without playwright in scope, so nothing resolves it from disk — and therefore nothing NOTICES
  // when a `playwright` bump in package.json leaves it behind. bootstrap.test.ts already ties
  // bootstrap.sh's literal to package.json; this is the one remaining leg of the four-way lockstep
  // that pins.ts's own docstring promises. Without it, every manifest records a version the
  // capture did not use.
  it('src/lib/pins.ts PLAYWRIGHT_PIN equals the package.json playwright pin', () => {
    const want = pkg().dependencies['playwright'];
    expect(want, 'playwright must be an exact (non-range) dependency').toMatch(/^\d+\.\d+\.\d+$/);
    expect(read(PINS), `PLAYWRIGHT_PIN must be '${want}'`).toContain(`export const PLAYWRIGHT_PIN = '${want}';`);
  });

  // why: the sealed harness provisions Chromium at `PLAYWRIGHT_VERSION` from config.env, while the
  // bundle is compiled against package.json's playwright. When those disagree, Playwright reports
  // "Executable doesn't exist" — and guardrails.md explicitly warns the agent NOT to fix that by
  // downloading a browser, but by fixing the pin mismatch. This test finds the mismatch in the
  // fast unit suite instead of halfway through a browser e2e.
  it('.harness/config.env PLAYWRIGHT_VERSION equals the package.json playwright pin', () => {
    const want = pkg().dependencies['playwright'];
    const found = /^PLAYWRIGHT_VERSION=(\S+)/m.exec(read(CONFIG_ENV));
    expect(found, 'config.env must declare PLAYWRIGHT_VERSION').not.toBeNull();
    expect(found?.[1], `config.env pins Playwright; package.json says ${want}`).toBe(want);
  });
});

describe('repo hygiene (.gitignore)', () => {
  // why: spec 01 §Repo layout names these three paths as MUST-ignore and `plugin/cli/dist/` as
  // MUST-NOT-ignore, and no gate check reads .gitignore at all. Ignoring dist/ would drop the
  // committed bundle from the repo — S5 and B10 would then "pass" against a stale artifact that a
  // fresh clone does not even contain. Conversely, an unignored `test-output/` lets a stray test
  // artifact get committed and rot.
  it('ignores the spec-mandated paths and never ignores the committed bundle', () => {
    const lines = read(GITIGNORE)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    for (const required of ['node_modules/', '.design-lens/', 'test-output/']) {
      expect(lines, `spec 01 requires .gitignore to ignore ${required}`).toContain(required);
    }
    const ignoresDist = lines.some((line) => /(^|\/)dist\/?$/.test(line.replace(/^!/, '')));
    expect(ignoresDist, '.gitignore must NOT ignore plugin/cli/dist/ (the bundle is committed)').toBe(false);
  });
});
