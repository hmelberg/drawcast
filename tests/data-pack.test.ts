// The data pack: templates fed by data — typed by the author or substituted
// from a script by the render-time resolver. What is pinned here: the
// depth-means-staged rule, interpolation at a fractional stage, absent bars
// growing from the axis, stable ids and limits across stages, the placeholder
// promise (typed labels + a still-unresolved token → n bars of height 0), the
// box param, and every manifest example laying out clean.

import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack, PACK_DEFS, DEFAULT_OFF_PACKS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { plotArea } from "../src/layout/canvas";
import { AXIS_OVERHANG } from "../src/layout/axes";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type AreaDrawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { DEFAULT_SETTINGS } from "../src/store";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  const r = registerPack("data", dataYaml);
  expect(r.errors).toEqual([]);
});

const plot = plotArea();
/** A drawn title costs 55 units of plot height — default top or authored box alike. */
const TITLED_TOP = plot.y1 - 55;
/** The y scale bar_chart uses for a chart whose data spans [0, hi] with the 8 % headroom. */
const Y = (v: number, hi: number, y1 = plot.y1) => plot.y0 + (v / (hi * 1.08)) * (y1 - plot.y0);
const area = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id) as AreaDrawable | undefined;
const barTop = (l: ReturnType<typeof layoutSpec>, i: number, j = 0) => Math.max(...area(l, `bar_${i}__f${j}`)!.pts.map((p) => p[1]));
const layout = (params: object) => layoutSpec({ template: "bar_chart", params } as Spec);

describe("pack registration", () => {
  test("data is a bundled pack, enabled by default, with the two M1 templates", () => {
    expect(PACK_DEFS.data.id).toBe("data");
    expect(DEFAULT_OFF_PACKS.has("data")).toBe(false);
    expect(DEFAULT_SETTINGS.enabledPacks).toContain("data");
    expect(scenes.bar_chart?.manifest.status).toBe("ready");
    expect(scenes.data_table?.manifest.status).toBe("ready");
    expect(scenes.line_chart?.manifest.status).toBe("ready");
    expect(scenes.scatter_plot?.manifest.status).toBe("ready");
  });

  test("every manifest example lays out with zero warnings and no error lint", () => {
    for (const tid of ["bar_chart", "data_table", "line_chart", "scatter_plot"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params } as Spec);
        expect(res.warnings, `${tid}: ${ex.request}`).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), `${tid}: ${ex.request}`).toEqual([]);
      }
    }
  });
});

describe("bar_chart — static data", () => {
  test("mints axes, bar_1..n (with their category label) and the title; bar heights follow the values", () => {
    const l = layout({ labels: ["a", "b", "c"], values: [2, 4, 8], title: "T", y_label: "Y" });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "bar_3", "title"]);
    expect(barTop(l, 3)).toBeCloseTo(Y(8, 8, TITLED_TOP), 6);
    expect(barTop(l, 1)).toBeCloseTo(Y(2, 8, TITLED_TOP), 6);
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toEqual(expect.arrayContaining(["a", "b", "c", "T", "Y"]));
    expect(l.warnings).toEqual([]);
  });

  test("value_labels write each value above its bar with the data's own precision", () => {
    const l = layout({ labels: ["a", "b"], values: [2.5, 4], value_labels: true });
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toEqual(expect.arrayContaining(["2.5", "4.0"]));
  });

  test("series draw grouped bars with a legend; colors cycle COLORS.series", () => {
    const l = layout({ labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "legend"]);
    expect(area(l, "bar_1__f0")!.style.fill).toBe("#b5482e");
    expect(area(l, "bar_1__f1")!.style.fill).toBe("#2f6b8f");
  });

  test("box places the chart; labels beyond 40 and series beyond 6 are dropped", () => {
    const l = layout({ labels: ["a"], values: [1], box: { x: 500, y: 100, w: 400, h: 500 } });
    const pts = area(l, "bar_1__f0")!.pts;
    expect(Math.min(...pts.map((p) => p[0]))).toBeGreaterThanOrEqual(500);
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThanOrEqual(900);
    const many = layout({ labels: Array.from({ length: 50 }, (_, i) => `l${i}`), values: Array.from({ length: 50 }, () => 1) });
    expect(many.order.filter((id) => id.startsWith("bar_"))).toHaveLength(40);
  });

  // Ruling J: bar_i__l's category labels sit in the same row as a stacked
  // x_label caption, exactly like line_chart's axes__x1/axes__c and
  // scatter_plot's axes__x1 — X_CAPTION_DROP clears it here too.
  test("a long x_label drops below the category labels with no overlap lint", () => {
    const l = layout({ labels: ["a", "b", "c"], values: [1, 2, 3], x_label: "A long axis caption" });
    expect(l.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
    const cap = flattenDrawables(l.drawables).find((d) => d.id === "axes__x_label") as TextDrawable;
    const catLabel = flattenDrawables(l.drawables).find((d) => d.id === "bar_3__l") as TextDrawable;
    expect(cap.pos[1]).toBeLessThan(catLabel.pos[1]);
  });
});

