// The prompt lab's runner (docs/prompt-lab/README.md): the same requests
// through the app's own generateSpec, per pipeline ("arm"), writing every
// spec, plan, critique, cost, timing and lint to docs/prompt-lab/runs/<out>/
// and a copy of each spec to dev-casts/ for the player and the frames page.
//
//   node scripts/prompt-lab.mjs --limit 0                      boot check, no calls
//   node scripts/prompt-lab.mjs --set final --arms oneshot,storyline --frames http://localhost:5199
//   node scripts/prompt-lab.mjs --manual …                     the model calls answered by agents (free)
//
// Options:
//   --set fresh|templates|final|storyline5|interactive
//                                 the request list (final = 2 freehand + 2 template;
//                                 storyline5 = the one-shot-vs-storyline comparison:
//                                 2 freehand + 3 template, two with live widgets;
//                                 interactive = #interactive requests, guesses on the figure)
//                                 A request's #tags are parsed as the app does (parseTags →
//                                 buildBrief): the brief goes in, the tags come out of the text.
//   --cases 1,3                   which of them
//   --arms oneshot,storyline      pipelines: oneshot (= standard) = one call; storyline = the
//                                 app's default since 2026-09-28 (the storyline at medium
//                                 effort, then staging). The v2 plan arm was retired 2026-09-30
//                                 (docs/prompt-lab/archive/, tag archive/pipeline-experiments-2026-09-30).
//   --no-look                     without the look pass (it needs --frames)
//   --model <id>                  another model (default: the app's)
//   --manual                      every Opus/Sonnet call goes to files instead of the API:
//                                 <out>/<case>-<arm>/exchange/NN-request.md (+ .json, images,
//                                 and the system prompt once as system-<hash>.md, wrapped);
//                                 the run waits for NN-reply.txt and NN-reply.done. Haiku (the
//                                 router) still uses the API when a key is set. Agents answer —
//                                 see docs/prompt-lab/answering-agent.md.
//   --frames <url>                a running dev server — the look pass renders frames there
//   --out <dir>                   where the run goes (default docs/prompt-lab/runs/<stamp>)

import { createServer } from "vite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const limit = Number(opt("--limit", "99"));
const only = opt("--cases", undefined)?.split(",").map(Number);
const arms = opt("--arms", "oneshot,storyline").split(",");
const modelOpt = opt("--model", undefined);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = opt("--out", `docs/prompt-lab/runs/${stamp}`);
const manual = args.includes("--manual");
const framesUrl = opt("--frames", undefined);
const playwrightPath = opt("--playwright", "playwright-core");
const set = opt("--set", "fresh");

try {
  globalThis.localStorage.getItem("x");
} catch {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
}

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const p of [".env", "../../../.env"]) {
    try {
      const m = /^ANTHROPIC_API_KEY=["']?([^"'\n]+)/m.exec(readFileSync(resolve(ROOT, p), "utf8"));
      if (m) return m[1];
    } catch {
      /* next */
    }
  }
  return "";
}

/** Fresh requests — none is a bundled example or a few-shot. Kinds: economics, medicine, math, a thing, Norwegian. */
const FRESH = [
  ["econ", "Why does printing more money cause inflation — and when doesn't it?"],
  ["medicine", "Why do antibiotics stop working?"],
  ["math", "Why is 1 + 2 + … + n equal to n(n+1)/2?"],
  ["thing", "How does a refrigerator keep the inside cold?"],
  ["norsk", "Hvorfor er det kaldere på toppen av et fjell, når man er nærmere sola?"],
];

/** Requests a ready template draws — so the arms are compared where the app is strongest. */
const TEMPLATES = [
  ["tax", "If the government puts a $10 tax on every concert ticket, who ends up paying it?"],
  ["decision", "Should a 70-year-old with a small aortic aneurysm have surgery now, or wait and watch?"],
  ["survival", "What does it mean when a trial says a new drug 'improved median survival by four months'?"],
  ["firm", "Why does a firm keep producing even when it is losing money?"],
];
/** The fair A*-vs-D* run (2026-09-27): two freehand, two template. */
const FINAL = [FRESH[0], FRESH[3], TEMPLATES[0], TEMPLATES[1]];
/** One-shot vs storyline (2026-09-28): two freehand, three template — a
 *  plain template, and two whose widgets the storyline can plan an explore
 *  beat around. */
