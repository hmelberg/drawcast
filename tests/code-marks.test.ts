// The marker pen over a script (`marks`) and the chart style token (`chart`).
// Both are what an LLM writes and the layout/facade carry out, so both are
// tested where they are decided: geometry and warnings here, the Python the
// prelude produces as a string, and the cache key that keeps two styles apart.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { CHAR_W, findMarkRow, inkUnderMark, normalizeMarks } from "../src/layout/code";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, COLORS, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { chartPrelude, defaultChartStyle } from "../src/code/chart-style";
import { readFileSync } from "node:fs";
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
  test("a mark is a rounded box over exactly its characters, on its own line", () => {
    const m = strokeOf({ marks: ["np.random.default_rng(7)"] }, "sim_mark_1");
    const line2 = flattenDrawables(lay({ marks: ["np.random.default_rng(7)"] }).drawables).find((d) => d.id === "sim_line_2") as TextDrawable;
    const fontSize = 17;
    const band = fontSize * 1.1;
    // The box's OUTER edges — the stroke's ends plus its round caps — sit a
    // quarter em outside the phrase's characters (column 6: "rng = ").
    expect(m.pts[0][0] - band / 2).toBeCloseTo(line2.pos[0] + 6 * CHAR_W * fontSize - fontSize * 0.25, 5);
    expect(m.pts[1][0] + band / 2).toBeCloseTo(line2.pos[0] + 30 * CHAR_W * fontSize + fontSize * 0.25, 5);
    // Centred on the line's own row (the rows are drawn with a central
    // baseline, so the text's y IS the glyph centre), most of the row tall.
    expect(m.pts[0][1]).toBeCloseTo(line2.pos[1], 5);
    expect(m.style.strokeWidth).toBeCloseTo(band, 5);
    expect(m.style.color).toBe(COLORS.region1);
    expect(m.style.opacity).toBeCloseTo(0.6, 5);
    // Exact in both render styles: round caps are what make the stroke a box.
    expect(m.precise).toBe(true);
  });

  test("a code row carries no paper halo — nothing crosses it, and the halo cut holes in the marker", () => {
    const line2 = flattenDrawables(lay({}).drawables).find((d) => d.id === "sim_line_2") as TextDrawable;
    expect(line2.halo).toBe(false);
  });

  test("a number under the marker goes to ink — it is coloured the marker's own yellow", () => {
    const l = lay({ marks: ["default_rng(7)"] });
    const line2 = flattenDrawables(l.drawables).find((d) => d.id === "sim_line_2") as TextDrawable;
    const runs = line2.runs![0];
    expect(runs.map((r) => r.text).join("")).toBe("rng = np.random.default_rng(7)");
    const seven = runs.find((r) => r.text === "7")!;
    expect(seven.color).toBeUndefined();
    // Unmarked, the same number keeps its colour.
    const plain = (flattenDrawables(lay({}).drawables).find((d) => d.id === "sim_line_2") as TextDrawable).runs![0];
    expect(plain.find((r) => r.text === "7")!.color).toBe(COLORS.region1);
  });

  test("strike and underline are the same span, drawn as lines", () => {
    const strike = strokeOf({ marks: [{ text: "x = rng.normal(size=200)", kind: "strike" }] }, "sim_mark_1");
    const under = strokeOf({ marks: [{ text: "x = rng.normal(size=200)", kind: "underline" }] }, "sim_mark_1");
    expect(strike.style.color).toBe(COLORS.regionLoss);
    expect(under.style.color).toBe(COLORS.demand);
    expect(strike.style.strokeWidth).toBe(2.5);
    const line3 = flattenDrawables(lay({ marks: ["x = rng"] }).drawables).find((d) => d.id === "sim_line_3") as TextDrawable;
    const fontSize = 17;
    // The strike runs through the glyph centre; the underline sits 0.45 em
    // below it — under the letters' feet, not through their lower half.
    expect(strike.pts[0][1]).toBeCloseTo(line3.pos[1], 5);
    expect(under.pts[0][1]).toBeCloseTo(line3.pos[1] - fontSize * 0.45, 5);
    expect(under.pts[0][1]).toBeLessThan(strike.pts[0][1]);
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

  test("the default is xkcd in EVERY drawing style, and the style is part of the cache key", () => {
    // Hans, 2026-09-16, live: "clean" is only the strokes — the app's own
    // default style, and its text in both styles, are handwritten, so a
    // ruled chart is the odd one out on a clean page too. An author who
    // wants the grid asks for it.
    expect(defaultChartStyle("sketchy")).toBe("xkcd");
    expect(defaultChartStyle(undefined)).toBe("xkcd");
    expect(defaultChartStyle("clean")).toBe("xkcd");
    const base = { language: "python" as const, code: "plt.plot(x)" };
    expect(codeCacheKey(base)).toBe(codeCacheKey({ ...base, chart: "xkcd" }));
    expect(codeCacheKey({ ...base, chart: "seaborn" })).not.toBe(codeCacheKey(base));
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

describe("the xkcd chart writes in the app's own hand", () => {
  const url = "http://x/f.ttf";
  const withFont = chartPrelude("xkcd", "import matplotlib.pyplot as plt", "python", { fontUrl: url });

  test("the font is fetched once, registered, and set AFTER xkcd's own family list", () => {
    expect(withFont).toContain("pyfetch");
    expect(withFont).toContain("addfont");
    expect(withFont).toContain('"font.family"');
    expect(withFont).toContain(url);
    // Once per session: the check is the cache, and the file lives in the
    // interpreter's own FS.
    expect(withFont).toContain('if not _os.path.exists("/tmp/PatrickHand-Regular.ttf")');
    // Order is the whole point — rcdefaults, then xkcd's look, then OUR face
    // over the Humor Sans list it just set.
    expect(withFont.indexOf("_m.rcdefaults()")).toBeLessThan(withFont.indexOf("_plt.xkcd()"));
    expect(withFont.indexOf("_plt.xkcd()")).toBeLessThan(withFont.indexOf('"font.family"'));
    // …and still inside the one try/except, so a failed fetch degrades to
    // xkcd's fallback face instead of killing the prelude.
    expect(withFont.startsWith("try:")).toBe(true);
    expect(withFont.trimEnd().endsWith("    pass")).toBe(true);
    expect(withFont).not.toContain('"font.size"'); // xkcd's own size stands
  });

  test("no url (node, a page with no location) means no font block at all", () => {
    const bare = chartPrelude("xkcd", "import matplotlib.pyplot as plt", "python");
    expect(bare).toContain("_plt.xkcd()");
    for (const needle of ["pyfetch", "addfont", "font.family", "PatrickHand"]) expect(bare).not.toContain(needle);
  });

  test("the other styles never wobble, and never fetch", () => {
    for (const style of ["seaborn", "plain"] as const) {
      const p = chartPrelude(style, "import matplotlib.pyplot as plt", "python", { fontUrl: url });
      expect(p).not.toContain("xkcd()");
      expect(p).not.toContain("pyfetch");
      expect(p).not.toContain("font.family");
    }
  });

  test("the face the prelude asks for is the one that is shipped", () => {
    // The family name comes out of the TTF's own name table — if the file is
    // ever swapped for another hand, this test is where it is noticed.
    const ttf = readFileSync("public/fonts/patrickhand/PatrickHand-Regular.ttf", "latin1");
    expect(ttf.includes("Patrick Hand")).toBe(true); // the Mac name record, plain 8-bit
    expect(withFont).toContain('"Patrick Hand"');
  });
});

describe("every run site resolves the chart style from the drawing (pins)", () => {
  const sites: [string, RegExp][] = [
    ["src/render/code.ts", /chart: chartFor\(el, deps\.style\)/],
    ["src/render/sweep-run.ts", /chart: chartFor\(el, deps\.style\)/],
  ];
  for (const [file, re] of sites) {
    test(`${file} runs with chartFor(el, …) — chart, then feel, then the default`, () => {
      expect(readFileSync(file, "utf8")).toMatch(re);
    });
  }
  test("the tray's two runs (the editor's Run and an ask's Check) take it from the handle", () => {
    const src = readFileSync("src/ui/tray.ts", "utf8");
    expect(src.match(/chart: chartFor\(el, hd\.style\)/g)?.length).toBe(2);
  });
  test("render() resolves the style ONCE and hands it to the resolve pass and the sweep runner", () => {
    const src = readFileSync("src/render/index.ts", "utf8");
    expect(src).toMatch(/const style: RenderStyle = options\.style \?\? "sketchy"/);
    expect(src).toMatch(/resolvedRenderSpec\(spec, \{[^}]*style \}\)/);
    expect(src).toMatch(/sweepRunnerFor\(authored, \{ style \}\)/);
  });
});

describe("a mark under its own line is not an overlap", () => {
  test("the label-on-stroke lint stands aside for `<id>_mark_k` under `<id>_line_n`", () => {
    const l = lay({ marks: ["rng = np.random.default_rng(7)"] });
    expect(l.issues.filter((i) => i.message.includes("sits on stroke") && i.message.includes("_mark_"))).toEqual([]);
  });
});

describe("inkUnderMark", () => {
  test("splits a run at the mark's edges and re-inks only what reads as the marker", () => {
    const runs = [{ text: "x = " }, { text: "123", color: COLORS.region1 }, { text: " + " }, { text: "45", color: COLORS.region1 }, { text: "abc", color: COLORS.supply }];
    const out = inkUnderMark(runs, 5, 9, COLORS.region1);
    expect(out.map((r) => r.text).join("")).toBe("x = 123 + 45abc");
    expect(out).toEqual([
      { text: "x = " },
      { text: "1", color: COLORS.region1 },
      { text: "23" },
      { text: " + " },
      { text: "45" },
      { text: "abc", color: COLORS.supply },
    ]);
  });
});
