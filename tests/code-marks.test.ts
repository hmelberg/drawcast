// The marker pen over a script (`marks`) and the chart style token (`chart`).
// Both are what an LLM writes and the layout/facade carry out, so both are
// tested where they are decided: geometry and warnings here, the Python the
// prelude produces as a string, and the cache key that keeps two styles apart.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { CHAR_W, findMarkRow, normalizeMarks } from "../src/layout/code";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, COLORS, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { chartPrelude, DEFAULT_CHART_STYLE } from "../src/code/chart-style";
import { codeCacheKey } from "../src/code/run";
import { planCommands } from "../src/render/plan";
import type { Spec } from "../src/spec/types";

const CODE = "import numpy as np\nrng = np.random.default_rng(7)\nx = rng.normal(size=200)\nprint(round(x.mean(), 3))";
const spec = (el: object, commands: object[] = []): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", show: "code", code: CODE, ...el }], commands }) as unknown as Spec;
const lay = (el: object) => layoutSpec(spec(el), heuristicMeasure);
const strokeOf = (el: object, id: string) => flattenDrawables(lay(el).drawables).find((d) => d.id === id) as StrokeDrawable;

describe("what a mark asks for", () => {
  test("a string is the highlighter; an object picks the kind", () => {
    expect(normalizeMarks(["a", { text: "b", kind: "strike" }, { text: "c" }])).toEqual([
      { text: "a", kind: "mark" },
      { text: "b", kind: "strike" },
      { text: "c", kind: "mark" },
    ]);
    expect(normalizeMarks(undefined)).toEqual([]);
  });

  test("it is found on the DRAWN rows, first hit, or not at all", () => {
    const blocks = [{ rows: ["a = 1"] }, { rows: ["b = a + 1", "    + 2"] }];
    expect(findMarkRow(blocks, "a = 1")).toEqual({ block: 0, row: 0, col: 0 });
    expect(findMarkRow(blocks, "+ 2")).toEqual({ block: 1, row: 1, col: 4 });
    expect(findMarkRow(blocks, "b = a")).toEqual({ block: 1, row: 0, col: 0 });
    expect(findMarkRow(blocks, "nowhere")).toBeNull();
    expect(findMarkRow(blocks, "")).toBeNull();
  });
});

describe("where the pen goes", () => {
  test("a mark covers exactly its characters, on its own line", () => {
    const m = strokeOf({ marks: ["np.random.default_rng(7)"] }, "sim_mark_1");
    const line2 = flattenDrawables(lay({ marks: ["np.random.default_rng(7)"] }).drawables).find((d) => d.id === "sim_line_2") as TextDrawable;
    const fontSize = 17;
    // Starts at the phrase's column (6: "rng = "), one 0.15 em overshoot each side.
    expect(m.pts[0][0]).toBeCloseTo(line2.pos[0] + 6 * CHAR_W * fontSize - fontSize * 0.15, 5);
    expect(m.pts[1][0] - m.pts[0][0]).toBeCloseTo(24 * CHAR_W * fontSize + 2 * fontSize * 0.15, 5);
    // On the line's own row, and a band the height of the glyphs.
    expect(m.pts[0][1]).toBeCloseTo(line2.pos[1] + fontSize * 0.28, 5);
    expect(m.style.strokeWidth).toBeCloseTo(fontSize * 0.95, 5);
    expect(m.style.color).toBe(COLORS.region1);
    expect(m.style.opacity).toBeCloseTo(0.42, 5);
  });

  test("strike and underline are the same span, drawn as lines", () => {
    const strike = strokeOf({ marks: [{ text: "x = rng.normal(size=200)", kind: "strike" }] }, "sim_mark_1");
    const under = strokeOf({ marks: [{ text: "x = rng.normal(size=200)", kind: "underline" }] }, "sim_mark_1");
    expect(strike.style.color).toBe(COLORS.regionLoss);
    expect(under.style.color).toBe(COLORS.demand);
    expect(strike.style.strokeWidth).toBe(2.5);
    expect(under.pts[0][1]).toBeLessThan(strike.pts[0][1]); // under the letters, not through them
    expect(strike.pts[1][0] - strike.pts[0][0]).toBeCloseTo(under.pts[1][0] - under.pts[0][0], 5);
  });

  test("every mark is its own beat, in the order written", () => {
    const l = lay({ marks: ["import numpy", "x = rng"] });
    expect(l.order.filter((id) => id.startsWith("sim_mark"))).toEqual(["sim_mark_1", "sim_mark_2"]);
  });

  test("text that is not on a drawn line keeps its beat and says why", () => {
    const l = lay({ marks: ["def missing():"] });
    expect(l.order).toContain("sim_mark_1");
    expect(strokeOf({ marks: ["def missing():"] }, "sim_mark_1").pts).toEqual([]);
    expect(l.warnings.some((w) => w.includes('"def missing():" is not on any drawn line'))).toBe(true);
  });

  test("in a scrolling window a mark travels with its line, and never decides the scroll", () => {
    const long = Array.from({ length: 10 }, (_, i) => `x${i} = ${i}`).join("\n");
    const s = spec({ code: long, lines: 4, marks: ["x9 = 9"] }, [{ draw: ["sim_line_9"] }]);
    const l = layoutSpec(s, heuristicMeasure);
    expect(l.windows!["sim"].follow).toEqual(["sim_mark_1"]);
    const plan = planCommands(s.commands, l.order, { windows: l.windows });
    const last = plan.states[plan.states.length - 1];
    expect(last.offsets["sim_mark_1"]).toEqual(last.offsets["sim_line_9"]);
    expect(last.offsets["sim_mark_1"][1]).toBeGreaterThan(0);
  });
});