const STORYLINE5 = [FRESH[0], FRESH[3], TEMPLATES[0], TEMPLATES[1], ["lens", "Why does a magnifying glass make things look bigger, and why does the image flip when you hold it far away?"]];
/** #interactive (spec 2026-10-01-guess-and-reveal §9): does the brief make the
 *  model ask guesses on the figure before its reveals, and vary the forms? */
const INTERACTIVE = [
  ["health", "How much do rich countries spend on health, and does spending more buy longer lives? #interactive"],
  ["vaccine", "How do vaccines protect people who are not vaccinated? #interactive"],
  // round 4 (spec 2026-10-03-curves-trees-formulas): tree blanks + pick, formula \blank, market guesses
  ["statins", "Should a 60-year-old with high cholesterol take statins? Walk through the expected years of life #interactive"],
  ["kinetic", "Kinetic energy: where the ½mv² comes from #interactive"],
  ["sugartax", "Who really pays a sugar tax? #interactive"],
];
const CASES = set === "templates" ? TEMPLATES : set === "final" ? FINAL : set === "storyline5" ? STORYLINE5 : set === "interactive" ? INTERACTIVE : FRESH;

/**
 * The pipelines, as the app runs them (the 2026-09-27 lab's A* and D*): both
 * with the look pass unless --no-look. The runs of that day used earlier arms
 * (A, C, C2, D) — their code is on branch prompt-lab.
 */
const noLook = args.includes("--no-look");
const ARMS = {
  standard: { treatment: false, lookPass: !noLook },
  oneshot: { treatment: false, lookPass: !noLook },
  storyline: { treatment: true, lookPass: !noLook },
};
const unknownArms = arms.filter((a) => !(a in ARMS));
if (unknownArms.length) throw new Error(`unknown arm(s) ${unknownArms.join(", ")}; the arms are ${Object.keys(ARMS).join(", ")}`);

// ---- manual transport: requests to files, replies from files ----
const wrap = (text, width = 300) =>
  String(text)
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const out = [];
      let rest = line;
      while (rest.length > width) {
        let cut = rest.lastIndexOf(" ", width);
        if (cut < width / 2) cut = width;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^ /, "");
      }
      out.push(rest);
      return out.join("\n");
    })
    .join("\n");
const systemText = (system) => (typeof system === "string" ? system : system.map((b) => b.text).join("\n\n"));
function blocks(content) {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}
function makeManualTransport(dir, sharedDir) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });
  let n = 0;
  return async (req) => {
    if (req.model.startsWith("claude-haiku") && apiKey()) return null;
    n++;
    const nn = String(n).padStart(2, "0");
    const sys = systemText(req.system);
    const hash = createHash("sha1").update(sys).digest("hex").slice(0, 10);
    const sysFile = `${sharedDir}/system-${hash}.md`;
    if (!existsSync(sysFile)) writeFileSync(sysFile, wrap(sys) + "\n");
    const parts = [
      `# Request ${nn}`,
      "",
      `- model the app would call: ${req.model}${req.effort ? `, effort ${req.effort}` : ""}`,
      `- reply format: ${req.jsonReply ? "ONE JSON object only (as the system prompt specifies) — no prose, no fences" : "plain text, as the system prompt asks"}`,
      `- system prompt: ${sysFile} (${sys.length} characters; wrapped at 300 columns for reading — the line breaks are not part of it)`,
      "",
      "## Messages",
    ];
    let img = 0;
    req.messages.forEach((m, i) => {
      parts.push("", `### ${i + 1}. ${m.role}`, "");
      for (const b of blocks(m.content)) {
        if (b.type === "text") {
          if (m.role === "assistant" && b.text.trim().startsWith("{")) {
            const f = `${dir}/${nn}-msg${i + 1}.json`;
            writeFileSync(f, b.text);
            parts.push(`(your earlier reply, a JSON spec — exact text in ${f}; wrapped copy below)`, "", wrap(b.text));
          } else parts.push(wrap(b.text));
        } else if (b.type === "image") {
          img++;
          const ext = b.source.media_type === "image/png" ? "png" : "jpg";
          const f = `${dir}/${nn}-img${img}.${ext}`;
          writeFileSync(f, Buffer.from(b.source.data, "base64"));
          parts.push(`[image ${img}: ${f}]`);
        }
      }
    });
    if (req.outputSchema && !sys.includes('"$schema"') && !sys.includes('"properties"')) {
      writeFileSync(`${dir}/${nn}-schema.json`, JSON.stringify(req.outputSchema, null, 1));
      parts.push("", `The reply must validate against ${dir}/${nn}-schema.json.`);
    }
    parts.push("", `Write your reply to ${dir}/${nn}-reply.txt and nothing else; when it is complete, create the empty file ${dir}/${nn}-reply.done.`);
    writeFileSync(`${dir}/${nn}-request.md`, parts.join("\n") + "\n");
    writeFileSync(`${dir}/${nn}-request.json`, JSON.stringify(req));
    // The reply counts only once its .done marker exists: an agent may write
    // the reply file and then correct it (run 2026-09-27: two replies were read
    // mid-edit when the file's mere appearance was the signal).
    const replyFile = `${dir}/${nn}-reply.txt`;
    console.log(`  waiting for ${replyFile}`);
    while (!existsSync(`${dir}/${nn}-reply.done`)) await new Promise((r) => setTimeout(r, 2000));
    return readFileSync(replyFile, "utf8");
  };
}

