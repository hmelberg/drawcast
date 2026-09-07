// The template-selector bench (templates design §5a, template-on-demand
// step 2): for every request whose intended template is KNOWN — the bundled
// examples, the fewshots, and each template's own manifest examples — ask a
// selector for its shortlist and score recall at 1 / 3 / 5. Zero tokens for
// the keyword selector; one Haiku call per case for the router.
//
//   node scripts/selector-eval.mjs                 keyword selector only
//   node scripts/selector-eval.mjs --router        + the Haiku router (ANTHROPIC_API_KEY from .env or the environment)
//   node scripts/selector-eval.mjs --router --gate 0.95   exit 1 if the router's recall@5 is below the gate
//   --set examples|fewshots|manifest|all (default all)   --limit N   --model <id>   --verbose
//
// A "freehand" set — requests no template should claim — scores the router's
// none_fits: a true "none" there is right, a template named there is a false
// claim the compiler would then have to argue with.

import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const useRouter = flag("--router");
const gate = Number(opt("--gate", "0"));
const setName = opt("--set", "all");
const limit = Number(opt("--limit", "0"));
const verbose = flag("--verbose");

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
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    return /^ANTHROPIC_API_KEY=["']?([^"'\n]+)/m.exec(env)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** The requests no template should claim (the template-on-demand spike's five, plus everyday things). */
const FREEHAND = [
  "Explain how a bicycle pump works.",
  "Show the parts of a castle and what each was for.",
  "Explain how a lock and key work.",
  "Draw a cat and explain why cats purr.",
  "Explain the layers of the atmosphere.",
  "Show the parts of a sailing boat.",
];

const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "warn" });
try {
  const { scenes } = await server.ssrLoadModule("/src/scenes/registry.ts");
  const { ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } = await server.ssrLoadModule("/src/scenes/packs.ts");
  const { selectTemplates, routerIndexText, HOT_SHORTLIST } = await server.ssrLoadModule("/src/scenes/catalog.ts");
  await ensureEnabledPacks(Object.keys(PACK_DEFS).filter((id) => !DEFAULT_OFF_PACKS.has(id)));
  const ready = new Set(Object.keys(scenes).filter((id) => scenes[id].manifest.status === "ready"));

  // ---- cases ------------------------------------------------------------
  const examples = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8"));
  const fewshots = JSON.parse(readFileSync(new URL("../src/llm/prompts/fewshots.json", import.meta.url), "utf8"));
  const sets = {
    examples: examples.filter((e) => e.spec?.template && ready.has(e.spec.template)).map((e) => ({ request: e.request, want: e.spec.template })),
    fewshots: fewshots.filter((e) => e.spec?.template && ready.has(e.spec.template)).map((e) => ({ request: e.request, want: e.spec.template })),
    manifest: [...ready].flatMap((id) => scenes[id].manifest.examples.map((ex) => ({ request: ex.request, want: id }))),
  };
  let cases = setName === "all" ? [...sets.examples, ...sets.fewshots, ...sets.manifest] : (sets[setName] ?? []);
  if (limit > 0) cases = cases.slice(0, limit);
  console.log(`ready templates: ${ready.size}; cases: ${cases.length} (examples ${sets.examples.length}, fewshots ${sets.fewshots.length}, manifest ${sets.manifest.length}); index ≈ ${Math.round(routerIndexText().length / 3.7)} tokens`);

  const score = (name, picksOf) => {
    const at = { 1: 0, 3: 0, 5: 0 };
    const misses = [];
    for (const c of cases) {
      const picks = picksOf(c);
      const i = picks.indexOf(c.want);
      for (const n of [1, 3, 5]) if (i >= 0 && i < n) at[n]++;
      if (i < 0 || i >= 5) misses.push(`${c.want} ← "${c.request.slice(0, 70)}" (got ${picks.slice(0, 3).join(",") || "none"})`);
    }
    const pct = (n) => `${((100 * at[n]) / cases.length).toFixed(1)} %`;
    console.log(`\n${name}: recall@1 ${pct(1)}  recall@3 ${pct(3)}  recall@5 ${pct(5)}  (${at[5]}/${cases.length} in top 5)`);
    if (verbose || misses.length <= 40) console.log("misses outside top 5:\n  " + (misses.join("\n  ") || "none"));
    else console.log(`${misses.length} misses outside top 5 (--verbose lists them)`);
    return at[5] / cases.length;
  };

  // ---- keyword selector (zero tokens) ------------------------------------
  score("keyword selector", (c) => selectTemplates(c.request, HOT_SHORTLIST));

  // ---- the router ---------------------------------------------------------
  if (useRouter) {
    const key = apiKey();
    if (!key) throw new Error("--router needs ANTHROPIC_API_KEY (env or .env)");
    const { routeTemplates } = await server.ssrLoadModule("/src/llm/router.ts");
    const model = opt("--model", undefined);
    const results = new Map();
    let inTok = 0, outTok = 0, ms = 0, failures = 0;
    const all = [...cases, ...FREEHAND.map((request) => ({ request, want: null }))];
    const CONCURRENCY = 4;
    let next = 0;
    const worker = async () => {
      while (next < all.length) {
        const c = all[next++];
        try {
          const r = await routeTemplates(c.request, { apiKey: key, model });
          results.set(c.request, r);
          inTok += r.meta?.inputTokens ?? 0;
          outTok += r.meta?.outputTokens ?? 0;
          ms += r.meta?.ms ?? 0;
        } catch (err) {
          failures++;
          results.set(c.request, { ids: [], noneFits: false, error: String(err).slice(0, 120) });
        }
        if (results.size % 25 === 0) process.stderr.write(`  routed ${results.size}/${all.length}\n`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    score(`router (${model ?? "default model"})`, (c) => results.get(c.request)?.ids ?? []);
    // What the compiler actually sees in full: the router's picks, then the
    // keyword selector's, up to HOT_SHORTLIST (catalog.ts catalogParts).
    const routerRecall = score("router ∪ keyword (the shipped shortlist)", (c) => {
      const routed = results.get(c.request)?.ids ?? [];
      return [...new Set([...routed, ...selectTemplates(c.request, HOT_SHORTLIST)])].slice(0, HOT_SHORTLIST);
    });
    const noneOnKnown = cases.filter((c) => results.get(c.request)?.noneFits).length;
    const freehandNone = FREEHAND.filter((r) => results.get(r)?.noneFits).length;
    const freehandClaims = FREEHAND.filter((r) => (results.get(r)?.ids ?? []).length > 0).map((r) => `"${r.slice(0, 40)}" → ${results.get(r).ids.slice(0, 3).join(",")}`);
    console.log(`\nnone_fits on cases WITH a template: ${noneOnKnown}/${cases.length}; on the ${FREEHAND.length} freehand requests: ${freehandNone} none, ${freehandClaims.length} claimed a template${freehandClaims.length ? ":\n  " + freehandClaims.join("\n  ") : ""}`);
    console.log(`router cost: ${all.length} calls, ${failures} failed, avg ${Math.round(ms / Math.max(1, all.length - failures))} ms, ${inTok} uncached input tokens + ${outTok} output tokens in total`);
    if (gate > 0 && routerRecall < gate) {
      console.log(`\nGATE FAILED: router recall@5 ${(100 * routerRecall).toFixed(1)} % < ${100 * gate} %`);
      process.exitCode = 1;
    }
  }
} finally {
  await server.close();
}
