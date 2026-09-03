// Task 8 — the race performance harness and per-stage runtime lint.
//
// CONTROLLER RULING (2026-09-03): the brief called for a Playwright driver.
// Playwright is not a dependency of this repo (no `playwright` or
// `@playwright/test` in package.json — earlier rounds drove Chrome through an
// MCP tool instead of a project dependency), and adding it here would mean a
// new dev dependency plus a browser download to run one gate. So this is a
// NODE harness instead, and it is honest about what it measures:
//
//   §7.3 of the design spec says a tween frame does two things: re-run the
//   template's `layoutSpec` for the new stage, and build the rough.js path
//   geometry for every drawable that layout produced (src/render/index.ts:191,
//   svg-backend.ts:833). Layout alone is already measured at 0.25 ms/frame for
//   20 bars over 40 stages — the rough.js path build was the unknown. roughjs'
//   generator (`rough.generator()`) computes that same geometry with no DOM at
//   all — `RoughSVG.circle/rectangle/polygon/path/linearPath` (bin/svg.js) each
//   just call the identically-named `RoughGenerator` method to get a Drawable,
//   then hand it to `.draw()`, which is DOM-only bookkeeping (createElementNS +
//   setAttribute) over sets `RoughGenerator` already computed. `toPaths()` does
//   the same `opsToPath` string-building `.draw()` does, minus the DOM nodes.
//   So `generator.<method>() + generator.toPaths()` is a faithful proxy for the
//   CPU-heavy half of a tween frame, runnable headless.
//
//   What this script reports is therefore a CPU-TIME PROXY, not measured fps
//   in a real browser. It EXCLUDES: DOM node construction and attachment
//   (createElementNS/setAttribute per path — real work `.draw()` does that
//   `.toPaths()` skips), browser layout/paint, and GPU compositing. Treat the
//   numbers as "the floor a browser frame cannot beat," not as fps.
//
// The script also runs the per-stage runtime lint (design spec §7.3 / bar-race
// ledger): the offline `examples.test.ts` only ever lays out a spec at its
// resting stage (or the exact integer stage an `animate` command names), so it
// can never see an overlap that exists only strictly between two integer
// stages. This script checks EVERY integer stage of a race, and 12 fractional
// stages sampled across it, and asserts `layoutSpec(spec, stage).issues` is
// empty — for a synthetic 20-racer/60-stage race, and for every genuinely
// staged bar_race and line_chart example bundled in the data pack, read from
// the registered template manifests (not hand-copied) so the shipped
// few-shots stay covered.
//
// EXPECTED-CROSSING EXEMPTION (implements a recorded ruling, T5-A, from this
// round — not a weakening added to get this gate green). When two racers'
// interpolated ranks cross, they occupy the same row for the frame of the
// crossing and their names/values coincide there: that is what an overtake
// looks like, and the alternative is the rank-snapping bar_race exists to
// avoid (its own manifest description says so). The evidence standard T5-A
// set is "every INTEGER stage lints clean" — integer stages are where a
// viewer pauses, scrubs and reads, and there is no rank interpolation at an
// integer stage at all (ranks are a plain sort there), so two racers can
// never legitimately share a row at one. So: at every INTEGER stage, ANY
// issue fails, no exemption. At a FRACTIONAL stage, an `overlap-label-label`
// between two DIFFERENT racers' own labels (the `race_<n>` / `race_<n>_text`
// / `race_<n>_value` id family) is counted as an expected crossing and does
// NOT fail; every other issue at a fractional stage still fails, including
// out-of-canvas, font-too-small, overlap-label-stroke, and any overlap that
// touches furniture (axes, ticker, title, note) or two sub-drawables of the
// SAME racer. A crossing is two racers passing each other; a label colliding
// with the furniture, or with itself, is not. Expected-crossing counts are
// printed per race so a reader can see the gate is discriminating rather than
// blind — an implausibly high count is worth a human's eye.
//
// SELF-CHECK (proves the exemption still refuses a real collision). Every
// bar_race template tried against a real furniture overlap has come back
// clean — its clearsTicker fallback (data.yaml) is, empirically, airtight —
// so this file has no positive case of its own proving isExpectedCrossing
// actually refuses a non-racer overlap rather than accidentally exempting
// everything. So the script defines one minimal, deliberately-broken scene
// entirely in this file (never touching src/ or a bundled example) that
// reuses the race_<n> id family and places a value label directly on a
// ticker-like furniture box past a threshold stage, with NO avoidance — on
// purpose, permanently. Its expectation is INVERTED: it is required to FAIL
// checkRace. If it ever stops failing, the exemption has drifted too wide,
// and that is reported as the gate's real failure.
//
// Runs the real app code: a Vite SSR module graph (`server.ssrLoadModule`) —
// the same mechanism vite-node/Vitest use — loads src/layout/layout.ts,
// src/scenes/registry.ts etc. directly from TypeScript/`?raw` YAML, so this is
// the actual layout and template-registration pipeline, not a reimplementation
// of it. `vite` is already a devDependency; no new dependency is added.
//
// Usage: node scripts/smoke-race.mjs
// Exit code: non-zero ONLY when the per-stage lint finds an issue. The
// performance number is never a hard failure (machines differ) — it is
// printed prominently instead, for a human to read and record.