// ---- frames for the look pass: the dev server's frames harness, tiled ----
let browser = null;
async function renderFrames(spec, tag) {
  if (!framesUrl) return null;
  if (!browser) {
    const { chromium } = await import(playwrightPath);
    const { readdirSync } = await import("node:fs");
    const home = process.env.HOME;
    const shells = readdirSync(`${home}/Library/Caches/ms-playwright`).filter((d) => d.startsWith("chromium_headless_shell")).sort();
    const dirOf = `${home}/Library/Caches/ms-playwright/${shells.at(-1)}`;
    const sub = readdirSync(dirOf).find((d) => d.startsWith("chrome-headless-shell"));
    browser = await chromium.launch({ executablePath: `${dirOf}/${sub}/chrome-headless-shell` });
  }
  mkdirSync("dev-casts", { recursive: true });
  const cast = `dev-casts/lab-look-${tag}.json`;
  writeFileSync(cast, JSON.stringify({ spec }));
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  try {
    await page.goto(`${framesUrl}/frames.html?cast=/${cast}&v=${Date.now()}&beats=all`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll("svg").length > 1, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const tiles = [];
    for (let y = 150; y < h && tiles.length < 8; y += 1800) {
      const buf = await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y, width: 1000, height: Math.min(1800, h - y) }, fullPage: true });
      tiles.push({ mediaType: "image/jpeg", data: buf.toString("base64") });
    }
    return tiles;
  } finally {
    await page.close();
  }
}

