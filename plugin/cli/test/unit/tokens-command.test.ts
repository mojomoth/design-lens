import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runTokens } from '../../src/commands/tokens.js';

describe('tokens command source provenance', () => {
  // Why: source hashes and inline declarations must survive command I/O, while user override CSS stays excluded.
  it('writes schema 2 with hashed clone sources, inline census, assumptions and missing-file diagnostics', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-token-sources-'));
    try {
      fs.mkdirSync(path.join(root, 'clone/assets'), { recursive: true });
      const css = 'h1{font:600 24px Display;color:rgb(51 71 255 / 0.5)}';
      fs.writeFileSync(path.join(root, 'clone/assets/site.css'), css);
      fs.writeFileSync(path.join(root, 'clone/assets/dl-overrides.css'), '.x{color:#00ff88}');
      fs.writeFileSync(path.join(root, 'clone/index.html'), '<body style="padding:1rem">' +
        '<style>p{line-height:1.5}</style><h1 style="margin:calc(100% - 10px)">Heading</h1></body>');
      fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ resources: [
        { localPath: 'clone/assets/site.css', contentType: 'text/css' },
        { localPath: 'clone/assets/dl-overrides.css', contentType: 'text/css' },
        { localPath: 'clone/assets/missing.css', contentType: 'text/css' },
      ] }));
      const result = runTokens(root);
      expect(result.tokens.schemaVersion).toBe(2);
      expect(result.tokens.spacing.base).toBe(8);
      expect(result.tokens.provenance.sources.map((source) => source.kind)).toEqual([
        'stylesheet', 'style-attribute', 'style-block', 'style-attribute',
      ]);
      expect(result.tokens.provenance.sources[0]).toEqual({
        path: 'clone/assets/site.css', kind: 'stylesheet', sha256: createHash('sha256').update(css).digest('hex'),
      });
      expect(result.tokens.provenance.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
      expect(result.tokens.provenance.assumptions).toHaveLength(1);
      expect(result.tokens.provenance.unresolved[0]).toMatchObject({ property: 'margin', value: 'calc(100% - 10px)' });
      expect(result.tokens.provenance.warnings).toEqual(['manifest CSS missing on disk, skipped: clone/assets/missing.css']);
      expect(result.warnings).toEqual(result.tokens.provenance.warnings);
      expect(result.json).not.toContain('00ff88');
      expect(fs.readFileSync(result.tokensPath, 'utf8')).toBe(result.json);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
