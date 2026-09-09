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
//   --baseline-median <ms>  compare this run's median against that number
//     instead of the absolute 90,000ms (see the freehand-figures ledger's
//     `## Eval` section for why: 90s is below what effort high produces
//     even on main's own baseline).
//
// generateSpec runs with executeCode: false — this node harness has no code
// runtime (no pyodide/browser), so no case here exercises the code-execution
// check; that path is covered elsewhere (tests/code/*, the real app in a browser).

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
// The absolute 90s bar (spec §7.4) turned out to sit below what effort
// high produces even on `main`'s own freehand baseline (190,416 ms median,
// no relative placement, no groups) — see the freehand-figures ledger's
// `## Eval` section. `--baseline-median <ms>`, when given, switches the
// verdict to the relative bar the ledger's ruling adopted instead: this
// run's median must beat THAT number, not the fixed 90,000 ms.
const baselineMedianOpt = opt("--baseline-median", undefined);
const baselineMedian = baselineMedianOpt !== undefined ? Number(baselineMedianOpt) : undefined;

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
  // Only modules that exist on BOTH the branch and `main` are loaded here —
  // the baseline run (plan Task 15 step 2) executes this same file against
  // `main`'s own src (see the ROOT comment above), which has none of the
  // seed machinery (src/render/icon.ts, src/llm/seed.ts don't exist there
  // at all; src/spec/trace.ts exists but without decodeIcon). Those three
  // are loaded lazily, only under `--seed on`, further down.
  const { generateSpec, promptVariants } = await server.ssrLoadModule("/src/llm/compile.ts");
  const { routeTemplates } = await server.ssrLoadModule("/src/llm/router.ts");
  const { ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } = await server.ssrLoadModule("/src/scenes/packs.ts");
  const { scenes } = await server.ssrLoadModule("/src/scenes/registry.ts");
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
    // node 18+), then folded into a seed block. Null on any miss. The three
    // modules it needs are loaded HERE, lazily, and ONLY when `--seed on` —
    // on the baseline checkout (`main`) they don't exist yet at all, and
    // this whole branch must stay unreached when running unseeded.
    let fetchSeed;
    if (seedOn) {
      try {
        const { resolveIcons } = await server.ssrLoadModule("/src/render/icon.ts");
        const { decodeIcon } = await server.ssrLoadModule("/src/spec/trace.ts");
        const { seedBlock } = await server.ssrLoadModule("/src/llm/seed.ts");
        fetchSeed = async (subject, signal) => {
          const spec = { elements: [{ id: "seed_icon", type: "icon", of: subject, x: 0, y: 0 }], commands: [] };
          const r = await resolveIcons(spec, undefined, { forSeed: true });
          const el = spec.elements[0];
          const rings = el.strokes ? decodeIcon(el.strokes) : null;
          return r[0]?.ok && rings ? seedBlock(subject, rings, el.credit ?? "") : null;
        };
      } catch {
        console.log("seed: unavailable in this checkout — running unseeded");
        fetchSeed = undefined;
      }
    }

    const route = (request, signal) => routeTemplates(request, { apiKey: key, model: undefined, signal });

    // A blank record shared by the success and failure paths below, so a
    // thrown case still has every field the table/verdict code reads
    // (false/0/null, never undefined) — it just can't hit any target field,
    // which is exactly "counts as a failed case" (findings review, fix round 1).
    const blankRecord = (label, request) => ({
      label,
      request,
      template: null,
      rounds: [],
      seeded: false,
      lintErrors: 0,
      lintWarns: 0,
      ms: 0,
      cost: 0,
      usesAt: false,
      usesGroup: false,
      usesFit: false,
      usesMath: false,
      usesImage: false,
      usesIcon: false,
    });

    const records = [];
    let i = 0;
    for (const [label, request] of cases) {
      i++;
      resetCallLedger();
      const t0 = Date.now();
      let spec = null;
      let record;
      // One bad case (an API error, a thrown validation bug, a network
      // hiccup on the seed fetch) must not abort the whole run — the point
      // of a 12-case eval is the aggregate, and a single throw shouldn't
      // erase the other 11 results.
      try {
        const outcome = await generateSpec(request, {
          apiKey: key,
          model,
          variant,
          exemplars: [],
          route,
          fetchSeed,
          pedagogyReview: true,
          effort: "high",
          executeCode: false,
        });
        const ms = Date.now() - t0;
        const cost = costSummary(callLedger());
        spec = outcome.spec;
        const elements = spec?.elements ?? [];
        const usesAt = elements.some((e) => e.at?.ref);
        const usesGroup = elements.some((e) => e.type === "group");
        const usesFit = elements.some((e) => e.type === "group" && e.fit);
        const usesMath = elements.some((e) => e.type === "math");
        const usesImage = elements.some((e) => e.type === "image");
        const usesIcon = elements.some((e) => e.type === "icon");
        // Safe to read directly: compile.ts's pedagogy round always records
        // the DELIVERED spec's lint (base, unless its candidate was actually
        // adopted), never a rejected candidate's — so the last round's
        // lintIssues describes `outcome.spec`, whichever round produced it.
        const lastRound = outcome.rounds[outcome.rounds.length - 1];
        const lintIssues = lastRound?.lintIssues ?? [];
        const lintErrors = lintIssues.filter((iss) => iss.severity === "error").length;
        const lintWarns = lintIssues.filter((iss) => iss.severity === "warn").length;
        record = {
          ...blankRecord(label, request),
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
        // A non-throwing outcome can still carry an error (compile.ts's own
        // while-loop catch returns one instead of rejecting — see the
        // ledger's `## Eval` "terminated" writeup) — that case is a miss for
        // the summary table below exactly like a lint error, so its line
        // must not print "ok" either.
        const status = lintErrors > 0 ? "LINT-ERROR" : !record.error ? "ok" : /cut off at the output limit/i.test(record.error) ? "cut off" : "error";
        console.log(
          `${i}. [${label}] ${status} ${ms}ms ${formatCost(cost) || "—"} rounds=${record.rounds.join(">")}` +
            `${record.seeded ? " seeded" : ""} template=${record.template ?? "none"} "${request.slice(0, 50)}"` +
            `${record.error ? ` (${record.error})` : ""}`,
        );
      } catch (err) {
        const ms = Date.now() - t0;
        record = { ...blankRecord(label, request), ms, error: String(err) };
        console.log(`${i}. [${label}] THREW ${ms}ms: ${record.error} "${request.slice(0, 50)}"`);
      }
      records.push(record);
      writeFileSync(`${outDir}/${i}.json`, JSON.stringify(spec, null, 1));
    }

    console.log("\nlabel      pass  lintErr lintWarn  ms(med)  target-field hits");
    let anyLintError = false;
    let anyLabelFailed = false;
    const allMs = [];
    for (const l of Object.keys(TARGET_FIELD)) {
      const rs = records.filter((r) => r.label === l);
      if (rs.length === 0) {
        // --limit smaller than 12 (or 0, handled above) can leave a label
        // with no sampled cases at all — that is not a failure of the
        // label, just nothing to score; exclude it from the verdict rather
        // than reporting a false FAIL.
        console.log(`${l.padEnd(10)} no cases`);
        continue;
      }
      const field = TARGET_FIELD[l];
      const hits = rs.filter((r) => r[field]).length;
      const lintErr = rs.reduce((s, r) => s + r.lintErrors, 0);
      const lintWarn = rs.reduce((s, r) => s + r.lintWarns, 0);
      const mses = rs.map((r) => r.ms).sort((a, b) => a - b);
      allMs.push(...mses);
      const median = mses[Math.floor(mses.length / 2)];
      if (lintErr > 0) anyLintError = true;
      // The real gate is "≥ 3 of 4"; under a smaller --limit sample there
      // may be fewer than 4 cases for this label at all, so the bar can
      // never exceed the sample size — otherwise every --limit run below 4
      // would fail this label by construction, regardless of quality.
      const labelPass = hits >= Math.min(3, rs.length);
      if (!labelPass) anyLabelFailed = true;
      console.log(`${l.padEnd(10)} ${labelPass ? "PASS" : "FAIL"}  ${String(lintErr).padStart(7)} ${String(lintWarn).padStart(8)}  ${String(median).padStart(7)}  ${hits}/${rs.length} (${field})`);
    }
    const overallMedian = allMs.length > 0 ? allMs.sort((a, b) => a - b)[Math.floor(allMs.length / 2)] : 0;
    // Absolute bar (spec §7.4, default): 90s. Relative bar (the ledger's
    // ruling, once a --baseline-median is on hand): beat THAT run's median
    // instead — see the option's comment above for why the absolute number
    // alone is not a fair bar at effort high.
    const timingBar = baselineMedian !== undefined ? baselineMedian : 90_000;
    const timingBarLabel = baselineMedian !== undefined ? `< baseline median ${baselineMedian}ms` : "< 90000ms (absolute)";
    const medianOk = overallMedian < timingBar;
    const pass = !anyLintError && !anyLabelFailed && medianOk;
    console.log(`\noverall median ${overallMedian}ms (${timingBarLabel} required: ${medianOk ? "ok" : "FAIL"})`);
    console.log(pass ? "PASS" : "FAIL");
    writeFileSync(`${outDir}/records.json`, JSON.stringify(records, null, 1));
    if (!pass) process.exitCode = 1;
  }
} finally {
  await server.close();
}