describe("the chart style", () => {
  test("a script with no plot in it costs nothing", () => {
    expect(chartPrelude("xkcd", "print(1)", "python")).toBe("");
    expect(chartPrelude("xkcd", "import matplotlib.pyplot as plt", "brython")).toBe(""); // an emulation has no rcParams
  });

  test("each style is its own line of matplotlib, on the figure's own palette", () => {
    const sea = chartPrelude("seaborn", "plt.plot(x)", "python");
    expect(sea).toContain('_plt.style.use("seaborn-v0_8-whitegrid")');
    expect(chartPrelude("xkcd", "plt.plot(x)", "python")).toContain("_plt.xkcd()");
    expect(chartPrelude("plain", "plt.plot(x)", "python")).not.toContain("style.use");
    for (const p of [sea, chartPrelude("plain", "plt.plot(x)", "python")]) {
      expect(p).toContain("_m.rcdefaults()"); // rcParams are global and outlive a run
      expect(p).toContain(COLORS.ink);
      expect(p).toContain(COLORS.series[0]);
      expect(p).toContain('"figure.facecolor": "none"');
      expect(p.startsWith("try:")).toBe(true); // never kills a script
    }
  });

  test("the default is seaborn, and the style is part of the cache key", () => {
    expect(DEFAULT_CHART_STYLE).toBe("seaborn");
    const base = { language: "python" as const, code: "plt.plot(x)" };
    expect(codeCacheKey(base)).toBe(codeCacheKey({ ...base, chart: "seaborn" }));
    expect(codeCacheKey({ ...base, chart: "xkcd" })).not.toBe(codeCacheKey(base));
    // …but a script it cannot touch must not miss its cache for nothing.
    const plain = { language: "micropython" as const, code: "print(1)" };
    expect(codeCacheKey({ ...plain, chart: "xkcd" })).toBe(codeCacheKey(plain));
  });

  test("a style the tier cannot honour is reported, not swallowed", () => {
    const l = layoutSpec(
      { elements: [{ id: "c1", type: "code", language: "brython", show: "code", code: "plt.plot(x)", chart: "xkcd" }] } as unknown as Spec,
      heuristicMeasure,
    );
    expect(l.warnings.some((w) => w.includes('chart: "xkcd" needs language: "python"'))).toBe(true);
  });
});
