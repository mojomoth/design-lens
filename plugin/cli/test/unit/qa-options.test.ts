import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newQaRunId, resolveQaOptions } from '../../src/analyze/qa-run.js';

let root: string;
let build: string;
let project: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-qa-options-'));
  build = path.join(root, 'build');
  project = path.join(root, 'project');
  await fs.mkdir(build);
  await fs.writeFile(path.join(build, 'index.html'), '<!doctype html><h1>Build</h1>');
  await fs.mkdir(path.join(project, 'clone'), { recursive: true });
  await fs.writeFile(path.join(project, 'clone', 'index.html'), '<!doctype html><h1 data-dl-id="dl-1">Clone</h1>');
  await fs.writeFile(path.join(root, 'facts.json'), JSON.stringify({ graduates: '2,096 명' }));
  await fs.writeFile(path.join(root, 'broken.json'), '{');
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('qa options', () => {
  // why: every flag is validated before a server or Chromium starts, so typos cost nothing.
  it('rejects invalid flag combinations before any browser work', async () => {
    const reject = (raw: Parameters<typeof resolveQaOptions>[0]) => expect(resolveQaOptions(raw, root)).rejects.toThrow();
    await reject({});
    await reject({ url: 'http://127.0.0.1:1/', dir: build });
    await reject({ url: 'file:///etc/passwd' });
    await reject({ dir: root });
    await reject({ dir: build, project: root });
    await reject({ dir: build, mode: 'derive' });
    await reject({ dir: build, project, mode: 'copy' });
    await reject({ dir: build, maxClicks: '201' });
    await reject({ dir: build, maxClicks: '-1' });
    await reject({ dir: build, timeout: '0' });
    await reject({ dir: build, viewports: '390x844,390x844' });
    await reject({ dir: build, content: ['missing.md'] });
    await reject({ dir: build, content: ['broken.json'] });
    await reject({ dir: build, brand: [' '] });
    await reject({ dir: build, out: build });
  });

  // why: defaults are part of the command contract (viewports, 40 clicks, 300 s, run id under .design-lens/qa).
  it('applies defaults without --project', async () => {
    const options = await resolveQaOptions({ dir: 'build', content: ['facts.json'] }, root, 1_700_000_000_000);
    expect(options.viewports).toEqual([{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]);
    expect(options).toMatchObject({ target: { kind: 'dir', dir: build }, project: null, mode: null, maxClicks: 40, timeoutMs: 300_000 });
    expect(path.relative(root, options.out)).toMatch(/^\.design-lens\/qa\/qa-1700000000000-[0-9a-f]{8}$/);
    expect(options.content[0].texts).toEqual(['2,096 명']);
    expect(newQaRunId(5)).toMatch(/^qa-5-[0-9a-f]{8}$/);
  });

  // why: with --project the run lands in <project>/qa, viewports come from evidence and the mode from the contract.
  it('derives viewports, mode and output from the project', async () => {
    await fs.writeFile(path.join(project, 'evidence.json'), JSON.stringify({ schemaVersion: 1, captures: [
      { id: 'desktop', viewport: { width: 1280, height: 800 }, observations: { elements: [] }, files: [], fullScreenshot: '' },
      { id: 'mobile', viewport: { width: 375, height: 812 }, observations: { elements: [] }, files: [], fullScreenshot: '' },
    ] }));
    await fs.writeFile(path.join(project, 'VARIATIONS.md'), [
      '## Selected direction', '### Build contract', '| Contract | Value | Source |', '| --- | --- | --- |',
      '| mode | clone-base | User: "build on the clone" |', '| fonts | Inter | substitutes |', '| display-fonts | Inter | substitutes |',
      '| dark-share-max | 0.1 | tone |', '| full-bleed-dark-max | 0.02 | tone |', '| stylesheets | retained | clone-base |', '',
    ].join('\n'));
    const options = await resolveQaOptions({ dir: build, project: 'project' }, root);
    expect(options.viewports).toEqual([{ width: 1280, height: 800 }, { width: 375, height: 812 }]);
    expect(options.mode).toBe('clone-base');
    expect(options.contract?.contract?.stylesheets).toBe('retained');
    expect(path.dirname(options.out)).toBe(path.join(project, 'qa'));
    const overridden = await resolveQaOptions({ dir: build, project, mode: 'derive' }, root);
    expect(overridden.mode).toBe('derive');
    expect(overridden.issues).toContain('--mode derive overrides the Build contract mode clone-base');
  });
});
