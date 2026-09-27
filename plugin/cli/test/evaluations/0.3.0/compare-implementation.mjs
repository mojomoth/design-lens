// Independent document-usability check. The implementer must not see source evidence.
// node compare-implementation.mjs <source-project> <implementation-app> <review-output>
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const [sourceDir, appDir, outputDir] = process.argv.slice(2).map(value => resolve(value));
if (!sourceDir || !appDir || !outputDir) throw new Error('Expected source project, app and review directories');
const evidence = JSON.parse(await readFile(resolve(sourceDir, 'evidence.json'), 'utf8'));
await mkdir(outputDir, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const path = resolve(appDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(appDir + sep)) throw new Error('Invalid path');
    res.setHeader('content-type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const properties = [
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color',
  'backgroundColor', 'display', 'position', 'boxSizing', 'flexDirection', 'alignItems',
  'justifyContent', 'rowGap', 'columnGap', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderBottomWidth', 'borderTopStyle', 'borderBottomStyle',
  'borderTopColor', 'borderBottomColor', 'borderCollapse', 'textAlign',
];
const results = [];
try {
  for (const capture of evidence.captures) {
    const context = await browser.newContext({ viewport: capture.viewport, deviceScaleFactor: 1,
      colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const external = [], errors = [];
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || /^(?:data|blob):/.test(url)) await route.continue();
      else { external.push(url); await route.abort(); }
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const observations = [capture.observations.body, ...capture.observations.elements]
      .filter(item => item && item.tag !== 'img');
    const measured = await page.evaluate(({ observations, properties }) => {
      const elements = observations.map(item => {
        const el = item.tag === 'body' ? document.body : document.querySelector(item.domPath);
        if (!el) return null;
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: Object.fromEntries(properties.map(key => [key, style[key]])) };
      });
      return { elements, overflow: document.documentElement.scrollWidth > innerWidth,
        fonts: document.fonts.status, logo: document.querySelector('.logo')?.getBoundingClientRect().toJSON() };
    }, { observations, properties });
    const checks = [];
    function check(name, expected, actual, pass) { checks.push({ name, expected, actual, pass }); }
    observations.forEach((expected, i) => {
      const actual = measured.elements[i], label = expected.dlId || 'body';
      check(`${label}.exists`, true, Boolean(actual), Boolean(actual));
      if (!actual) return;
      for (const key of ['x', 'y', 'width', 'height']) {
        check(`${label}.rect.${key}`, expected.rect[key], actual.rect[key], Math.abs(expected.rect[key] - actual.rect[key]) <= 1);
      }
      for (const key of properties) {
        if (expected.styles[key] !== undefined) check(`${label}.styles.${key}`,
          expected.styles[key], actual.styles[key], expected.styles[key] === actual.styles[key]);
      }
    });
    const logo = capture.observations.elements.find(item => item.tag === 'img');
    if (logo) for (const key of ['x', 'y', 'width', 'height']) check(`logo.rect.${key}`,
      logo.rect[key], measured.logo?.[key], Math.abs(logo.rect[key] - measured.logo?.[key]) <= 1);
    check('document.overflow', false, measured.overflow, !measured.overflow);
    check('fonts.status', 'loaded', measured.fonts, measured.fonts === 'loaded');
    check('network.external', [], external, external.length === 0);
    check('browser.errors', [], errors, errors.length === 0);
    await page.screenshot({ path: resolve(outputDir, `implementation-${capture.viewport.width}-full.png`), fullPage: true });
    results.push({ viewport: capture.viewport, passed: checks.filter(item => item.pass).length,
      total: checks.length, failures: checks.filter(item => !item.pass), checks });
    await context.close();
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
await writeFile(resolve(outputDir, 'implementation-comparison.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ viewport, passed, total, failures }) => ({ viewport, passed, total, failures })), null, 2));
process.exitCode = results.every(result => result.passed === result.total) ? 0 : 1;
