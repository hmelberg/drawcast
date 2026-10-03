// The code fingerprints of the curated front-page library (2026-10-03): every
// program (code element script, template body) in the casts published to
// hmelberg/drawcast-library, as code-trust keys — the SHA-256 of the exact
// bytes, the same rule the bundled examples are trusted by. The viewer trusts
// these for this page only (security/code-trust.ts trustKeys, persist:false),
// so the library plays without the "contains code" question; a change to any
// of that code on GitHub no longer matches and asks again.
//
//   node scripts/library-trust.mjs <library-clone>/casts > src/home/trusted-code.json
//
// Re-run after republishing a library cast whose code changed.

import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "vite";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/library-trust.mjs <dir of published .cast files>");
  process.exit(2);
}
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const P = await vite.ssrLoadModule("/src/playlist/playlist.ts");
const T = await vite.ssrLoadModule("/src/security/code-trust.ts");
const keys = new Set();
const withCode = [];
for (const f of readdirSync(dir).filter((f) => /\.(cast|ya?ml)$/.test(f)).sort()) {
  const specs = P.itemsOf(P.parsePlaylistText(readFileSync(`${dir}/${f}`, "utf8"))).map((i) => i.spec);
  const items = T.codeItemsOfAll(specs);
  if (items.length) withCode.push(f);
  for (const i of items) keys.add(i.key);
}
console.log(JSON.stringify({ source: "hmelberg/drawcast-library", casts: withCode, keys: [...keys].sort() }, null, 2));
console.error(`${withCode.length} casts carry code; ${keys.size} keys`);
await vite.close();
