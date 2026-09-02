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
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import { DEFAULT_SETTINGS } from "../src/store";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  const r = registerPack("data", dataYaml);
  expect(r.errors).toEqual([]);
});

const plot = plotArea();
/** A titled chart with no box lowers its own plot top by 55, to clear the y caption. */
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
  });

  test("every manifest example lays out with zero warnings and no error lint", () => {
    for (const tid of ["bar_chart", "data_table"]) {
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
});

// The title and the y-axis caption both want the strip above the plot: the
// caption is centred at (y arrow tip + 12 + half its box), the title sat at
// plot.y1 + 25, three units BELOW that tip. They shared a band. The title now
// reads the caption's actual position out of the axes group, and an untitled
// default plot keeps its old top so nothing else moves.
describe("bar_chart — the title clears the y caption", () => {
  const textAt = (l: ReturnType<typeof layoutSpec>, id: string) =>
    flattenDrawables(l.drawables).find((d) => d.id === id) as TextDrawable | undefined;

  test("no box: the plot top drops to 620 and the title sits a clear band above the caption", () => {
    const l = layout({ labels: ["a", "b"], values: [1, 2], title: "A long enough title", y_label: "Share of rolls" });
    const yAxis = flattenDrawables(l.drawables).find((d) => d.id === "axes__y") as { pts: [number, number][] };
    expect(Math.max(...yAxis.pts.map((p) => p[1]))).toBeCloseTo(TITLED_TOP + AXIS_OVERHANG, 6);
    const cap = textAt(l, "axes__y_label")!;
    const title = textAt(l, "title")!;
    expect(title.pos[1]).toBeGreaterThanOrEqual(cap.pos[1] + 28);
    expect(title.pos[1]).toBeLessThanOrEqual(730);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("an explicit box is honoured — its own top, and the title still sits above the caption", () => {
    const l = layout({
      labels: ["a", "b"],
      values: [1, 2],
      title: "A long enough title",
      y_label: "Share of rolls",
      box: { x: 120, y: 95, w: 855, h: 580 },
    });
    const yAxis = flattenDrawables(l.drawables).find((d) => d.id === "axes__y") as { pts: [number, number][] };
    expect(Math.max(...yAxis.pts.map((p) => p[1]))).toBeCloseTo(675 + AXIS_OVERHANG, 6);
    const cap = textAt(l, "axes__y_label")!;
    const title = textAt(l, "title")!;
    expect(title.pos[1]).toBeGreaterThan(cap.pos[1]);
    expect(title.pos[1]).toBeLessThanOrEqual(730);
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