import { createServer } from "vite";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import rough from "roughjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------------------
// Mirrored svg-backend internals. These four helpers are PRIVATE (unexported)
// in src/render/svg-backend.ts, and drawLeaf()'s rough-generation branch is
// itself not a separately callable unit — so this section hand-mirrors that
// branch instead of importing it. Kept in lockstep by inspection, not by
// import: hashSeed mirrors svg-backend.ts:74 exactly (the task brief's own
// instruction — "the SVG backend derives each drawable's rough seed from
// hashSeed(drawable.id) ... mirror that when generating, so your measurement
// reflects real work rather than a degenerate cache-friendly case"),
// pathFromPts/dashedPathFromPts mirror svg-backend.ts:123-153, arrowheadPts
// mirrors svg-backend.ts:208-226 (line numbers as of this task's commit; see
// drawLeaf() there for the source of truth if this ever needs re-checking).
// ---------------------------------------------------------------------------

function hashSeed(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

function pathFromPts(pts, closed, toSvgY) {
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${toSvgY(y).toFixed(1)}`).join(" ");
  return closed ? `${d} Z` : d;
}

function dashedPathFromPts(pts, toSvgY, dash = 11, gap = 9) {
  const parts = [];
  let carry = 0;
  let drawing = true;
  for (let i = 0; i + 1 < pts.length; i++) {
    let [x, y] = pts[i];
    const [x1, y1] = pts[i + 1];
    let segLen = Math.hypot(x1 - x, y1 - y);
    const ux = (x1 - x) / (segLen || 1);
    const uy = (y1 - y) / (segLen || 1);
    while (segLen > 0) {
      const need = (drawing ? dash : gap) - carry;
      const step = Math.min(need, segLen);
      const nx = x + ux * step;
      const ny = y + uy * step;
      if (drawing) parts.push(`M${x.toFixed(1)} ${toSvgY(y).toFixed(1)} L${nx.toFixed(1)} ${toSvgY(ny).toFixed(1)}`);
      x = nx;
      y = ny;
      segLen -= step;
      carry += step;
      if (carry >= (drawing ? dash : gap) - 1e-6) {
        carry = 0;
        drawing = !drawing;
      }
    }
  }
  return parts.join(" ");
}

function arrowheadPts(pts, at) {
  if (pts.length < 2) return null;
  const [tip, prev] = at === "end" ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
  const dx = tip[0] - prev[0];
  const dy = tip[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = 13;
  const spread = 0.45;
  const left = [
    tip[0] - size * (ux * Math.cos(spread) - uy * Math.sin(spread)),
    tip[1] - size * (uy * Math.cos(spread) + ux * Math.sin(spread)),
  ];
  const right = [
    tip[0] - size * (ux * Math.cos(spread) + uy * Math.sin(spread)),
    tip[1] - size * (uy * Math.cos(spread) - ux * Math.sin(spread)),
  ];
  return [left, tip, right];
}

function roughOpts(d, extra = {}) {
  return {
    roughness: d.style.roughness,
    stroke: d.style.color,
    strokeWidth: d.style.strokeWidth,
    seed: hashSeed(d.id),
    bowing: 0.9,
    ...extra,
  };
}

/**
 * Runs the rough.js generation for one frame's worth of leaf drawables,
 * exactly as drawLeaf() (src/render/svg-backend.ts) would for the "sketchy"
 * backend — same generator methods, same options, same seed derivation, same
 * skip of exact areas and of text/image leaves (neither is rough-drawn).
 * Discards the geometry; only the CPU cost is wanted. Returns how many rough
 * generation calls the frame made, for the report.
 */
function roughGenerateFrame(generator, toSvgY, isExactArea, drawables) {
  let calls = 0;
  for (const d of drawables) {
    if (d.kind === "text" || d.kind === "image") continue;
    if (d.kind === "area") {
      if (isExactArea(d)) continue; // exact areas skip rough.js entirely in the real backend too
      const node = generator.polygon(
        d.pts.map(([x, y]) => [x, toSvgY(y)]),
        roughOpts(d, { fill: d.style.fill ?? d.style.color, fillStyle: "hachure", hachureGap: 5.5, fillWeight: 1.7, strokeWidth: 1.8 }),
      );
      generator.toPaths(node);
      calls++;
      continue;
    }
    // kind === "stroke"
    const opts = roughOpts(d);
    if (d.shapeHint?.type === "circle") {
      const { c, r } = d.shapeHint;
      const fillPaint = d.style.fillGradient ? "url(#proxy-gradient)" : d.style.fill;
      const node = generator.circle(c[0], toSvgY(c[1]), r * 2, fillPaint ? { ...opts, fill: fillPaint, fillStyle: "solid" } : opts);
      generator.toPaths(node);
      calls++;
    } else if (d.shapeHint?.type === "rect") {
      const node = generator.rectangle(d.shapeHint.x, toSvgY(d.shapeHint.y + d.shapeHint.h), d.shapeHint.w, d.shapeHint.h, opts);
      generator.toPaths(node);
      calls++;
    } else if (d.pts.length >= 2) {
      const dStr = d.style.dash ? dashedPathFromPts(d.pts, toSvgY) : pathFromPts(d.pts, d.closed, toSvgY);
      const node = generator.path(dStr, opts);
      generator.toPaths(node);
      calls++;
    }
    if (d.arrowhead && d.pts.length >= 2) {
      const heads = d.arrowhead === "both" ? ["start", "end"] : [d.arrowhead];
      for (const at of heads) {
        const tri = arrowheadPts(d.pts, at);
        if (tri) {
          const node = generator.linearPath(tri.map(([x, y]) => [x, toSvgY(y)]), opts);
          generator.toPaths(node);
          calls++;
        }
      }
    }
  }
  return calls;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so the synthetic race — and therefore the
// measured numbers — is reproducible run to run.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 20-racer bar_race over 60 stages. Growth rates and starting values vary
 * per racer, with noise on top, so ranks genuinely shuffle across the race —
 * this is not a degenerate always-sorted field. `top_n` equals the racer
 * count so all 20 bars draw every frame (no airlock row): the heaviest
 * per-frame cardinality this template allows for 20 racers, matching §7.3's
 * own "20 bars" reference measurement.
 */
function buildSyntheticRace(rng, racers = 20, stages = 60) {
  const rates = Array.from({ length: racers }, () => 1 + rng() * 0.06); // ~1.00-1.06 compounding per stage
  const starts = Array.from({ length: racers }, () => 20 + rng() * 80); // 20-100 start
  const noiseAmp = Array.from({ length: racers }, () => 0.5 + rng() * 2);
  const values = [];
  for (let k = 0; k < stages; k++) {
    const row = [];
    for (let i = 0; i < racers; i++) {
      const grown = starts[i] * Math.pow(rates[i], k);
      const noise = (rng() - 0.5) * 2 * noiseAmp[i];
      row.push(Math.max(0.1, grown + noise));
    }
    values.push(row);
  }
  return {
    labels: Array.from({ length: racers }, (_, i) => `Racer ${i + 1}`),
    values,
    ticker: Array.from({ length: stages }, (_, k) => String(1960 + k)),
    top_n: racers,
    order: "rank",
    x_label: "Score",
    title: "Synthetic 20-racer smoke race",
  };
}

/** n evenly spaced fractional midpoints strictly inside (0, maxStage) — the
 *  animate verb re-runs layout at every rAF tick, so a frame landing exactly
 *  on an integer stage is the UNusual case, not the workload. */
function midpointStages(maxStage, n) {
  if (maxStage <= 0) return [0];
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * maxStage);
}

/** Every integer stage from 0 to maxStage inclusive — the frames a viewer
 *  actually pauses, scrubs and reads (T5-A's evidence standard). */
function integerStages(maxStage) {
  return Array.from({ length: Math.floor(maxStage) + 1 }, (_, k) => k);
}

/** A bar_race racer's own drawable id — its bar (`race_<n>`) or a
 *  `race_<n>_text` / `race_<n>_value` sub-drawable (SUB_SUFFIXES,
 *  src/layout/model.ts). Returns the racer's numeric index, or null for any
 *  other id (axes, ticker, title, note, ...). */
function racerIndex(id) {
  const m = /^race_(\d+)(?:_text|_value)?$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * True for the ONE class of issue T5-A accepts: an overlap-label-label
 * between two DIFFERENT racers' own labels, at a fractional stage. See the
 * header comment for the ruling and the reasoning. Two sub-drawables of the
 * SAME racer overlapping each other (ra === rb) is a real defect, not a
 * crossing, and is deliberately NOT exempted here.
 */
function isExpectedCrossing(issue) {
  if (issue.rule !== "overlap-label-label") return false;
  const [ra, rb] = issue.ids.map(racerIndex);
  return ra !== null && rb !== null && ra !== rb;
}

function median(sorted) {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function fmt(ms) {
  return `${ms.toFixed(3)} ms`;
}

async function main() {
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });

  let lintFailures = [];

  try {
    const { layoutSpec } = await server.ssrLoadModule("/src/layout/layout.ts");
    const { leafDrawables } = await server.ssrLoadModule("/src/layout/model.ts");
    const { toSvgY } = await server.ssrLoadModule("/src/layout/canvas.ts");
    const { isExactArea } = await server.ssrLoadModule("/src/render/svg-backend.ts");
    const { registerPack } = await server.ssrLoadModule("/src/scenes/packs.ts");
    const { scenes } = await server.ssrLoadModule("/src/scenes/registry.ts");
    const { sliderSpecs } = await server.ssrLoadModule("/src/ui/tray-model.ts");
    const dataYamlMod = await server.ssrLoadModule("/src/scenes/packs/data.yaml?raw");

    const reg = registerPack("data", dataYamlMod.default);
    if (!reg.ok) {
      console.error("FATAL: could not register the data pack:", reg.errors);
      process.exitCode = 1;
      return;
    }

    const generator = rough.generator();

    // =========================================================================
    // Part 1 — performance measurement (CPU-time proxy)
    // =========================================================================
    console.log("=".repeat(78));
    console.log("RACE PERFORMANCE — CPU-time proxy (Node): layout + rough.js path generation");
    console.log("=".repeat(78));

    const RACERS = 20;
    const STAGES = 60;
    const race = buildSyntheticRace(mulberry32(20260903), RACERS, STAGES);
    const maxStage = STAGES - 1;

    const runFrame = (stage) => {
      const t0 = performance.now();
      const layout = layoutSpec({ template: "bar_race", params: { ...race, stage } });
      const t1 = performance.now();
      const calls = roughGenerateFrame(generator, toSvgY, isExactArea, leafDrawables(layout.drawables));
      const t2 = performance.now();
      return { layoutMs: t1 - t0, roughMs: t2 - t1, totalMs: t2 - t0, calls };
    };

    const WARMUP = 30;
    for (let i = 0; i < WARMUP; i++) runFrame((i / WARMUP) * maxStage);

    const SAMPLES = 240;
    const frames = [];
    for (let i = 0; i < SAMPLES; i++) frames.push(runFrame(((i + 0.5) / SAMPLES) * maxStage));

    const totals = frames.map((f) => f.totalMs).sort((a, b) => a - b);
    const layouts = frames.map((f) => f.layoutMs).sort((a, b) => a - b);
    const roughs = frames.map((f) => f.roughMs).sort((a, b) => a - b);
    const avgCalls = frames.reduce((s, f) => s + f.calls, 0) / frames.length;

    const medTotal = median(totals);
    const worstTotal = totals[totals.length - 1];
    const p95Total = totals[Math.floor(totals.length * 0.95)];

    console.log(`${SAMPLES} frames sampled at fractional stages (${WARMUP} warmup frames discarded first) over a ${RACERS}-racer / ${STAGES}-stage bar_race, top_n=${RACERS} (every racer drawn every frame).`);
    console.log(`  avg rough.js generation calls/frame: ${avgCalls.toFixed(1)} (bars + axis stroke + arrowhead)`);
    console.log("");
    console.log(`  layout only   (layoutSpec)        median ${fmt(median(layouts))}   worst ${fmt(layouts[layouts.length - 1])}`);
    console.log(`  rough.js gen  (generator.toPaths) median ${fmt(median(roughs))}   worst ${fmt(roughs[roughs.length - 1])}`);
    console.log("");
    console.log(`  RESULT: median ${fmt(medTotal)} / worst ${fmt(worstTotal)} per frame of layout + rough.js path generation (p95 ${fmt(p95Total)}).`);
    console.log("");
    for (const [label, budget] of [["16.7 ms (the 60 fps frame budget)", 16.7], ["20 ms (the §7.3 gate's 50 fps frame budget)", 20]]) {
      const medOk = medTotal <= budget;
      const worstOk = worstTotal <= budget;
      console.log(
        `  headroom vs ${label}: median leaves ${(budget - medTotal).toFixed(2)} ms (${medOk ? "fits" : "OVER budget"}); ` +
          `worst-case leaves ${(budget - worstTotal).toFixed(2)} ms (${worstOk ? "fits" : "OVER budget"})`,
      );
    }
    console.log("");
    console.log("  This is a CPU-TIME PROXY measured in Node — it is NOT a frames-per-second");
    console.log("  figure and is never converted into one. It EXCLUDES: DOM node construction");
    console.log("  and attachment (createElementNS + setAttribute per path — real work .draw()");
    console.log("  does that .toPaths() skips), browser layout/paint, and GPU compositing. What");
    console.log("  matters is the headroom against 16.7 ms above, not a derived rate. Record the");
    console.log("  median/worst ms above in the ledger — do not restate them as an fps number.");
    console.log("=".repeat(78));
    console.log("");

    // =========================================================================
    // Part 2 — per-stage runtime lint
    // =========================================================================
    console.log("PER-STAGE RUNTIME LINT — layoutSpec(spec, stage).issues, every integer stage");
    console.log("plus 12 fractional stages, with the T5-A expected-crossing exemption applied");
    console.log("only at fractional stages (see header comment for the ruling).");
    console.log("-".repeat(78));

    const LINT_SAMPLES = 12;
    const fmtIssue = (i) => `[${i.severity}] ${i.rule}: ${i.message}`;

    /**
     * Checks one race (a template + params, over its own maxStage) against
     * the T5-A standard: every INTEGER stage must lint fully clean (no
     * exemption at all); every FRACTIONAL stage must lint clean once expected
     * crossings (isExpectedCrossing) are set aside. Returns the real
     * (non-exempt) failures found and how many expected crossings it saw —
     * the caller decides what to do with them (a normal race pushes real
     * failures onto `lintFailures`; the self-check below inverts that).
     */
    const checkRace = (template, params, raceMaxStage) => {
      let crossings = 0;
      const realFailures = [];
      for (const stage of integerStages(raceMaxStage)) {
        const l = layoutSpec({ template, params: { ...params, stage } });
        if (l.issues.length > 0) realFailures.push({ stage, kind: "integer", issues: l.issues.map(fmtIssue) });
      }
      for (const stage of midpointStages(raceMaxStage, LINT_SAMPLES)) {
        const l = layoutSpec({ template, params: { ...params, stage } });
        const real = [];
        for (const issue of l.issues) {
          if (isExpectedCrossing(issue)) crossings++;
          else real.push(issue);
        }
        if (real.length > 0) realFailures.push({ stage, kind: "fractional", issues: real.map(fmtIssue) });
      }
      return { crossings, realFailures };
    };

    const recordRace = (label, template, params, raceMaxStage) => {
      const { crossings, realFailures } = checkRace(template, params, raceMaxStage);
      for (const f of realFailures) lintFailures.push({ label, ...f });
      return crossings;
    };

    // The synthetic race itself.
    {
      const crossings = recordRace("synthetic 20-racer race", "bar_race", race, maxStage);
      console.log(
        `  synthetic 20-racer/60-stage race: ${maxStage + 1} integer stages + ${LINT_SAMPLES} fractional stages checked — expected crossings: ${crossings}`,
      );
    }

    // Every bundled bar_race / line_chart example that is genuinely staged
    // (a stage slider exists — sliderSpecs is the app's own derivation of
    // that, src/ui/tray-model.ts), read straight off the registered manifest.
    // A single-stage example has only one frame to ever lay out, and that
    // frame is already exhaustively covered by tests/examples.test.ts, so it
    // is skipped here as redundant rather than re-checked at N copies of the
    // same stage.
    let exampleCount = 0;
    for (const templateId of ["bar_race", "line_chart"]) {
      const manifest = scenes[templateId]?.manifest;
      if (!manifest) {
        console.error(`  FATAL: template "${templateId}" is not registered — the data pack failed to load it`);
        process.exitCode = 1;
        continue;
      }
      const examples = manifest.examples ?? [];
      for (const ex of examples) {
        const sliders = sliderSpecs(manifest.params_schema, ex.params);
        const stageSlider = sliders.find((s) => s.path === "stage");
        if (!stageSlider) continue; // single-stage example — covered by examples.test.ts already
        exampleCount++;
        const crossings = recordRace(`${templateId} example: "${ex.request}"`, templateId, ex.params, stageSlider.max);
        const title = ex.request.length > 56 ? `${ex.request.slice(0, 56)}…` : ex.request;
        console.log(
          `  ${templateId} example "${title}" (max stage ${stageSlider.max}): ${stageSlider.max + 1} integer + ${LINT_SAMPLES} fractional stages checked — expected crossings: ${crossings}`,
        );
      }
    }
    console.log(`  (${exampleCount} bundled staged examples covered across bar_race + line_chart)`);
    console.log("");

    // -------------------------------------------------------------------
    // Self-check: prove the exemption still refuses a REAL collision.
    //
    // Every failure demonstrated so far (fix round 1) needed a source
    // perturbation nobody ships: the real bar_race's clearsTicker fallback
    // (data.yaml) is, empirically, airtight against every legitimate params
    // combination tried — it always either repositions a value label clear
    // of the ticker or omits the label rather than draw a collision. So the
    // shipped script, run against today's real templates, has no positive
    // proof that isExpectedCrossing actually refuses a non-racer overlap —
    // only a throwaway copy of the logic, run separately, showed that.
    //
    // This fixture closes that gap without touching src/ or the bundled
    // examples (both off-limits for this harness): a minimal scene, defined
    // ENTIRELY in this file and registered directly into the in-memory
    // `scenes` registry for the duration of this run only, reusing the
    // race_<n> id family so the matcher is genuinely exercised. Below its
    // threshold stage the racer's value sits harmlessly aside (mirroring "a
    // long, late-growing bottom-row racer" before it has grown); past it,
    // the value is placed EXACTLY on the ticker's own box — deliberately,
    // permanently, with no clearsTicker-style avoidance, because avoiding it
    // is not the point: catching it is.
    //
    // The expectation is INVERTED: this fixture is REQUIRED to produce a
    // real (non-exempt) failure. If it ever stops failing, isExpectedCrossing
    // (or something upstream of it) has drifted wide enough to swallow a
    // genuine defect, and that is reported as the actual gate failure.
    // -------------------------------------------------------------------
    console.log("SELF-CHECK — harness-only adversarial fixture (not bar_race, not a bundled example, not in src/)");
    const SELF_CHECK_TEMPLATE = "__smoke_race_selfcheck";
    const SELF_CHECK_MAX_STAGE = 5;
    scenes[SELF_CHECK_TEMPLATE] = {
      manifest: {
        name: SELF_CHECK_TEMPLATE,
        status: "ready",
        description: "harness self-check fixture — never shipped, never a bundled example",
        params_schema: { type: "object", properties: {} },
        element_ids: {},
        examples: [],
      },
      layout(params) {
        const stage = typeof params.stage === "number" ? params.stage : 0;
        const N = 4;
        const drawables = [];
        const order = [];
        const push = (d) => {
          drawables.push(d);
          order.push(d.id);
        };
        const style = { color: "#3d3833", strokeWidth: 3.5, roughness: 1.4, opacity: 1 };
        const instant = { mode: "instant", duration: 0 };
        for (let i = 1; i <= N; i++) {
          const y = 100 + 90 * i; // rows at y = 190, 280, 370, 460 — all well inside the 750-tall canvas
          push({ id: `race_${i}`, kind: "area", z: 0, style: { ...style, fill: "#8a5fa8" }, drawOpts: instant, pts: [[60, y - 20], [140, y - 20], [140, y + 20], [60, y + 20]] });
          // anchor "end" at x=200 keeps the whole label (~70 units wide) inside
          // the 1000-wide canvas with margin either side of every other label.
          push({ id: `race_${i}_text`, kind: "text", z: 2, style, drawOpts: instant, pos: [200, y], text: `Racer ${i}`, fontSize: 16, anchor: "end" });
        }
        const tickerPos = [900, 90]; // bottom-right corner, mirroring bar_race's own ticker spot
        // Harmless while `stage <= 2` — parked in an empty stretch of canvas
        // nowhere near any other label (racer hasn't "grown" yet). Driven
        // EXACTLY onto the ticker's own box past the threshold — no avoidance,
        // by design: that IS the fixture, not a bug waiting to be fixed.
        const valuePos = stage > 2 ? [tickerPos[0] - 5, tickerPos[1]] : [400, 650];
        push({ id: `race_${N}_value`, kind: "text", z: 2, style, drawOpts: instant, pos: valuePos, text: "99", fontSize: 16, anchor: "start" });
        push({ id: "ticker", kind: "text", z: 2, style: { ...style, opacity: 0.4 }, drawOpts: instant, pos: tickerPos, text: "2020", fontSize: 46, anchor: "end" });
        return { drawables, order, labels: [], anchors: {} };
      },
    };
    let selfCheckOk;
    try {
      const { crossings, realFailures } = checkRace(SELF_CHECK_TEMPLATE, {}, SELF_CHECK_MAX_STAGE);
      selfCheckOk = realFailures.length > 0;
      if (selfCheckOk) {
        const first = realFailures[0];
        console.log(
          `  PASSED (as required): the fixture's racer/ticker collision was correctly flagged as a REAL, non-exempt failure ` +
            `at ${realFailures.length} of ${SELF_CHECK_MAX_STAGE + 1 + LINT_SAMPLES} sampled (integer+fractional) stage(s), e.g. ` +
            `stage ${first.stage.toFixed(2)}: ${first.issues[0]}`,
        );
        console.log(`  expected crossings incidentally seen while sweeping the fixture: ${crossings} (should be 0 — only one racer ever gets a value here)`);
        console.log("  This is positive proof isExpectedCrossing does NOT exempt a racer/furniture overlap — the gate has teeth.");
      } else {
        console.error("  SELF-CHECK FAILED — the adversarial fixture's racer/ticker collision was NOT flagged as a real issue.");
        console.error("  This means the crossing exemption (or something upstream of it) has drifted wide enough to swallow a");
        console.error("  genuine defect. Treat THIS as the gate's real failure, not a race result — the fixture is supposed to fail.");
        lintFailures.push({
          label: "SELF-CHECK (adversarial fixture)",
          stage: NaN,
          kind: "self-check",
          issues: ["expected checkRace to find a real, non-exempt issue on the fixture's racer/ticker collision; found none — the exemption has drifted too wide"],
        });
      }
    } finally {
      delete scenes[SELF_CHECK_TEMPLATE]; // never leak the fixture past this run
    }
    console.log("");

    if (lintFailures.length === 0) {
      console.log("PASS — every integer stage lints fully clean; every fractional-stage issue was an expected crossing.");
    } else {
      console.error(`FAIL — ${lintFailures.length} real (stage, issue) pair(s) found (expected crossings excluded):`);
      for (const f of lintFailures) {
        const where = Number.isNaN(f.stage) ? `${f.label} (${f.kind})` : `${f.label} @ ${f.kind} stage ${f.stage.toFixed(3)}`;
        console.error(`  ${where}:`);
        for (const issue of f.issues) console.error(`    ${issue}`);
      }
      process.exitCode = 1;
    }
    console.log("-".repeat(78));
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
