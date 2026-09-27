// The response headers netlify.toml sets for every path — read out of the
// toml itself, so the check (tests/csp.test.ts) and the local server below
// can never drift from what Netlify serves.
//
//   node scripts/csp-headers.mjs serve [dir=dist] [port=4178]
//
// serves a production build with those headers applied, for checking the app
// in a real browser with the Content-Security-Policy on (security review
// 2026-09-28). A request for a path with no file falls back to index.html,
// as the app is one page.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Header name → value from the `[[headers]] for = "/*"` block(s) of netlify.toml. */
export function globalHeaders(toml) {
  const out = {};
  const blocks = toml.split(/^\[\[headers\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^\[\[(?!headers\]\])/m)[0];
    const forLine = /^\s*for\s*=\s*"([^"]*)"/m.exec(body);
    if (!forLine || forLine[1] !== "/*") continue;
    for (const m of body.matchAll(/^\s*([A-Za-z][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) {
      if (m[1] === "for") continue;
      out[m[1]] = m[2];
    }
  }
  return out;
}

/** The Content-Security-Policy as directive → sources. */
export function cspDirectives(toml) {
  const csp = globalHeaders(toml)["Content-Security-Policy"] ?? "";
  const map = new Map();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".py": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

export function serve(dir, port, headers) {
  const root = resolve(dir);
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const index = join(file, "index.html");
      file = existsSync(index) ? index : join(root, "index.html");
    }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }).listen(port);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv[2] === "serve") {
  const dir = process.argv[3] ?? "dist";
  const port = Number(process.argv[4] ?? 4178);
  const headers = globalHeaders(readFileSync(new URL("../netlify.toml", import.meta.url), "utf8"));
  serve(dir, port, headers);
  console.log(`serving ${dir} with netlify.toml's headers on http://localhost:${port}/`);
}
