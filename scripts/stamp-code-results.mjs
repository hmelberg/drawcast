// Record what every bundled code example's scripts really produce, so the
// examples gate (tests/examples.test.ts) lays out the REAL chart in Node
// instead of placeholders (ledger decision 6, 2026-09-25). Node has no
// Pyodide, webR or Brython; the dev server's frames harness has them all.
//
//   npm run dev                                  (in another terminal)
//   node scripts/stamp-code-results.mjs [http://localhost:5173] [index …]
//
// Writes tests/fixtures/code-results.json: per example request, the key its
// code and params hash to (tests/helpers/code-key.mjs) and each code
// element's envelope — figures reduced to their size, the only thing layout
// reads. With indices, only those examples are re-recorded.
//
// Playwright is not a dependency of this repo (see smoke-race.mjs): the
// script imports it if it can, else from PLAYWRIGHT_MODULE (a path to a
// playwright package, e.g. one `npx playwright` left in the npm cache), and
// launches the browser at PLAYWRIGHT_CHROMIUM when that is set.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeKey, hasCode } from "../tests/helpers/code-key.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "tests/fixtures/code-results.json");
const [base = "http://localhost:5173", ...only] = process.argv.slice(2);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const p = process.env.PLAYWRIGHT_MODULE;
    if (!p) throw new Error("playwright not found: install it, or set PLAYWRIGHT_MODULE to a playwright package directory");
    return await import(pathToFileURL(join(p, "index.mjs")).href);
  }
}

const examples = JSON.parse(readFileSync(join(ROOT, "src/examples.json"), "utf8"));
const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};
const wanted = examples
  .map((ex, i) => ({ ex, i }))
  .filter(({ ex, i }) => hasCode(ex.spec) && (only.length === 0 || only.includes(String(i))));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ["--mute-audio"], ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}) });
const page = await browser.newPage();
await page.goto(`${base}/frames.html`);
await page.waitForFunction(() => typeof window.__stampCode === "function", null, { timeout: 60000 });
let n = 0;
for (const { ex, i } of wanted) {
  const stamps = await page.evaluate((idx) => window.__stampCode(idx), i);
  const failed = Object.entries(stamps).filter(([, env]) => !JSON.parse(env).ok).map(([id]) => id);
  fixture[ex.request] = { key: codeKey(ex.spec), stamps };
  console.log(`#${i} ${failed.length ? `FAILED ${failed.join(", ")}` : "ok"}  ${ex.request.slice(0, 70)}`);
  n++;
}
await browser.close();
// Drop stamps for examples that no longer exist or no longer have code.
const live = new Set(examples.filter((ex) => hasCode(ex.spec)).map((ex) => ex.request));
for (const k of Object.keys(fixture)) if (!live.has(k)) delete fixture[k];
const sorted = Object.fromEntries(Object.entries(fixture).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FIXTURE, JSON.stringify(sorted, null, 1) + "\n");
console.log(`${n} example(s) recorded → tests/fixtures/code-results.json`);
