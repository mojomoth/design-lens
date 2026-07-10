# NOTICE

Design Lens is © the Design Lens contributors and is licensed under the **MIT License**.

This file enumerates the third-party software Design Lens redistributes or installs, as required
by ADR-005 (license policy). Only MIT / Apache-2.0 / BSD / ISC / CC0 licensed code is bundled;
MPL-2.0 code is permitted only as an external, separately-installed dependency. **AGPL code is
never vendored, imported, or linked** — notably `single-file-cli`, which is why Design Lens
implements its own serializer instead of reusing it.

---

## 1. Bundled into `cli/dist/design-lens.cjs`

These packages are compiled into the shipped single-file CJS bundle and are therefore
**redistributed** with Design Lens. Their license texts ship inside each package in
`node_modules/<name>/LICENSE`.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| `@percy/dom` | 1.32.3 | MIT | Percy / BrowserStack |
| `@projectwallace/css-analyzer` | 9.9.0 | MIT | Bart Veneman |
| `@projectwallace/css-parser` | 0.16.2 | MIT | Bart Veneman |
| `boolbase` | 1.0.0 | ISC | Felix Böhm |
| `cheerio` | 1.2.0 | MIT | 2022 The Cheerio contributors |
| `cheerio-select` | 2.1.0 | BSD-2-Clause | Felix Böhm |
| `commander` | 12.1.0 | MIT | 2011 TJ Holowaychuk |
| `css-select` | 5.2.2 | BSD-2-Clause | Felix Böhm |
| `css-tree` | 3.2.1 | MIT | 2016-2026 Roman Dvornov |
| `css-what` | 6.2.2 | BSD-2-Clause | Felix Böhm |
| `culori` | 4.0.2 | MIT | 2018 Dan Burzo |
| `dom-serializer` | 2.0.0 | MIT | 2014 The cheeriojs contributors |
| `domelementtype` | 2.3.0 | BSD-2-Clause | Felix Böhm |
| `domhandler` | 5.0.3 | BSD-2-Clause | Felix Böhm |
| `domutils` | 3.2.2 | BSD-2-Clause | Felix Böhm |
| `entities` | 4.5.0 | BSD-2-Clause | Felix Böhm |
| `htmlparser2` | 10.1.0 | MIT | 2010-2011 Chris Winberry |
| `js-beautify` | 2.0.3 | MIT | 2007-2018 Einar Lielmanis, Liam Newman, and contributors |
| `mdn-data` | 2.27.1 | CC0-1.0 | MDN contributors (public domain dedication) |
| `nth-check` | 2.1.1 | BSD-2-Clause | Felix Böhm |
| `parse5` | 7.3.0 | MIT | 2013-2019 Ivan Nikulin |
| `parse5-htmlparser2-tree-adapter` | 7.1.0 | MIT | 2013-2019 Ivan Nikulin |
| `source-map-js` | 1.2.1 | BSD-3-Clause | 2009-2011 Mozilla Foundation and contributors |

### A note on `@percy/dom`

`@percy/dom` is the browser-side DOM serializer. It cannot be `require()`d from inside the
single-file bundle (a runtime `require.resolve('@percy/dom')` has nothing to resolve against), so
its `dist/bundle.js` is embedded verbatim as a gzip+base64 string in
`cli/src/capture/percy-dom-src.ts` and injected into the page under capture. It is **vendored
source, redistributed under MIT** — the same obligation as any other bundled package, listed here
for that reason even though it does not appear as a module import.

---

## 2. Installed at runtime into `~/.design-lens/runtime/` (NOT bundled)

`scripts/bootstrap.sh` installs these from the public npm registry onto the user's machine. They
are deliberately kept **external** to the bundle: `playwright` needs its own browser binaries, and
`@ghostery/adblocker-playwright` is MPL-2.0, which ADR-005 permits only as a separate,
unmodified, separately-installed artifact. Design Lens neither modifies nor redistributes them.

| Package | Version | License |
| --- | --- | --- |
| `playwright` | 1.61.1 | Apache-2.0 |
| `playwright-core` | 1.61.1 | Apache-2.0 |
| `@ghostery/adblocker-playwright` | 2.18.1 | MPL-2.0 |
| `@ghostery/adblocker` | 2.18.1 | MPL-2.0 |
| `@ghostery/adblocker-content` | 2.18.1 | MPL-2.0 |
| `@ghostery/adblocker-extended-selectors` | 2.18.1 | MPL-2.0 |
| `@ghostery/url-parser` | 1.3.1 | MPL-2.0 |
| `@remusao/guess-url-type` | 2.1.0 | MPL-2.0 |
| `@remusao/small` | 2.1.0 | MPL-2.0 |
| `@remusao/smaz` | 2.2.0 | MPL-2.0 |
| `@remusao/smaz-compress` | 2.2.0 | MPL-2.0 |
| `@remusao/smaz-decompress` | 2.2.0 | MPL-2.0 |
| `@remusao/trie` | 2.1.0 | MPL-2.0 |
| `tldts-core` | 7.4.7 | MIT |
| `tldts-experimental` | 7.4.7 | MIT |

Chromium is downloaded by `playwright install chromium` and is governed by
[Chromium's own licenses](https://chromium.googlesource.com/chromium/src/+/main/LICENSE)
(BSD-3-Clause and others). Design Lens does not redistribute it.

The MPL-2.0 obligation is source availability for the MPL-licensed files themselves: the
unmodified `@ghostery/*` and `@remusao/*` sources live in `~/.design-lens/runtime/node_modules/`
on the user's machine and upstream at <https://github.com/ghostery/adblocker>.

---

## 3. Content captured by `clone`

Pages, images, fonts, and text captured by `design-lens clone` are **not covered by this notice**
and are **not licensed to you by Design Lens**. They remain the property of their owners. Each
clone carries its own `REPORT.md` with a `## License & usage notice` section and a full
`manifest.json` source-URL mapping. See `## Fair use & respect for designers` in `README.md`.
