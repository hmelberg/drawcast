// The local author's toolbox (the /drawcast skill, .claude/skills/drawcast):
// every step of writing a drawcast by hand-with-eyes, using the app's OWN
// code, so a figure made here is made to the same prompt, templates and
// checks as one the app generates.
//
//   node scripts/cast.mjs prompt "<request>" [out.md]   the app's system prompt for this request (catalog shortlist,
//                                                        few-shots, exemplars, code/sound gates), wrapped for reading
//   node scripts/cast.mjs template <id>                  a template's full catalog entry (params, element ids)
//   node scripts/cast.mjs check <cast.json>              validation + layout/command lint (the generator's own checks)
//   node scripts/cast.mjs frames <cast.json> [outdir]    frames after every spoken line, as PNG tiles, plus the
//                                                        browser-measured lint per frame — needs the dev server
//   node scripts/cast.mjs open <cast.json>               the app URL that opens this cast (dev server only)
//
// A cast file is a spec, a {request, spec}, or playlist YAML — anything the
// app opens. Files live under dev-casts/ (gitignored). The dev server:
//   npm run dev -- --port 5199 --strictPort      (DRAWCAST_URL overrides http://localhost:5199)

import { createServer } from "vite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const [cmd, ...rest] = process.argv.slice(2);
const ROOT = process.cwd();
const URL_BASE = process.env.DRAWCAST_URL ?? "http://localhost:5199";

const wrap = (text, width = 300) =>
  String(text)
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const out = [];
      let r = line;
      while (r.length > width) {
        let cut = r.lastIndexOf(" ", width);
        if (cut < width / 2) cut = width;
        out.push(r.slice(0, cut));
        r = r.slice(cut).replace(/^ /, "");
      }
      out.push(r);
      return out.join("\n");
    })
    .join("\n");

function readCast(file) {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  try {
    const j = JSON.parse(text);
    return j.spec ?? j;
  } catch {
    return null; // playlist YAML: the frames harness reads it; check needs JSON
  }
}

function devPath(file) {
  const rel = relative(ROOT, resolve(ROOT, file));
  if (rel.startsWith("..")) throw new Error(`${file} must be inside the repo (e.g. dev-casts/) so the dev server can serve it`);
  return "/" + rel.split("\\").join("/");
}

async function withVite(fn) {
  const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  try {
    const { ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } = await server.ssrLoadModule("/src/scenes/packs.ts");
    await ensureEnabledPacks(Object.keys(PACK_DEFS).filter((id) => !DEFAULT_OFF_PACKS.has(id)));
    return await fn((p) => server.ssrLoadModule(p));
  } finally {
    await server.close();
  }
}

async function browser() {
  const { chromium } = await import("playwright-core");
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
  if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
  const dir = `${cache}/${shells.at(-1)}`;
  const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
  return chromium.launch({ executablePath: `${dir}/${sub}/chrome-headless-shell` });
}