// The title and the y-axis caption both want the strip above the plot: the
// caption is centred at (y arrow tip + 12 + half its box), the title sat at
// plot.y1 + 25, three units BELOW that tip. They shared a band. The title now
// reads the caption's actual position out of the axes group, and a drawn title
// costs the plot 55 units of height; an UNTITLED chart keeps its old top, box
// or no box, so nothing else moves.
describe("bar_chart — the title clears the y caption", () => {
  const textAt = (l: ReturnType<typeof layoutSpec>, id: string) =>
    flattenDrawables(l.drawables).find((d) => d.id === id) as TextDrawable | undefined;

  test("no box: the plot top drops to 620 and the title sits a clear band above the caption", () => {
    const l = layout({ labels: ["a", "b"], values: [1, 2], title: "A long enough title", y_label: "Share of rolls" });
    const yAxis = flattenDrawables(l.drawables).find((d) => d.id === "axes__y") as { pts: [number, number][] };
    expect(Math.max(...yAxis.pts.map((p) => p[1]))).toBeCloseTo(TITLED_TOP + AXIS_OVERHANG, 6);
    const cap = textAt(l, "axes__y_label")!;
    const title = textAt(l, "title")!;
    expect(title.pos[1]).toBeGreaterThanOrEqual(cap.pos[1] + 38);
    expect(title.pos[1]).toBeLessThanOrEqual(730);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  // A box says WHERE the plot goes, not that a title may sit on the caption:
  // the 55 units cost the same whether the top is the default or the author's.
  test("an authored box pays for its title too; without a title its top is honoured unchanged", () => {
    const box = { x: 120, y: 95, w: 855, h: 580 };
    const yTop = (l: ReturnType<typeof layoutSpec>) =>
      Math.max(...(flattenDrawables(l.drawables).find((d) => d.id === "axes__y") as { pts: [number, number][] }).pts.map((p) => p[1]));
    const titled = layout({ labels: ["a", "b"], values: [1, 2], title: "A long enough title", y_label: "Share of rolls", box });
    expect(yTop(titled)).toBeCloseTo(TITLED_TOP + AXIS_OVERHANG, 6);
    const cap = textAt(titled, "axes__y_label")!;
    const title = textAt(titled, "title")!;
    expect(title.pos[1]).toBeGreaterThanOrEqual(cap.pos[1] + 38);
    expect(title.pos[1]).toBeLessThanOrEqual(730);
    const untitled = layout({ labels: ["a", "b"], values: [1, 2], y_label: "Share of rolls", box });
    expect(yTop(untitled)).toBeCloseTo(box.y + box.h + AXIS_OVERHANG, 6);
  });

  // The degenerate box: its floor is already above the 620 a title wants, so
  // the lowering is clamped to the floor and the plot collapses to zero height
  // rather than inverting. Nothing NaNs, and the y axis still runs upwards.
  test("a box whose floor is above 620 collapses, never inverts", () => {
    const l = layout({ labels: ["a", "b"], values: [1, 2], title: "T", y_label: "Y", box: { x: 120, y: 650, w: 800, h: 60 } });
    const pts = flattenDrawables(l.drawables).flatMap((d) => {
      const any = d as { pts?: [number, number][]; pos?: [number, number] };
      return any.pts ?? (any.pos ? [any.pos] : []);
    });
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${p}`).toBe(true);
    const yAxis = flattenDrawables(l.drawables).find((d) => d.id === "axes__y") as { pts: [number, number][] };
    expect(yAxis.pts[1][1]).toBeGreaterThanOrEqual(yAxis.pts[0][1]);
  });

  test("no y caption → the title keeps its old place; no title → the plot keeps its old top", () => {
    const noCap = layout({ labels: ["a"], values: [1], title: "T" });
    expect(textAt(noCap, "title")!.pos[1]).toBeCloseTo(Math.min(700, TITLED_TOP + 25), 6);
    const noTitle = layout({ labels: ["a"], values: [1], y_label: "Y" });
    const yAxis = flattenDrawables(noTitle.drawables).find((d) => d.id === "axes__y") as { pts: [number, number][] };
    expect(Math.max(...yAxis.pts.map((p) => p[1]))).toBeCloseTo(plot.y1 + AXIS_OVERHANG, 6);
  });
});

describe("bar_chart — stages", () => {
  const staged = { labels: ["a", "b", "c"], values: [[2, 4, 8], [4, 8, 2]] };

  test("depth means staged: stage 0 and stage 1 are the two rows; limits span ALL stages", () => {
    const s0 = layout({ ...staged, stage: 0 });
    const s1 = layout({ ...staged, stage: 1 });
    expect(barTop(s0, 1)).toBeCloseTo(Y(2, 8), 6);
    expect(barTop(s1, 1)).toBeCloseTo(Y(4, 8), 6); // same scale: hi is 8 in both
    expect(barTop(s1, 3)).toBeCloseTo(Y(2, 8), 6);
    expect(s0.order).toEqual(s1.order);
  });

  test("a fractional stage interpolates linearly", () => {
    const l = layout({ ...staged, stage: 0.5 });
    expect(barTop(l, 1)).toBeCloseTo(Y(3, 8), 6);
    expect(barTop(l, 3)).toBeCloseTo(Y(5, 8), 6);
  });

  test("stage is clamped; a series with fewer stages holds its last one", () => {
    const l = layout({ ...staged, stage: 7 });
    expect(barTop(l, 1)).toBeCloseTo(Y(4, 8), 6);
    const mixed = layout({ labels: ["a"], series: [{ name: "x", values: [[1], [2]] }, { name: "y", values: [5] }], stage: 1 });
    expect(barTop(mixed, 1, 1)).toBeCloseTo(Y(5, 5), 6);
  });

  test("a bar absent from a stage has height 0 and still exists (ids stable)", () => {
    const l = layout({ labels: ["a", "b", "c"], values: [[5, 5, 5], [5, 5]], stage: 1 });
    expect(l.order).toContain("bar_3");
    expect(barTop(l, 3)).toBeCloseTo(Y(0, 5), 6);
    const half = layout({ labels: ["a", "b", "c"], values: [[5, 5, 5], [5, 5]], stage: 0.5 });
    expect(barTop(half, 3)).toBeCloseTo(Y(2.5, 5), 6);
  });

  test("ylim pins the scale; negative values hang below a dashed zero line", () => {
    const l = layout({ labels: ["a"], values: [3], ylim: [0, 10] });
    expect(barTop(l, 1)).toBeCloseTo(plot.y0 + 0.3 * (plot.y1 - plot.y0), 6);
    const neg = layout({ labels: ["a", "b"], values: [-2, 4] });
    expect(flattenDrawables(neg.drawables).some((d) => d.id === "axes__zero")).toBe(true);
    const pts = area(neg, "bar_1__f0")!.pts;
    const zero = flattenDrawables(neg.drawables).find((d) => d.id === "axes__zero")!;
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo((zero as { pts: [number, number][] }).pts[0][1], 6);
  });
});

describe("bar_chart — the placeholder promise", () => {
  test("typed labels + an unresolved token → n bars of height 0, so beats exist offline", () => {
    const l = layout({ labels: ["a", "b", "c"], values: "{sim.frames}", stage: 0 });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "bar_3"]);
    expect(barTop(l, 2)).toBeCloseTo(plot.y0, 6);
    expect(l.warnings).toEqual([]);
  });

  test("no labels and no data → axes only, no warnings", () => {
    const l = layout({ values: "{sim.frames}" });
    expect(l.order).toEqual(["axes"]);
    expect(l.warnings).toEqual([]);
  });

  test("series with unresolved tokens keep their count, legend and colours", () => {
    const l = layout({ labels: ["Before", "After"], series: [{ name: "Treated", values: "{sim.a}" }, { name: "Control", values: "{sim.b}" }] });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "legend"]);
    expect(area(l, "bar_1__f1")).toBeDefined();
    expect(barTop(l, 1, 1)).toBeCloseTo(plot.y0, 6);
    expect(l.warnings).toEqual([]);
    const mixed = layout({ labels: ["a"], series: [{ name: "x", values: [3] }, { name: "y", values: "{sim.y}" }] });
    expect(mixed.order).toEqual(["axes", "bar_1", "legend"]);
    expect(barTop(mixed, 1, 0)).toBeCloseTo(Y(3, 3), 6);
    expect(barTop(mixed, 1, 1)).toBeCloseTo(plot.y0, 6);
  });
});

describe("data_table", () => {
  const table = (params: object) => layoutSpec({ template: "data_table", params } as Spec);
  const texts = (l: ReturnType<typeof layoutSpec>) => flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text");

  test("header + row_1..n from columns/rows; numbers formatted by decimals; integers untouched", () => {
    const l = table({ columns: ["Year", "2 %", "7 %"], rows: [[0, 100, 100], [10, 121.899, 196.715]], decimals: 1, title: "T" });
    expect(l.order).toEqual(["header", "row_1", "row_2", "title"]);
    const t = texts(l).map((d) => d.text);
    expect(t).toEqual(expect.arrayContaining(["Year", "2 %", "7 %", "0", "100", "10", "121.9", "196.7", "T"]));
    expect(l.warnings).toEqual([]);
  });

  test("a whole harvested DataFrame ({columns, rows}) feeds it through data; explicit columns/rows win", () => {
    const l = table({ data: { columns: ["a", "b"], rows: [[1, "x"], [2, "y"]] } });
    expect(l.order).toEqual(["header", "row_1", "row_2"]);
    const explicit = table({ data: { columns: ["a"], rows: [[1]] }, columns: ["z"], rows: [[9], [8], [7]] });
    expect(explicit.order).toEqual(["header", "row_1", "row_2", "row_3"]);
    expect(texts(explicit).map((d) => d.text)).toContain("z");
  });

  test("numeric columns are right-aligned, text columns left-aligned", () => {
    const l = table({ columns: ["name", "n"], rows: [["a", 1], ["b", 22]] });
    const cell = (id: string) => texts(l).find((d) => d.id === id)!;
    expect(cell("row_1__c0").anchor).toBe("start");
    expect(cell("row_1__c1").anchor).toBe("end");
  });

  test("rows beyond 24 (or beyond the box) are cut with a 'more rows' line", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i, i * 2]);
    const l = table({ columns: ["i", "2i"], rows });
    expect(l.order.filter((id) => id.startsWith("row_")).length).toBeLessThanOrEqual(24);
    expect(l.order).toContain("more");
    expect(texts(l).some((d) => /more rows/.test(d.text))).toBe(true);
  });

  test("an unresolved token draws just nothing (no header, no warnings) — rows beats come from typed data", () => {
    const l = table({ data: "{sim.df}" });
    expect(l.order).toEqual([]);
    expect(l.warnings).toEqual([]);
  });

  test("box confines the table", () => {
    const l = table({ columns: ["a"], rows: [[1]], box: { x: 500, y: 100, w: 400, h: 500 } });
    for (const d of texts(l)) expect(d.pos[0]).toBeGreaterThanOrEqual(500);
  });
});

describe("line_chart", () => {
  const line = (params: object) => layoutSpec({ template: "line_chart", params } as Spec);
  const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id) as StrokeDrawable | undefined;

  test("one series: axes, line_1 (polyline + end label), title; y follows the values", () => {
    const l = line({ x: [0, 1, 2], values: [2, 4, 8], title: "T", y_label: "Y" });
    expect(l.order).toEqual(["axes", "line_1", "title"]);
    const pts = stroke(l, "line_1__l")!.pts;
    expect(pts).toHaveLength(3);
    expect(pts[2][1]).toBeCloseTo(Y(8, 8, TITLED_TOP), 6);
    expect(pts[0][1]).toBeCloseTo(Y(2, 8, TITLED_TOP), 6);
    expect(pts[0][0]).toBeCloseTo(plot.x0, 6);
    expect(pts[2][0]).toBeCloseTo(plot.x1, 6);
    expect(l.warnings).toEqual([]);
  });

  test("series draw several lines with end labels dodged apart and series colours", () => {
    const l = line({ x: [0, 1], series: [{ name: "A", values: [1, 5] }, { name: "B", values: [1, 5.2] }] });
    expect(l.order).toEqual(["axes", "line_1", "line_2"]);
    const tA = flattenDrawables(l.drawables).find((d) => d.id === "line_1__t") as TextDrawable;
    const tB = flattenDrawables(l.drawables).find((d) => d.id === "line_2__t") as TextDrawable;
    expect(tA.text).toBe("A");
    expect(Math.abs(tA.pos[1] - tB.pos[1])).toBeGreaterThanOrEqual(44);
    expect(stroke(l, "line_1__l")!.style.color).toBe("#b5482e");
    expect(stroke(l, "line_2__l")!.style.color).toBe("#2f6b8f");
  });

  test("depth means staged: a fractional stage interpolates; limits span all stages", () => {
    const staged = { x: [0, 1, 2], values: [[2, 4, 8], [4, 8, 2]] };
    expect(stroke(line({ ...staged, stage: 0.5 }), "line_1__l")!.pts[0][1]).toBeCloseTo(Y(3, 8), 6);
    expect(stroke(line({ ...staged, stage: 1 }), "line_1__l")!.pts[2][1]).toBeCloseTo(Y(2, 8), 6);
    expect(stroke(line({ ...staged, stage: 7 }), "line_1__l")!.pts[0][1]).toBeCloseTo(Y(4, 8), 6);
  });

  test("a point absent from a stage grows out of its predecessor (prefix reveal)", () => {
    const l = line({ x: [0, 1, 2], values: [[5, 5], [5, 5, 9]], stage: 0.5 });
    const pts = stroke(l, "line_1__l")!.pts;
    expect(pts).toHaveLength(3);
    // third point halfway between the second point (x=1, y=5) and its target (x=2, y=9)
    expect(pts[2][0]).toBeCloseTo((plot.x0 + plot.x1) / 2 + (plot.x1 - (plot.x0 + plot.x1) / 2) / 2, 6);
    expect(pts[2][1]).toBeCloseTo((Y(5, 9) + Y(9, 9)) / 2, 6);
    expect(stroke(line({ x: [0, 1, 2], values: [[5, 5], [5, 5, 9]], stage: 0 }), "line_1__l")!.pts).toHaveLength(2);
  });

  test("categorical x draws the strings under the axis; absent x uses indices", () => {
    const l = line({ x: ["Q1", "Q2", "Q3"], values: [1, 2, 3] });
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toEqual(expect.arrayContaining(["Q1", "Q2", "Q3"]));
    const noX = line({ values: [1, 2, 3] });
    expect(stroke(noX, "line_1__l")!.pts[1][0]).toBeCloseTo((plot.x0 + plot.x1) / 2, 6);
  });

  test("points and smooth are optional decorations; the polyline stays the line_k__l stroke", () => {
    const l = line({ x: [0, 1, 2], values: [1, 2, 3], points: true, smooth: true });
    expect(flattenDrawables(l.drawables).some((d) => d.id === "line_1__p2")).toBe(true);
    expect(stroke(l, "line_1__l")!.pts.length).toBeGreaterThan(3); // smoothed
  });

  // Finding P: a `values` TOKEN with no series mints ONE anonymous zero
  // series, so line_1 exists offline exactly as bar_chart's bar_i beats do —
  // a model copying the bar_chart exemplar writes draw: ["axes", "line_1"]
  // and must not get "unknown id" before the script has run.
  test("the placeholder promise: series with token values keep their ids; a values token alone still mints line_1", () => {
    const l = line({ x: [0, 1, 2], series: [{ name: "A", values: "{sim.a}" }, { name: "B", values: "{sim.b}" }] });
    expect(l.order).toEqual(["axes", "line_1", "line_2"]);
    expect(l.warnings).toEqual([]);
    const tokenOnly = line({ x: [0, 1, 2], values: "{sim.y}" });
    expect(tokenOnly.order).toEqual(["axes", "line_1"]);
    expect(flattenDrawables(tokenOnly.drawables).find((d) => d.id === "line_1__l")).toMatchObject({ pts: [] });
    expect(tokenOnly.issues).toEqual([]);
  });

  test("caps: 6 series, 2000 points", () => {
    const many = line({ series: Array.from({ length: 8 }, (_, k) => ({ name: `s${k}`, values: [1, 2] })) });
    expect(many.order.filter((id) => id.startsWith("line_"))).toHaveLength(6);
  });

  // Fix round 1: numeric x shorter than values used to throw (fmt(xs[n-1])
  // on undefined) or emit a NaN point — Ruling D caps the index space to the
  // numeric x it has, silently dropping values beyond it (data_table's own
  // policy for extra rows).
  test("numeric x shorter than values: no throw, every point finite, pts capped to x.length", () => {
    const l = line({ x: [0, 1, 2], values: [1, 2, 3, 4, 5] });
    const pts = stroke(l, "line_1__l")!.pts;
    expect(pts).toHaveLength(3);
    for (const [px, py] of pts) expect(Number.isFinite(px) && Number.isFinite(py)).toBe(true);
    const x1 = flattenDrawables(l.drawables).find((d) => d.id === "axes__x1") as TextDrawable;
    expect(x1.text).toBe("2");
  });

  // Fix round 2: the y range and its end-label precision were still scanning
  // values dropped by the x cap above — [1,2,3,4,5] capped to the plotted
  // [1,2,3] must calibrate the axis to 3 (padded), not to the unseen 5; the
  // third point's y pins that (Y(3, 3), not Y(3, 5)).
  test("limits and end-label precision scan only the plotted prefix, not values the x cap dropped", () => {
    const l = line({ x: [0, 1, 2], values: [1, 2, 3, 4, 5] });
    const pts = stroke(l, "line_1__l")!.pts;
    expect(pts[2][1]).toBeCloseTo(Y(3, 3), 6);
    const y1 = flattenDrawables(l.drawables).find((d) => d.id === "axes__y1") as TextDrawable;
    expect(y1.text).toBe("3.2");
  });

  // Fix round 1: an xlim/ylim narrower than the data used to put points
  // thousands of units off-canvas — Ruling E clamps every data value into
  // [xMin, xMax] x [yMin, yMax] before scaling, exactly as bar_chart clamps
  // y (no geometric line clipping, just a clamped endpoint).
  test("xlim/ylim narrower than the data clamp every point into the plot rectangle", () => {
    const xClamped = line({ x: [0, 10, 20, 30], values: [1, 2, 3, 4], xlim: [0, 5] });
    for (const [px] of stroke(xClamped, "line_1__l")!.pts) {
      expect(px).toBeGreaterThanOrEqual(plot.x0 - 1e-6);
      expect(px).toBeLessThanOrEqual(plot.x1 + 1e-6);
    }
    const yClamped = line({ values: [1, 200, 5], ylim: [0, 3] });
    for (const [, py] of stroke(yClamped, "line_1__l")!.pts) {
      expect(py).toBeGreaterThanOrEqual(plot.y0 - 1e-6);
      expect(py).toBeLessThanOrEqual(plot.y1 + 1e-6);
    }
  });

  // Fix round 1: dec was forced to exactly 1 for any non-integer limit,
  // rounding sub-unit ranges to one digit ("0.3" for a 0.26 peak) — Ruling F
  // gives x and y their own precision, and an integer value on that axis is
  // still shown bare even when its other end needs decimals.
  test("sub-unit y and integer x each get their own axis-label precision", () => {
    const l = line({ x: [0, 50], values: [0.05, 0.2415] });
    const y0 = flattenDrawables(l.drawables).find((d) => d.id === "axes__y0") as TextDrawable;
    const y1 = flattenDrawables(l.drawables).find((d) => d.id === "axes__y1") as TextDrawable;
    expect(y1.text).toBe("0.26");
    expect(y0.text).toBe("0");
    const x0 = flattenDrawables(l.drawables).find((d) => d.id === "axes__x0") as TextDrawable;
    const x1 = flattenDrawables(l.drawables).find((d) => d.id === "axes__x1") as TextDrawable;
    expect(x0.text).toBe("0");
    expect(x1.text).toBe("50");
  });

  // Ruling I: a stacked x caption (a long phrase, not short enough to sit
  // inline past the arrow) shares its row with axes__x1 — X_CAPTION_DROP
  // pushes it one row lower so it clears the mark; a short caption still
  // sits inline at the axis line itself.
  //
  // "Years" is NOT actually short here — measured at 5 * 22 * 0.52 = 57.2
  // logical units, it exceeds both the inline cap (2.5 * fontSize = 55) and
  // the room the default plot leaves before the canvas edge (beyondArrow =
  // 34); it already lands in the stacked branch (confirmed against the real
  // axisLabelPlacement/kit.axisLabel), so it exercises the SAME dropped
  // placement as the long-phrase case, not the inline one. "Yr" (2
  // characters, 22.9 units) is what genuinely triggers the inline branch.
  test("a long x_label drops below axes__x1 with no overlap lint; a short one still lands inline", () => {
    const long = line({ x: [0, 1, 2], values: [1, 2, 3], x_label: "A long axis caption" });
    expect(long.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
    const cap = flattenDrawables(long.drawables).find((d) => d.id === "axes__x_label") as TextDrawable;
    const mark = flattenDrawables(long.drawables).find((d) => d.id === "axes__x1") as TextDrawable;
    expect(cap.pos[1]).toBeLessThan(mark.pos[1]);
    const short = line({ x: [0, 1, 2], values: [1, 2, 3], x_label: "Yr" });
    const shortCap = flattenDrawables(short.drawables).find((d) => d.id === "axes__x_label") as TextDrawable;
    expect(shortCap.pos[1]).toBe(plot.y0);
  });

  // Same collision, categorical x this time: the caption shares its row with
  // the last axes__c category label instead of a numeric mark.
  test("a long x_label also clears the last categorical label, no overlap lint", () => {
    const l = line({ x: ["Q1", "Q2", "Q3"], values: [1, 2, 3], x_label: "A long axis caption" });
    expect(l.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
  });

  // Finding C1: the end label is drawn PAST the last point, so the plot gives
  // up the width it needs (did_trends' convention). Before this, "Infected"
  // at the default x1 = 930 reached 1021 — off the 1000-wide canvas, an ERROR.
  test("a named series reserves right margin: the end label stays on the canvas", () => {
    const l = line({ x: [0, 1], series: [{ name: "Infected", values: [1, 2] }] });
    expect(l.issues.filter((i) => i.rule === "out-of-canvas")).toEqual([]);
    const t = flattenDrawables(l.drawables).find((d) => d.id === "line_1__t") as TextDrawable;
    expect(t.anchor).toBe("start");
    expect(t.pos[0] + heuristicMeasure(t.text, t.fontSize).w).toBeLessThanOrEqual(1000);
  });

  // Finding I6: the dodge resolves around the CLUSTER'S CENTRE and is capped
  // at the y arrow's tip — four series converging near the top used to walk
  // the topmost label to y = 759, off the 750-tall canvas.
  test("four series converging at the top dodge symmetrically and stay under the y arrow", () => {
    const l = line({
      x: [0, 1],
      series: [
        { name: "A", values: [1, 9] },
        { name: "B", values: [1, 9.1] },
        { name: "C", values: [1, 9.2] },
        { name: "D", values: [1, 9.3] },
      ],
    });
    expect(l.issues.filter((i) => i.rule === "out-of-canvas")).toEqual([]);
    const ys = ["line_1__t", "line_2__t", "line_3__t", "line_4__t"]
      .map((id) => (flattenDrawables(l.drawables).find((d) => d.id === id) as TextDrawable).pos[1])
      .sort((a, b) => a - b);
    for (const y of ys) expect(y).toBeLessThanOrEqual(plot.y1 + AXIS_OVERHANG);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(44);
  });

  test("an unnamed series reserves nothing: the line still ends at plot.x1", () => {
    const l = line({ x: [0, 1, 2], values: [1, 2, 3] });
    expect(stroke(l, "line_1__l")!.pts[2][0]).toBeCloseTo(plot.x1, 6);
  });
});

describe("scatter_plot", () => {
  const sc = (params: object) => layoutSpec({ template: "scatter_plot", params } as Spec);
  const find = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id);

  test("unlabelled points share the points group; labelled ones are their own beats", () => {
    const l = sc({ x: [1, 2, 3], y: [2, 4, 8], labels: ["", "B", ""] });
    expect(l.order).toEqual(["axes", "points", "point_2"]);
    expect(find(l, "points__d1")).toBeDefined();
    expect(find(l, "points__d2")).toBeUndefined();
    expect((find(l, "point_2__t") as TextDrawable).text).toBe("B");
  });

  // Ruling B: the template pads xMax by 6 % — x: 0..3 → xMin 0, xMax 3.18 —
  // so d4 (x=3) sits at plot.x0 + (3 / 3.18) * (plot.x1 - plot.x0), not at
  // plot.x1. The fit expectation is simplified to the scale arithmetic: with
  // y: 1..7, yMin = 0, yMax = 7 * 1.08, and the fitted line at x = 0 is y = 1.
  test("dots sit at the scaled positions; a fit: true line is least squares", () => {
    const l = sc({ x: [0, 1, 2, 3], y: [1, 3, 5, 7], fit: true });
    const d = find(l, "points__d4") as StrokeDrawable;
    const cx = d.pts.reduce((a, p) => a + p[0], 0) / d.pts.length;
    expect(cx).toBeCloseTo(plot.x0 + (3 / 3.18) * (plot.x1 - plot.x0), 0);
    const fit = find(l, "fit_line__l") as StrokeDrawable;
    expect(fit.pts[0][1]).toBeCloseTo(plot.y0 + (1 / (7 * 1.08)) * (plot.y1 - plot.y0), 4);
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 2.00x + 1.00");
  });

  test("fit: [slope, intercept] draws the given line (animatable numbers)", () => {
    const l = sc({ x: [0, 4], y: [0, 4], fit: [0.5, 1] });
    const fit = find(l, "fit_line__l") as StrokeDrawable;
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 0.50x + 1.00");
    expect(fit.pts).toHaveLength(2);
  });

  // Ruling B: x: [0,1,2] → xMax 2.12 — d3's centre is the midpoint of X(1)
  // and X(2), not the midpoint of plot.x0/plot.x1.
  test("staged y interpolates and an appearing point grows out of its predecessor", () => {
    const l = sc({ x: [0, 1, 2], y: [[1, 1], [1, 1, 3]], stage: 0.5 });
    expect(l.order).toEqual(["axes", "points"]);
    const d3 = find(l, "points__d3") as StrokeDrawable;
    expect(d3).toBeDefined();
    const cx = d3.pts.reduce((a, p) => a + p[0], 0) / d3.pts.length;
    expect(cx).toBeCloseTo(plot.x0 + ((1 + 2) / 2 / 2.12) * (plot.x1 - plot.x0), 0);
  });

  test("placeholder: typed x with a token y → n dots at the floor; both tokens → axes only", () => {
    const l = sc({ x: [1, 2, 3], y: "{sim.y}" });
    expect(l.order).toEqual(["axes", "points"]);
    expect(find(l, "points__d3")).toBeDefined();
    expect(l.warnings).toEqual([]);
    expect(sc({ x: "{sim.x}", y: "{sim.y}" }).order).toEqual(["axes"]);
  });

  // Ruling C: a fit that is still a token string behaves as fit: true (least
  // squares through the current — offline: placeholder — points), so the
  // fit_line beat exists (and every command id resolves) before the script
  // runs.
  test("a fit that is still a token string behaves as fit: true so fit_line exists before the script runs", () => {
    const l = sc({ x: [1, 2, 3], y: "{sim.y}", fit: "{sim.fit}" });
    expect(l.order).toEqual(["axes", "points", "fit_line"]);
    expect(l.warnings).toEqual([]);
  });

  test("caps at 500 points", () => {
    const l = sc({ x: Array.from({ length: 600 }, (_, i) => i), y: Array.from({ length: 600 }, (_, i) => i) });
    expect(find(l, "points__d500")).toBeDefined();
    expect(find(l, "points__d501")).toBeUndefined();
  });

  // Ruling H: X/Y clamp the data value into [xMin, xMax]/[yMin, yMax] before
  // scaling, so a narrower ylim never sends a dot or the fit line off-canvas
  // — the same policy line_chart applies (Ruling E there). Finding 1: the
  // fit itself must still regress on the REAL data (y = 2x + 66.67 for
  // (0,1),(1,200),(2,5)), not on the clipped y = 3 the drawing clamps
  // point 2 to — a clamp for drawing is not a clamp for the numbers.
  test("ylim narrower than the data clamps every dot and the fit line into the plot rectangle, but fits the real data", () => {
    const l = sc({ x: [0, 1, 2], y: [1, 200, 5], ylim: [0, 3], fit: true });
    for (const id of ["points__d1", "points__d2", "points__d3"]) {
      const d = find(l, id) as StrokeDrawable;
      const cy = d.pts.reduce((a, p) => a + p[1], 0) / d.pts.length;
      expect(cy).toBeGreaterThanOrEqual(plot.y0 - 1e-6);
      expect(cy).toBeLessThanOrEqual(plot.y1 + 1e-6);
    }
    const fit = find(l, "fit_line__l") as StrokeDrawable;
    for (const [, py] of fit.pts) {
      expect(py).toBeGreaterThanOrEqual(plot.y0 - 1e-6);
      expect(py).toBeLessThanOrEqual(plot.y1 + 1e-6);
    }
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 2.00x + 66.67");
  });

  // Finding 1: the appear/disappear lerp that builds the fit's data points
  // must mirror the position lerp exactly (same predecessor logic), just in
  // unclamped data space — a staged fit follows the INTERPOLATED points.
  test("a staged fit: true regresses on the interpolated data, not the endpoints", () => {
    const l = sc({ x: [0, 1, 2], y: [[0, 0, 0], [0, 2, 4]], stage: 0.5, fit: true });
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 1.00x + 0.00");
  });

  // Ruling H: per-axis precision (decX/decY + fmtX/fmtY) and all four axis
  // end marks (x0, x1, y0, y1) — the plan's shared geometry rules, mirroring
  // line_chart's own end-label test.
  test("sub-unit y and integer x each get their own axis-label precision, on all four axis ends", () => {
    const l = sc({ x: [0, 50], y: [0.05, 0.2415] });
    expect((find(l, "axes__y1") as TextDrawable).text).toBe("0.26");
    expect((find(l, "axes__y0") as TextDrawable).text).toBe("0");
    expect((find(l, "axes__x1") as TextDrawable).text).toBe("53");
    expect((find(l, "axes__x0") as TextDrawable).text).toBe("0");
  });

  // Ruling I: same collision as line_chart's numeric axes__x1 — a stacked
  // x_label drops below the mark row instead of the example's content
  // changing to dodge it.
  test("a long x_label drops below axes__x1 with no overlap lint", () => {
    const l = sc({ x: [1, 2, 3], y: [1, 2, 3], x_label: "Hours studied" });
    expect(l.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
  });
});
