/**
 * The `tokens <projectDir>` command — distill a clone's captured CSS into `tokens.json`.
 *
 * This module owns ONLY I/O and sequencing: which files to read (analyze/css-sources), what to
 * derive from them (analyze/tokens), and where to put the answer. It never touches the network or
 * a browser — `tokens` runs entirely on the bytes `clone` already wrote (spec 05).
 *
 * I/O discipline (guardrails / spec 05): human progress and warnings → stderr; the tokens JSON goes
 * to `<projectDir>/tokens.json` always, and to stdout only under `--stdout`. A missing manifest CSS
 * file is a warning and the run still exits 0; only a project that is not a clone at all (no
 * `clone/index.html`, no `manifest.json`) is fatal.
 *
 * Spec: specs/05-element-inventory.md §tokens.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { Command } from 'commander';

import { inlineCssSources, selectManifestCssPaths } from '../analyze/css-sources.js';
import { extractTokens, type Tokens, type TokenSource } from '../analyze/tokens.js';

export interface TokensResult {
  /** Absolute path of the written `tokens.json`. */
  tokensPath: string;
  /** The document as written: 2-space pretty-printed, trailing newline. */
  json: string;
  tokens: Tokens;
  warnings: string[];
}

/**
 * Read a clone project's CSS, extract its design tokens, write `<projectDir>/tokens.json`.
 *
 * Throws (⇒ exit 1) only when `projectDir` is not a clone project or its manifest is unreadable.
 * Returns the document rather than printing it, so the caller owns the stdout contract.
 */
export function runTokens(projectDir: string): TokensResult {
  const root = path.resolve(projectDir);
  const indexPath = path.join(root, 'clone', 'index.html');
  const manifestPath = path.join(root, 'manifest.json');

  for (const required of [indexPath, manifestPath]) {
    if (!fs.existsSync(required)) {
      throw new Error(`not a design-lens clone project: missing ${required}`);
    }
  }

  // A manifest that exists but does not parse is indistinguishable from a missing one for our
  // purposes — there is no resource list to analyze. Let the SyntaxError travel to exit 1.
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const selection = selectManifestCssPaths(manifest);
  const warnings = [...selection.warnings];

  const sources: string[] = [];
  const provenance: TokenSource[] = [];
  const addSource = (sourcePath: string, kind: TokenSource['kind'], css: string): void => {
    sources.push(css);
    provenance.push({ path: sourcePath, kind, sha256: createHash('sha256').update(css).digest('hex') });
  };
  for (const localPath of selection.paths) {
    const assetPath = path.join(root, localPath);
    if (!fs.existsSync(assetPath)) {
      warnings.push(`manifest CSS missing on disk, skipped: ${localPath}`);
      continue;
    }
    addSource(localPath, 'stylesheet', fs.readFileSync(assetPath, 'utf8'));
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  // Stylesheet order first, then markup declaration order; every source has its own content hash.
  for (const source of inlineCssSources(html)) addSource(source.path, source.kind, source.css);
  process.stderr.write(`design-lens: analyzing ${sources.length} CSS source(s) in ${root}\n`);

  const extraction = extractTokens(sources.join('\n'), { sources: provenance, warnings });
  warnings.push(...extraction.warnings);

  const json = `${JSON.stringify(extraction.tokens, null, 2)}\n`;
  const tokensPath = path.join(root, 'tokens.json');
  fs.writeFileSync(tokensPath, json, 'utf8');

  for (const warning of warnings) process.stderr.write(`design-lens: warning: ${warning}\n`);
  process.stderr.write(
    `design-lens: wrote ${tokensPath} ` +
      `(${extraction.tokens.colors.length} color cluster(s), ` +
      `${extraction.tokens.typography.families.length} font famil(ies), ` +
      `${warnings.length} warning(s))\n`,
  );

  return { tokensPath, json, tokens: extraction.tokens, warnings };
}

export function registerTokensCommand(program: Command): void {
  program
    .command('tokens')
    .argument('<projectDir>', 'a clone project directory, e.g. .design-lens/example-com')
    .description("Distill the clone's captured CSS into <projectDir>/tokens.json.")
    .option('--stdout', 'also print the tokens JSON to stdout')
    .action((projectDir: string, options: { stdout?: boolean }): void => {
      try {
        const result = runTokens(projectDir);
        if (options.stdout === true) process.stdout.write(result.json);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${detail}\n`);
        process.exitCode = 1;
      }
    });
}
