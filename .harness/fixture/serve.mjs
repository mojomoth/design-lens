#!/usr/bin/env node
// Sealed fixture server. Main port serves the fixture site; alt port serves thirdparty/ as a
// fake CDN (cross-origin font localization test). The path /slow.css is delayed 800 ms to
// exercise the clone engine's load/settle discipline.
// Usage: node serve.mjs [--port N] [--alt-port N] [--check]
//   --check: boot both ports, self-fetch every file, exit 0/1.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PORT = Number(flag("--port", 4630));
const ALT_PORT = Number(flag("--alt-port", 4631));
const CHECK = args.includes("--check");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function serveDir(root) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = join(root, path);
      if (relative(root, file).split(sep)[0] === "..") throw new Error("traversal");
      const body = await readFile(file);
      if (path === "/slow.css") await new Promise((r) => setTimeout(r, 800));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  };
}

async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out;
}

const main = createServer(serveDir(ROOT));
const alt = createServer(serveDir(join(ROOT, "thirdparty")));
await new Promise((r) => main.listen(PORT, "127.0.0.1", r));
await new Promise((r) => alt.listen(ALT_PORT, "127.0.0.1", r));
console.error(`fixture: http://127.0.0.1:${PORT}/  (cdn: http://127.0.0.1:${ALT_PORT}/)`);

if (CHECK) {
  let fail = 0;
  const files = (await listFiles(ROOT)).filter((f) => !f.endsWith("serve.mjs"));
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join("/");
    const url = rel.startsWith("thirdparty/")
      ? `http://127.0.0.1:${ALT_PORT}/${rel.slice("thirdparty/".length)}`
      : `http://127.0.0.1:${PORT}/${rel}`;
    const r = await fetch(url).catch(() => null);
    if (!r || r.status !== 200) {
      console.error(`CHECK FAIL ${url}`);
      fail = 1;
    } else {
      console.error(`CHECK ok   ${url}`);
    }
  }
  main.close();
  alt.close();
  process.exit(fail);
}
