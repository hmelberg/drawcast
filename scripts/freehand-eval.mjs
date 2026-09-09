// The freehand-figures live eval (freehand-figures design §7.4): twelve
// requests with no template ready for them — four "thing" (parts to name),
// four "math" (a formula beside its curve), four "image" (a real photo) —
// run through the real compiler with a real API key, scored against the
// element the round added for that label. Baseline (against `main`, no
// fetchSeed on GenerateConfig) and after-runs (`--seed off` / `--seed on`)
// share this one script; see plan Task 15 step 2.
//
//   node scripts/freehand-eval.mjs                       boot check, no key needed with --limit 0
//   ANTHROPIC_API_KEY=... node scripts/freehand-eval.mjs  full run, 12 cases, seed off
//   npm run eval:freehand -- --seed on --limit 4
//   --seed on|off (default off)   --visual on|off (node: unavailable, always off)
//   --out <dir> (default .superpowers/eval/freehand-<ISO timestamp>)
//   --limit N   --model <id> (default the app's DEFAULT_MODEL)

import { createServer } from "vite";
import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// The Vite root is the CURRENT DIRECTORY, not this file's own location: the
// baseline run (plan Task 15 step 2) invokes this same script file from
// inside a separate `git worktree add ../freehand-baseline main` checkout
// (`cd ../freehand-baseline && node ../freehand/scripts/freehand-eval.mjs`)
// so that ssrLoadModule serves `main`'s own src/llm/compile.ts — the whole
// point of a baseline. Node resolves bare imports like "vite" by walking up
// from this file's real location, so the harness itself still loads fine.
const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const seedOn = opt("--seed", "off") === "on";
const visualOn = opt("--visual", "off") === "on";
const outDir = opt("--out", `.superpowers/eval/freehand-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const limit = Number(opt("--limit", "12"));
const modelOpt = opt("--model", undefined);

if (visualOn) console.log("visual: unavailable in node");

// src/store.ts touches localStorage at call time; node has none (or a flagged one).
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
    get length() { return mem.size; },
  };
}

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const env = readFileSync(resolve(ROOT, ".env"), "utf8");
    return /^ANTHROPIC_API_KEY=["']?([^"'\n]+)/m.exec(env)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** label, request — no template drawing this today; the round adds the element each label needs. */
const CASES = [
  ["thing", "How does a bicycle pump push air into a tyre?"], ["thing", "Hva er delene i en symaskin, og hva gjør de?"],
  ["thing", "What are the parts of a neuron and what does each do?"], ["thing", "Hvordan virker en dørlås?"],
  ["math", "Why does a dropped ball speed up? Show the equations with the curve."], ["math", "Hvorfor blir renters rente så stor? Vis formelen ved kurven."],
  ["math", "What does the logistic equation say, drawn next to its S-curve?"], ["math", "Vis formelen for arealet av en sirkel ved siden av sirkelen."],
  ["image", "Why is the Eiffel Tower shaped like that?"], ["image", "Hvorfor har en bikube sekskanter? Vis et ekte bilde og skissen."],
  ["image", "What makes a violin sound the way it does?"], ["image", "Hvordan ser Stortinget ut, og hvorfor er det bygget slik?"],
];

/** thing → a group holding the parts; math → a math element; image → an image element. */
const TARGET_FIELD = { thing: "usesGroup", math: "usesMath", image: "usesImage" };

const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "warn" });
try {
  const { generateSpec, promptVariants } = await server.ssrLoadModule("/src/llm/compile.ts");
  const { routeTemplates } = await server.ssrLoadModule("/src/llm/router.ts");
  const { ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } = await server.ssrLoadModule("/src/scenes/packs.ts");
  const { scenes } = await server.ssrLoadModule("/src/scenes/registry.ts");
  const { resolveIcons } = await server.ssrLoadModule("/src/render/icon.ts");
  const { decodeIcon } = await server.ssrLoadModule("/src/spec/trace.ts");
  const { seedBlock } = await server.ssrLoadModule("/src/llm/seed.ts");
  const { resetCallLedger, callLedger, costSummary, formatCost, DEFAULT_MODEL } = await server.ssrLoadModule("/src/llm/client.ts");
  await ensureEnabledPacks(Object.keys(PACK_DEFS).filter((id) => !DEFAULT_OFF_PACKS.has(id)));
  const ready = new Set(Object.keys(scenes).filter((id) => scenes[id].manifest.status === "ready"));
  const model = modelOpt ?? DEFAULT_MODEL;
  const variant = promptVariants()[0];

  const cases = limit > 0 ? CASES.slice(0, limit) : [];
  console.log(`ready templates: ${ready.size}; model: ${model}; seed: ${seedOn ? "on" : "off"}; cases: ${cases.length}/${CASES.length}; out: ${outDir}`);

  const key = apiKey();
  if (limit === 0 || !key) {
    console.log(!key ? "no ANTHROPIC_API_KEY (env or .env) — would run the API above; exiting without calling it." : "limit 0 — would run the cases above; exiting without calling the API.");
    process.exitCode = 0;
  } else {
    mkdirSync(outDir, { recursive: true });

    // Task 13's Part B fetchSeed, built here for node so the eval can turn
    // `--seed on` on today even though compile.ts/main.ts don't wire this
    // themselves yet: a throwaway one-icon spec, resolved for real (real
    // fetch — resolveIcons's default deps are globalThis.fetch, present in
    // node 18+), then folded into a seed block. Null on any miss.
    const fetchSeed = async (subject, signal) => {
      const spec = { elements: [{ id: "seed_icon", type: "icon", of: subject, x: 0, y: 0 }], commands: [] };
      const r = await resolveIcons(spec, undefined, { forSeed: true });
      const el = spec.elements[0];
      const rings = el.strokes ? decodeIcon(el.strokes) : null;
      return r[0]?.ok && rings ? seedBlock(subject, rings, el.credit ?? "") : null;
    };

    const route = (request, signal) => routeTemplates(request, { apiKey: key, model: undefined, signal });

    const records = [];
    let i = 0;
    for (const [label, request] of cases) {
      i++;
      resetCallLedger();
      const t0 = Date.now();
      const outcome = await generateSpec(request, {
        apiKey: key,
        model,
        variant,
        exemplars: [],
        route,
        fetchSeed: seedOn ? fetchSeed : undefined,
        pedagogyReview: true,
        effort: "high",
        executeCode: false,
      });
      const ms = Date.now() - t0;
      const cost = costSummary(callLedger());
      const spec = outcome.spec;
      const elements = spec?.elements ?? [];
      const usesAt = elements.some((e) => e.at?.ref);
      const usesGroup = elements.some((e) => e.type === "group");
      const usesFit = elements.some((e) => e.type === "group" && e.fit);
      const usesMath = elements.some((e) => e.type === "math");
      const usesImage = elements.some((e) => e.type === "image");
      const usesIcon = elements.some((e) => e.type === "icon");
      const lastRound = outcome.rounds[outcome.rounds.length - 1];
      const lintIssues = lastRound?.lintIssues ?? [];
      const lintErrors = lintIssues.filter((iss) => iss.severity === "error").length;
      const lintWarns = lintIssues.filter((iss) => iss.severity === "warn").length;
      const record = {
        label,
        request,
        template: spec?.template ?? null,
        rounds: outcome.rounds.map((r) => r.label),
        seeded: outcome.seeded ?? false,
        lintErrors,
        lintWarns,
        ms,
        cost: cost.usd,
        usesAt,
        usesGroup,
        usesFit,
        usesMath,
        usesImage,
        usesIcon,
      };
      if (outcome.error) record.error = outcome.error;
      records.push(record);
      writeFileSync(`${outDir}/${i}.json`, JSON.stringify(spec, null, 1));
      console.log(
        `${i}. [${label}] ${lintErrors === 0 ? "ok" : "LINT-ERROR"} ${ms}ms ${formatCost(cost) || "—"} rounds=${record.rounds.join(">")}` +
          `${record.seeded ? " seeded" : ""} template=${record.template ?? "none"} "${request.slice(0, 50)}"`,
      );
    }

    console.log("\nlabel      pass  lintErr lintWarn  ms(med)  target-field hits");
    let anyLintError = false;
    let anyLabelFailed = false;
    const allMs = [];
    for (const l of Object.keys(TARGET_FIELD)) {
      const rs = records.filter((r) => r.label === l);
      if (rs.length === 0) continue;
      const field = TARGET_FIELD[l];
      const hits = rs.filter((r) => r[field]).length;
      const lintErr = rs.reduce((s, r) => s + r.lintErrors, 0);
      const lintWarn = rs.reduce((s, r) => s + r.lintWarns, 0);
      const mses = rs.map((r) => r.ms).sort((a, b) => a - b);
      allMs.push(...mses);
      const median = mses[Math.floor(mses.length / 2)];
      if (lintErr > 0) anyLintError = true;
      const labelPass = hits >= 3;
      if (!labelPass) anyLabelFailed = true;
      console.log(`${l.padEnd(10)} ${labelPass ? "PASS" : "FAIL"}  ${String(lintErr).padStart(7)} ${String(lintWarn).padStart(8)}  ${String(median).padStart(7)}  ${hits}/${rs.length} (${field})`);
    }
    const overallMedian = allMs.length > 0 ? allMs.sort((a, b) => a - b)[Math.floor(allMs.length / 2)] : 0;
    const medianOk = overallMedian < 90_000;
    const pass = !anyLintError && !anyLabelFailed && medianOk;
    console.log(`\noverall median ${overallMedian}ms (< 90000 required: ${medianOk ? "ok" : "FAIL"})`);
    console.log(pass ? "PASS" : "FAIL");
    writeFileSync(`${outDir}/records.json`, JSON.stringify(records, null, 1));
    if (!pass) process.exitCode = 1;
  }
} finally {
  await server.close();
}
