// Task 12 — the round-wide verification sweep over every example this round
// (2026-09-03 charts round) added or changed: the stacked-bars bar_chart
// example, the slope/Simpson line_chart example, every bar_race manifest
// example, the line-race chess line_chart example, every heatmap example
// (manifest + bundled), and the six code-fed retrofit examples
// (distribution_curve, forest_plot, survival_curve, ceac, did_trends,
// event_study).
//
// Two data sources, per the task brief, so nothing here is hand-retyped:
//   - a template's OWN manifest examples (`scenes[tid].manifest.examples`,
//     read straight off the registered pack — the same field the compiler's
//     catalog shows as few-shots), for bar_chart/line_chart/bar_race/heatmap;
//   - the bundled examples list (`src/examples.json`), for the six retrofit
//     templates, which only ever gained a manifest-example there (their pack
//     manifests keep their original two typed examples unchanged).
//
// bar_race and line_chart's staged race examples are already swept
// exhaustively, per integer AND fractional stage, by scripts/smoke-race.mjs
// (Task 8) — every bar_race manifest example (5, not the "both" the Task 12
// brief assumed) and the line_chart chess example, read the same way, off
// the same registered manifest. Re-implementing that here would duplicate a
// harness that already carries its own reviewed T5-A crossing-exemption
// logic, so this script does not re-run it — see the Task 12 report for its
// fresh output. What THIS script covers is everything smoke-race.mjs does
// not: the examples that are NOT staged (stacked bar_chart, slope/Simpson
// line_chart, every heatmap example, the six retrofit examples), checked at
// their one resting layout, at every lint severity (not just error) — the
// same standard tests/data-pack.test.ts and tests/examples.test.ts already
// hold bundled examples to, run here directly and reported explicitly per
// example rather than folded into a pass/fail count.
//
// A duplicate-detection note, checked byte-for-byte below rather than just
// claimed (layoutSpec is a pure function of params, so an identical-params
// bundled entry adds nothing a manifest sweep didn't already cover): both
// src/examples.json heatmap entries that are not token-fed ARE identical to
// a manifest example and are skipped. The bar_race bundled "four biggest
// economies" entry is NOT identical — it adds ticker/value_labels/decimals
// on top of the manifest example's values — so it is swept independently
// here (smoke-race.mjs only ever reads the manifest, so this is the one
// bundled race example that would otherwise go unswept by either script).
//
// Exit code: non-zero if any example lints with any real issue at its
// resting stage. Never a hard perf/timing gate — there is none here.

import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fmtIssue = (i) => `[${i.severity}] ${i.rule}: ${i.message}`;