const commands = {
  async prompt([request, out = "dev-casts/_prompt.md"]) {
    if (!request) throw new Error('usage: cast.mjs prompt "<request>" [out.md]');
    await withVite(async (load) => {
      const compile = await load("/src/llm/compile.ts");
      const { buildSystemBlocks, formatExemplars, wantsCode, wantsSound } = await load("/src/llm/prompt.ts");
      const { pickExemplars } = await load("/src/llm/exemplars.ts");
      const { usableExemplars } = await load("/src/llm/exemplars.ts");
      const { catalogParts, isReadyTemplate } = await load("/src/scenes/catalog.ts");
      const examples = JSON.parse(readFileSync(resolve(ROOT, "src/examples.json"), "utf8"));
      const bundled = usableExemplars(
        examples.filter((e) => !e.specimen).map((e) => ({ prompt: e.request, spec: e.spec })),
        isReadyTemplate,
      );
      const code = wantsCode(request), sound = wantsSound(request);
      const catalog = catalogParts({ request });
      const blocks = buildSystemBlocks(compile.promptVariants()[0].source, {
        schema: compile.apiSchema({ code, sound }),
        catalog: catalog.stable,
        fewshots: compile.fewshotsText({ code }),
        exemplars: formatExemplars(pickExemplars(request, [], bundled, 3)),
        code: code ? compile.CODE_PROMPT_SOURCE : "",
        sound: sound ? compile.SOUND_PROMPT_SOURCE : "",
      });
      const text = blocks.prefix + blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "");
      mkdirSync(resolve(ROOT, "dev-casts"), { recursive: true });
      writeFileSync(resolve(ROOT, out), wrap(text) + "\n");
      console.log(`${out}: ${text.length} characters (wrapped at 300 columns; line breaks are not part of it). Shortlisted templates are in full at the end.`);
    });
  },

  async template([id]) {
    if (!id) throw new Error("usage: cast.mjs template <id>");
    await withVite(async (load) => {
      const { catalogParts, routerIndexText } = await load("/src/scenes/catalog.ts");
      const line = routerIndexText().split("\n").find((l) => l.startsWith(`- ${id}:`));
      if (!line) throw new Error(`no ready template "${id}"`);
      const full = catalogParts({ forced: id }).stable;
      const at = full.indexOf(id);
      console.log(wrap(full.slice(Math.max(0, full.lastIndexOf("\n\n", at)))));
    });
  },

  async check([file]) {
    if (!file) throw new Error("usage: cast.mjs check <cast.json>");
    const spec = readCast(file);
    if (!spec) throw new Error("check reads JSON (a spec or {request, spec}); for YAML use frames");
    await withVite(async (load) => {
      const { validateSpec } = await load("/src/spec/schema.ts");
      const { expandSpec } = await load("/src/spec/expand.ts");
      const { layoutSpec } = await load("/src/layout/layout.ts");
      const { heuristicMeasure } = await load("/src/layout/measure.ts");
      const { lintCommands } = await load("/src/lint/lint.ts");
      const { ensureEnginesForSpecs } = await load("/src/scenes/engines.ts");
      const v = validateSpec(spec);
      if (!v.ok) {
        console.log("INVALID\n" + v.errors.map((e) => "  " + e).join("\n"));
        process.exitCode = 1;
        return;
      }
      await ensureEnginesForSpecs([spec]).catch(() => {});
      const ex = expandSpec(spec);
      const issues = [...layoutSpec(ex, heuristicMeasure).issues, ...lintCommands(ex)];
      const speaks = (spec.commands ?? []).filter((c) => typeof c.speak === "string").length;
      console.log(`valid · ${speaks} spoken lines · ${(spec.elements ?? []).length} elements${spec.template ? ` · template ${spec.template}` : ""}`);
      console.log(issues.length ? issues.map((i) => `  [${i.severity}] ${i.message}`).join("\n") : "  lint clean (heuristic metrics — frames gives the browser's)");
    });
  },

  async frames([file, outdir]) {
    if (!file) throw new Error("usage: cast.mjs frames <cast.json> [outdir]");
    const name = basename(file).replace(/\.(json|ya?ml)$/i, "");
    const out = resolve(ROOT, outdir ?? `dev-casts/frames-${name}`);
    mkdirSync(out, { recursive: true });
    const b = await browser();
    try {
      const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
      const url = `${URL_BASE}/frames.html?cast=${devPath(file)}&beats=all&v=${Date.now()}`;
      await page.goto(url, { waitUntil: "networkidle" }).catch(() => {
        throw new Error(`no dev server at ${URL_BASE} — start one: npm run dev -- --port 5199 --strictPort`);
      });
      await page.waitForFunction(() => document.querySelectorAll("svg").length > 1 || /nothing to show|Error/.test(document.body.innerText), null, { timeout: 90000 });
      await page.waitForTimeout(2500);
      const report = await page.evaluate(() => window.__frames());
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const tiles = [];
      for (let y = 150, k = 1; y < h; y += 1800, k++) {
        const f = `${out}/frames-${k}.png`;
        await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y, width: 1000, height: Math.min(1800, h - y) } });
        tiles.push(relative(ROOT, f));
      }
      writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
      console.log(`${tiles.length} tile(s): ${tiles.join(", ")} — one frame per spoken line (mid-gesture where the line highlights, focuses, points or flows)`);
      for (const part of report.parts ?? []) {
        const bad = [...part.validationErrors, ...part.planWarnings, ...part.commandIssues, ...part.playbackErrors];
        if (bad.length) console.log("  " + bad.join("\n  "));
        for (const fr of part.frames ?? []) if (fr.issues?.length) console.log(`  @${fr.at} ${fr.changed}: ${fr.issues.join(" · ")}`);
      }
      if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
      if (!(report.parts ?? []).some((p) => p.frames?.some((f) => f.issues?.length))) console.log("  no browser lint on any frame");
    } finally {
      await b.close();
    }
  },

  async open([file]) {
    if (!file) throw new Error("usage: cast.mjs open <cast.json>");
    console.log(`${URL_BASE}/?open=${devPath(file)}`);
  },
};

if (!commands[cmd]) {
  console.log("usage: node scripts/cast.mjs prompt|template|check|frames|open …  (see the header of this file)");
  process.exitCode = 1;
} else {
  await commands[cmd](rest).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