const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "warn" });
try {
  const { generateSpec, promptVariants } = await server.ssrLoadModule("/src/llm/compile.ts");
  const { parseTags, buildBrief } = await server.ssrLoadModule("/src/llm/tags.ts");
  const { routeTemplates } = await server.ssrLoadModule("/src/llm/router.ts");
  const { ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } = await server.ssrLoadModule("/src/scenes/packs.ts");
  const { isReadyTemplate } = await server.ssrLoadModule("/src/scenes/catalog.ts");
  const { usableExemplars } = await server.ssrLoadModule("/src/llm/exemplars.ts");
  const { resetCallLedger, callLedger, costSummary, DEFAULT_MODEL, setManualTransport } = await server.ssrLoadModule("/src/llm/client.ts");
  await ensureEnabledPacks(Object.keys(PACK_DEFS).filter((id) => !DEFAULT_OFF_PACKS.has(id)));
  const examples = JSON.parse(readFileSync(resolve(ROOT, "src/examples.json"), "utf8"));
  const bundled = usableExemplars(
    examples.filter((e) => !e.specimen).map((e) => ({ prompt: e.request, spec: e.spec })),
    isReadyTemplate,
  );
  const variant = promptVariants()[0];
  const cases = CASES.map((c, i) => [i + 1, ...c]).filter(([n]) => (!only || only.includes(n)) && n <= limit);
  const key = apiKey();
  console.log(`model ${modelOpt ?? DEFAULT_MODEL}; arms ${arms.join(",")}; cases ${cases.map((c) => c[0]).join(",") || "none"}; out ${outDir}`);
  if ((!key && !manual) || cases.length === 0) {
    console.log(!key ? "no ANTHROPIC_API_KEY — exiting without calling the API." : "no cases — exiting.");
  } else {
    mkdirSync(outDir, { recursive: true });
    mkdirSync("dev-casts", { recursive: true });
    const route = key ? (request, signal) => routeTemplates(request, { apiKey: key, signal }) : undefined;
    const records = [];
    for (const [n, kind, request] of cases) {
      for (const arm of arms) {
        resetCallLedger();
        const t0 = Date.now();
        const base0 = `${n}-${kind}-${arm}`;
        if (manual) setManualTransport(makeManualTransport(`${outDir}/${base0}/exchange`, `${outDir}/_system`));
        let looks = 0;
        const look = ARMS[arm].lookPass ? (spec) => renderFrames(spec, `${base0}-${++looks}`) : undefined;
        const rec = { case: n, kind, request, arm };
        try {
          const parsed = parseTags(request);
          const brief = buildBrief(parsed.tags);
          const outcome = await generateSpec(parsed.clean, {
            ...(brief ? { brief } : {}),
            apiKey: key || "manual",
            model: modelOpt ?? DEFAULT_MODEL,
            effort: "high",
            variant,
            exemplars: [],
            bundledExemplars: bundled,
            route,
            executeCode: false,
            treatment: ARMS[arm].treatment,
            look,
          });
          const last = outcome.rounds[outcome.rounds.length - 1];
          const lint = last?.lintIssues ?? [];
          const speaks = (outcome.spec?.commands ?? []).filter((c) => typeof c.speak === "string");
          Object.assign(rec, {
            ms: Date.now() - t0,
            usd: Number(costSummary(callLedger()).usd.toFixed(3)),
            template: outcome.spec?.template ?? null,
            rounds: outcome.rounds.map((r) => r.label + (r.adopted ? "*" : "")),
            lintErrors: lint.filter((i) => i.severity === "error").length,
            lintWarns: lint.filter((i) => i.severity === "warn").length,
            speakLines: speaks.length,
            words: speaks.reduce((s, c) => s + c.speak.split(/\s+/).length, 0),
            model: modelOpt ?? DEFAULT_MODEL,
            treatmentMs: outcome.treatmentMs,
            treatmentTemplate: outcome.treatmentTemplate,
            templateGaps: outcome.templateGaps,
            crowding: lint.filter((i) => i.rule === "crowding").map((i) => i.message),
            stages: outcome.rounds.map((r) => ({
              label: r.label,
              adopted: r.adopted,
              ms: Math.round(r.meta?.ms ?? 0),
              in: r.meta?.inputTokens,
              out: r.meta?.outputTokens,
              ...(r.label === "look" ? { validationErrors: r.validationErrors, lint: (r.lintIssues ?? []).map((i) => `[${i.severity}] ${i.message}`) } : {}),
            })),
            calls: costSummary(callLedger()),
            error: outcome.error ?? outcome.treatmentError,
          });
          const base = `${n}-${kind}-${arm}`;
          writeFileSync(`${outDir}/${base}.json`, JSON.stringify({ request, spec: outcome.spec }, null, 1));
          if (outcome.treatment) writeFileSync(`${outDir}/${base}-treatment.md`, outcome.treatment + "\n");
          const critiques = outcome.rounds.filter((r) => r.label === "look").map((r, i) => `## Look ${i + 1}${r.adopted ? " (fix adopted)" : ""}\n\n${r.critique ?? ""}`);
          if (critiques.length) writeFileSync(`${outDir}/${base}-critique.md`, critiques.join("\n\n") + "\n");
          const preLook = outcome.rounds.filter((r) => r.label !== "look" && r.spec && !r.validationErrors?.length).at(-1)?.spec;
          if (ARMS[arm].lookPass && preLook) writeFileSync(`${outDir}/${base}-prelook.json`, JSON.stringify({ request, spec: preLook }, null, 1));
          if (outcome.spec) writeFileSync(`dev-casts/lab-${base}.json`, JSON.stringify({ request, spec: outcome.spec }));
        } catch (err) {
          Object.assign(rec, { ms: Date.now() - t0, usd: Number(costSummary(callLedger()).usd.toFixed(3)), error: String(err) });
        }
        if (manual) writeFileSync(`${outDir}/${base0}/exchange/DONE`, "");
        records.push(rec);
        console.log(`${n} ${arm} ${kind}: ${rec.error ? "ERROR " + rec.error : "ok"} ${Math.round(rec.ms / 1000)}s $${rec.usd} lines=${rec.speakLines ?? "-"} lint=${rec.lintErrors ?? "-"}/${rec.lintWarns ?? "-"} ${rec.template ?? "freehand"} [${(rec.rounds ?? []).join(">")}]`);
        writeFileSync(`${outDir}/records.json`, JSON.stringify(records, null, 1));
      }
    }
    const total = records.reduce((s, r) => s + (r.usd ?? 0), 0);
    console.log(`total $${total.toFixed(2)}`);
  }
} finally {
  await browser?.close();
  await server.close();
}
