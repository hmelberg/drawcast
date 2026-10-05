// scripts/card-lab.mjs — the card lab's batch (2026-10-05; card-lab.html).
// Compiles every library cast's card (src/card/convert.ts, through the dev
// harness's window.__card in a real browser), then times the lab page drawing
// them all, normally and at 4× slower CPU, and measures the small renderer's
// size. Writes docs/card-lab/runs/<date>/ and docs/card-lab/runs/latest/.
//
//   npm run cardlab [-- --only slug1,slug2]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { defaultLaunch, defaultServe } from "./pictures.mjs";
import { iconCacheDir, iconFetcher, routePage } from "./icon-fetch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const LIBRARY = join(ROOT, "dev-casts/repos/hmelberg__drawcast-library/casts");
const PER_CAST_MS = 30000;

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i > 0 ? new Set(process.argv[i + 1].split(",")) : null;
})();

if (!existsSync(LIBRARY)) {
  console.error(`No library clone at ${LIBRARY}`);
  process.exit(1);
}

/** Free names by title, from the live feed (today's card is drawn by name). */
async function namesByTitle() {
  try {
    const feed = await (await fetch("https://drawcast.app/api/feed")).json();
    return new Map(feed.items.map((i) => [i.title.trim().toLowerCase(), i.name]));
  } catch {
    return new Map();
  }
}

function titleOf(text) {
  const m = /^#\s+(.+)$/m.exec(text) ?? /^title:\s*"?(.+?)"?\s*$/m.exec(text);
  return m ? m[1].trim() : "";
}

async function rendererGzip() {
  const { build } = await import("esbuild");
  const out = await build({ entryPoints: [join(ROOT, "src/card/draw.ts")], bundle: true, minify: true, format: "esm", write: false, logLevel: "silent" });
  return gzipSync(out.outputFiles[0].contents).length;
}

const slugs = readdirSync(LIBRARY).filter((f) => f.endsWith(".cast")).map((f) => f.slice(0, -5)).filter((s) => !only || only.has(s)).sort();
const names = await namesByTitle();
const server = await defaultServe(ROOT)();
const browser = await defaultLaunch();
const rows = [];
try {
  const icons = iconFetcher({ dir: iconCacheDir(ROOT) });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    await routePage(page, icons);
    await page.goto(`${server.url}frames.html`);
    await page.waitForFunction(() => typeof window.__card === "function", null, { timeout: 60000 });
    return page;
  };
  let page = await open();
  for (const [n, slug] of slugs.entries()) {
    const text = readFileSync(join(LIBRARY, `${slug}.cast`), "utf8");
    const title = titleOf(text);
    const row = { slug, title, name: names.get(title.toLowerCase()), poster: `/dev-casts/repos/hmelberg__drawcast-library/casts/${slug}.png`, ms: 0, result: null };
    const t = Date.now();
    let timer;
    try {
      row.result = await Promise.race([
        page.evaluate((x) => window.__card(x), text),
        new Promise((_, no) => (timer = setTimeout(() => no(new Error("timed out")), PER_CAST_MS))),
      ]);
    } catch (e) {
      row.error = String(e?.message ?? e).split("\n")[0].slice(0, 160);
      if (/timed out/.test(row.error)) page = await open();
    } finally {
      clearTimeout(timer);
    }
    row.ms = Date.now() - t;
    rows.push(row);
    process.stdout.write(`\r${n + 1}/${slugs.length} ${slug.padEnd(50).slice(0, 50)}`);
  }
  process.stdout.write("\n");

  const date = new Date().toISOString().slice(0, 10);
  const dir = join(ROOT, "docs/card-lab/runs", date);
  const latest = join(ROOT, "docs/card-lab/runs/latest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cards.json"), JSON.stringify(rows));

  // The page drawing every card, timed — normal, then at 4× slower CPU.
  const stats = { rendererGzip: await rendererGzip() };
  rmSync(latest, { recursive: true, force: true });
  cpSync(dir, latest, { recursive: true });
  for (const [key, rate] of [["drawMs", 1], ["drawMsSlow", 4]]) {
    const p = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    // The dev server may reload the page once while it prepares the renderer's
    // dependencies on first use: wait again after such a reload.
    for (let attempt = 0; attempt < 3 && stats[key] === undefined; attempt++) {
      try {
        if (attempt === 0) await p.goto(`${server.url}card-lab.html`);
        else await p.waitForLoadState("load");
        await p.waitForFunction(() => typeof window.__drawMs === "number", null, { timeout: 120000 });
        stats[key] = await p.evaluate(() => window.__drawMs);
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    await p.close();
  }
  writeFileSync(join(dir, "stats.json"), JSON.stringify(stats));
  writeFileSync(join(latest, "stats.json"), JSON.stringify(stats));

  const ok = rows.filter((r) => r.result);
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  console.log(`${ok.length}/${rows.length} cards; median ${med(ok.map((r) => r.result.bytes))} B (+ icons ${med(ok.map((r) => r.result.iconBytes))} B); renderer ${stats.rendererGzip} B gzip; draw ${stats.drawMs} ms, ${stats.drawMsSlow} ms at 4× slower`);
  for (const r of rows.filter((x) => !x.result)) console.log(`  no card: ${r.slug} — ${r.error ?? "no poster item"}`);
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}