async function main() {
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });

  let failures = 0;
  const rows = [];

  try {
    const { layoutSpec } = await server.ssrLoadModule("/src/layout/layout.ts");
    const { registerPack } = await server.ssrLoadModule("/src/scenes/packs.ts");
    const { scenes } = await server.ssrLoadModule("/src/scenes/registry.ts");
    const { sliderSpecs } = await server.ssrLoadModule("/src/ui/tray-model.ts");

    // Register every pack that owns a template in scope: data (bar_chart,
    // line_chart, bar_race, heatmap), empirics (event_study, did_trends),
    // evidence (survival_curve, forest_plot, distribution_curve), hta (ceac).
    for (const packId of ["data", "empirics", "evidence", "hta"]) {
      const mod = await server.ssrLoadModule(`/src/scenes/packs/${packId}.yaml?raw`);
      const reg = registerPack(packId, mod.default);
      if (!reg.ok) {
        console.error(`FATAL: could not register pack "${packId}":`, reg.errors);
        process.exitCode = 1;
        return;
      }
    }

    const bundled = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8"));

    /** Sweeps one (template, params) pair at every integer stage the tray
     *  slider offers, plus 4 fractional midpoints when it is genuinely
     *  staged; a single resting layout otherwise. Returns per-stage results. */
    function sweep(label, tid, params) {
      const manifest = scenes[tid]?.manifest;
      if (!manifest) {
        rows.push({ label, tid, clean: false, issues: [`FATAL: template "${tid}" not registered`] });
        failures++;
        return;
      }
      const sliders = sliderSpecs(manifest.params_schema, params);
      const stageSlider = sliders.find((s) => s.path === "stage");
      const stagesToCheck = [];
      if (stageSlider) {
        const max = stageSlider.max;
        for (let k = 0; k <= Math.floor(max); k++) stagesToCheck.push({ stage: k, kind: "integer" });
        const FRAC = 4;
        for (let i = 0; i < FRAC; i++) stagesToCheck.push({ stage: ((i + 0.5) / FRAC) * max, kind: "fractional" });
      } else {
        stagesToCheck.push({ stage: undefined, kind: "resting (not staged)" });
      }

      let anyIssue = false;
      const perStage = [];
      for (const { stage, kind } of stagesToCheck) {
        const p = stage === undefined ? params : { ...params, stage };
        const res = layoutSpec({ template: tid, params: p });
        const all = [...res.issues]; // res.issues already includes warn+error severities
        if (all.length > 0) {
          anyIssue = true;
          perStage.push({ stage, kind, issues: all.map(fmtIssue) });
        }
      }
      const stageCount = stagesToCheck.length;
      rows.push({ label, tid, clean: !anyIssue, stageCount, staged: !!stageSlider, perStage });
      if (anyIssue) failures++;
      return { clean: !anyIssue };
    }

    console.log("=".repeat(78));
    console.log("ROUND EXAMPLE SWEEP — every stacked/slope/heatmap/retrofit example this round shipped");
    console.log("=".repeat(78));

    // -----------------------------------------------------------------
    // stacked-bars (bar_chart) and slope/Simpson (line_chart) — both are
    // manifest-only examples, identified by their own params flag rather
    // than by list position, so a reorder in the yaml cannot silently drop
    // them from this sweep.
    // -----------------------------------------------------------------
    const barChartEx = scenes.bar_chart.manifest.examples;
    const stacked = barChartEx.find((e) => e.params?.stacked === true);
    if (!stacked) {
      console.error("FATAL: no bar_chart manifest example has stacked:true");
      process.exitCode = 1;
    } else {
      sweep(`bar_chart (stacked): "${stacked.request}"`, "bar_chart", stacked.params);
    }

    const lineChartEx = scenes.line_chart.manifest.examples;
    const slope = lineChartEx.find((e) => e.params?.slope === true);
    if (!slope) {
      console.error("FATAL: no line_chart manifest example has slope:true");
      process.exitCode = 1;
    } else {
      sweep(`line_chart (slope): "${slope.request}"`, "line_chart", slope.params);
    }

    // The chess line-race example is swept exhaustively (stage 0..5, plus
    // fractional) by smoke-race.mjs already; not re-swept here to avoid a
    // second, divergent implementation of the same check. See that script's
    // own output for its numbers.
    const chess = lineChartEx.find((e) => /chess players/i.test(e.request));
    if (!chess) {
      console.error("NOTE: expected a line_chart chess example (not found) — smoke-race.mjs's own coverage claim above would be wrong");
      process.exitCode = 1;
    }

    // -----------------------------------------------------------------
    // heatmap — all 3 manifest examples (none staged; confirmed by the
    // sliderSpecs check inside sweep()). The two src/examples.json entries
    // that are NOT token-fed are diffed against their manifest twins to
    // prove the dedup claim, then skipped as redundant.
    // -----------------------------------------------------------------
    const heatmapManifestEx = scenes.heatmap.manifest.examples;
    for (const ex of heatmapManifestEx) sweep(`heatmap (manifest): "${ex.request}"`, "heatmap", ex.params);

    const bundledHeatmap = bundled.filter((e) => e.spec?.template === "heatmap");
    for (const be of bundledHeatmap) {
      const twin = heatmapManifestEx.find((e) => JSON.stringify(e.params) === JSON.stringify(be.spec.params));
      if (twin) {
        console.log(`  heatmap bundled example "${be.request}" — params BYTE-IDENTICAL to manifest example "${twin.request}"; not re-swept.`);
      } else {
        console.log(`  heatmap bundled example "${be.request}" — params differ from every manifest example; sweeping independently.`);
        sweep(`heatmap (bundled): "${be.request}"`, "heatmap", be.spec.params);
      }
    }

    // -----------------------------------------------------------------
    // bar_race — dedup check only (smoke-race.mjs already swept every
    // manifest example, integer + fractional, with the reviewed T5-A
    // exemption). Prove the one src/examples.json bar_race entry is a byte
    // twin of a manifest example, same as the heatmap check above.
    // -----------------------------------------------------------------
    const barRaceManifestEx = scenes.bar_race.manifest.examples;
    const bundledBarRace = bundled.filter((e) => e.spec?.template === "bar_race");
    for (const be of bundledBarRace) {
      const twin = barRaceManifestEx.find((e) => JSON.stringify(e.params) === JSON.stringify(be.spec.params));
      console.log(
        twin
          ? `  bar_race bundled example "${be.request}" — params BYTE-IDENTICAL to manifest example "${twin.request}"; covered by smoke-race.mjs, not re-swept.`
          : `  bar_race bundled example "${be.request}" — params differ from every manifest example — NOT covered by smoke-race.mjs (it only reads the manifest)! sweeping independently.`,
      );
      if (!twin) sweep(`bar_race (bundled, uncovered by smoke-race): "${be.request}"`, "bar_race", be.spec.params);
    }
    console.log(`  (${barRaceManifestEx.length} bar_race manifest examples total — smoke-race.mjs's own count — not "both")`);
    console.log(`  (${heatmapManifestEx.length} heatmap manifest examples total — not "both")`);

    // -----------------------------------------------------------------
    // The six code-fed retrofit examples — src/examples.json only (their
    // pack manifests keep their original, un-retrofitted examples). Found
    // by template id AND the presence of a real "{id.var}" token in their
    // params, so a future addition of a second example for the same
    // template cannot silently swap in the wrong one.
    // -----------------------------------------------------------------
    const RETROFIT_TEMPLATES = ["distribution_curve", "forest_plot", "survival_curve", "ceac", "did_trends", "event_study"];
    const TOKEN_RE = /\{[A-Za-z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*\}/;
    for (const tid of RETROFIT_TEMPLATES) {
      const candidates = bundled.filter((e) => e.spec?.template === tid && TOKEN_RE.test(JSON.stringify(e.spec.params)));
      if (candidates.length !== 1) {
        console.error(`FATAL: expected exactly 1 code-fed bundled example for "${tid}", found ${candidates.length}`);
        process.exitCode = 1;
        continue;
      }
      const ex = candidates[0];
      sweep(`${tid} (code-fed, bundled): "${ex.request}"`, tid, ex.spec.params);
    }

    // =========================================================================
    console.log("");
    console.log("-".repeat(78));
    for (const r of rows) {
      if (r.clean) {
        console.log(`  CLEAN  ${r.label}  [${r.stageCount} ${r.staged ? "stage(s) (staged)" : "resting layout (not staged)"}]`);
      } else {
        console.log(`  ISSUES ${r.label}`);
        for (const s of r.perStage ?? []) {
          const where = s.stage === undefined ? s.kind : `${s.kind} stage ${typeof s.stage === "number" ? s.stage.toFixed(3) : s.stage}`;
          console.log(`    @ ${where}:`);
          for (const issue of s.issues) console.log(`      ${issue}`);
        }
        if (r.issues) for (const i of r.issues) console.log(`    ${i}`);
      }
    }
    console.log("-".repeat(78));
    if (failures === 0 && process.exitCode !== 1) {
      console.log(`PASS — all ${rows.length} swept examples lint fully clean at every stage checked.`);
    } else {
      console.error(`FAIL — ${failures} example(s) produced a real lint issue.`);
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
