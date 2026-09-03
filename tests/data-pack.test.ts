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
import { templateParamErrors } from "../src/scenes/params-check";
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

  test("every manifest example lays out with zero warnings and no lint issues, warn or error", () => {
    // Scoped to the data pack's own templates only — not the catalog-wide
    // exemplar tests, which are somebody else's surface. A `warn`-severity
    // lint issue (overlap-label-label, say) used to slip through here
    // because only `severity === "error"` was checked; that blind spot is
    // load-bearing for this round's later, label-dense templates (race
    // charts, a heatmap), so every issue — not just errors — must be empty.
    for (const tid of ["bar_chart", "data_table", "line_chart", "scatter_plot"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params } as Spec);
        expect(res.warnings, `${tid}: ${ex.request}`).toEqual([]);
        expect(res.issues, `${tid}: ${ex.request}`).toEqual([]);
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

describe("stacked bars", () => {
  const stacked = (extra: object = {}) =>
    layout({
      labels: ["A", "B"],
      series: [
        { name: "One", values: [3, 1] },
        { name: "Two", values: [1, 3] },
      ],
      stacked: true,
      ...extra,
    });

  test("segments sit on top of each other, totals equal across categories", () => {
    const l = stacked();
    const seg = (i: number, j: number) => area(l, `bar_${i}__f${j}`)!.pts.map((p) => p[1]);
    // Series 0 starts at the axis; series 1 starts where series 0 ended.
    expect(Math.min(...seg(1, 0))).toBeCloseTo(plot.y0, 1);
    expect(Math.min(...seg(1, 1))).toBeCloseTo(Math.max(...seg(1, 0)), 1);
    // Both stacks total 4, so both reach the same height.
    expect(Math.max(...seg(1, 1))).toBeCloseTo(Math.max(...seg(2, 1)), 1);
  });

  test("the y scale comes from stack totals, not the largest single value", () => {
    const l = stacked();
    // Totals are 4; a grouped chart would scale to the largest bar, 3.
    const top = Math.max(...area(l, "bar_1__f1")!.pts.map((p) => p[1]));
    expect(top).toBeCloseTo(Y(4, 4), 0);
  });

  test("mixed signs refuse to stack: a drawn note names the series, bars group instead", () => {
    const l = layout({
      labels: ["A"],
      series: [
        { name: "Up", values: [3] },
        { name: "Down", values: [-2] },
      ],
      stacked: true,
    });
    // A template body has no warning channel — SceneLayout carries drawables,
    // and `issues` come from lintLayout. A refusal is therefore DRAWN, under
    // the id `note`, so the author sees it on the figure.
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as TextDrawable | undefined;
    expect(note?.text).toMatch(/stacked/i);
    expect(note?.text).toMatch(/Down/);
    // Grouped fallback: the two bars are side by side, so their x spans differ.
    const x = (j: number) => area(l, `bar_1__f${j}`)!.pts.map((p) => p[0]);
    expect(Math.min(...x(0))).not.toBeCloseTo(Math.min(...x(1)), 1);
  });

  test("a fractional stage interpolates stacked segment heights", () => {
    const l = layout({
      labels: ["A"],
      series: [
        { name: "One", values: [[2], [4]] },
        { name: "Two", values: [[2], [2]] },
      ],
      stacked: true,
      stage: 0.5,
    });
    // Series 0 is 2 → 4, half-way is 3; the stack total is 5.
    expect(Math.max(...area(l, "bar_1__f0")!.pts.map((p) => p[1]))).toBeCloseTo(Y(3, 6), 0);
  });

  test("value labels: the stack total clears the top segment's own label instead of colliding with it", () => {
    const l = stacked({ value_labels: true });
    // Category A's top segment (series "Two", value 1 on a stack of 4) is
    // tall enough to earn its own label — the collision case: its anchor is
    // mathematically the same point the total label wants (segBase + v is
    // the stack total for the last series).
    const segLabel = flattenDrawables(l.drawables).find((d) => d.id === "bar_1__v1") as TextDrawable;
    const totalLabel = flattenDrawables(l.drawables).find((d) => d.id === "bar_1__total") as TextDrawable;
    expect(segLabel).toBeDefined();
    expect(totalLabel).toBeDefined();
    expect(segLabel.pos[0]).toBeCloseTo(totalLabel.pos[0], 6); // same column
    expect(totalLabel.pos[1] - segLabel.pos[1]).toBeCloseTo(24, 6); // lifted clear, not stacked on top of it
  });

  test("a long series name truncates the refusal note so it clears the legend", () => {
    const longName = "A very long series name that would otherwise run straight into the legend box";
    const l = layout({
      labels: ["A"],
      series: [
        { name: "Up", values: [3] },
        { name: longName, values: [-2] },
      ],
      stacked: true,
    });
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as TextDrawable;
    expect(note.text).toMatch(/…$/);
    const legendX = plot.x1 - 150; // where the legend's swatch starts (m >= 2 whenever a note can exist)
    const noteW = heuristicMeasure(note.text, note.fontSize).w;
    expect(note.pos[0] + noteW).toBeLessThan(legendX);
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

  // Ruling T: a curve that ends AT the floor (an epidemic burning out) put its
  // name straight on top of the inline x caption, which axisLabelPlacement
  // sets in line with the axis just past the arrow tip. The dodge floor is
  // therefore plot.y0 + END_LABEL_FLOOR (28): half a 22pt caption box (13.75)
  // + half a 19pt label box (11.875) + the lint's own 2-unit pad = 27.625.
  const END_LABEL_FLOOR = 28;
  test("an end label never sits in the x caption's row", () => {
    const l = line({ x: [0, 1, 2], series: [{ name: "Infected", values: [5, 1, 0] }], x_label: "Days" });
    expect(l.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
    const t = flattenDrawables(l.drawables).find((d) => d.id === "line_1__t") as TextDrawable;
    expect(t.pos[1]).toBeGreaterThanOrEqual(plot.y0 + END_LABEL_FLOOR);
    // The caption really is the inline one, sharing the label's row-of-origin.
    const cap = flattenDrawables(l.drawables).find((d) => d.id === "axes__x_label") as TextDrawable;
    expect(cap.pos[1]).toBe(plot.y0);
  });

  test("a line ending mid-plot keeps its label exactly at its own end", () => {
    const l = line({ x: [0, 1, 2], series: [{ name: "Infected", values: [1, 3, 5] }], x_label: "Days" });
    const t = flattenDrawables(l.drawables).find((d) => d.id === "line_1__t") as TextDrawable;
    expect(t.pos[1]).toBeCloseTo(stroke(l, "line_1__l")!.pts[2][1], 6);
    expect(t.pos[1]).toBeGreaterThan(plot.y0 + END_LABEL_FLOOR);
  });
});

// Task 2: slope mode. Real ids confirmed by reading the body (Step 1): a
// series line is "line_<k>__l" and its (single-sided) end label is
// "line_<k>__t" — both already match the brief's placeholder id lookups
// (".includes(\"1\")"/".includes(\"2\")" on strokes). The one correction
// needed was TextDrawable's own field name: it carries `pos`, not `at`.
describe("slope mode", () => {
  const slope = (extra: object = {}) =>
    layoutSpec({
      template: "line_chart",
      params: {
        slope: true,
        x: ["Before", "After"],
        series: [
          { name: "Treated", values: [10, 16] },
          { name: "Control", values: [12, 9] },
        ],
        ...extra,
      },
    } as Spec);

  test("both ends carry a name and a value", () => {
    const texts = flattenDrawables(slope().drawables).filter((d) => d.kind === "text") as TextDrawable[];
    const treated = texts.filter((t) => /Treated/.test(t.text));
    expect(treated.length).toBe(2);
    expect(Math.min(...treated.map((t) => t.pos[0]))).toBeLessThan(Math.max(...treated.map((t) => t.pos[0])));
  });

  test("labels on the same side never overlap", () => {
    const l = slope({
      series: [
        { name: "A", values: [10, 10.05] },
        { name: "B", values: [10.1, 10] },
      ],
    });
    expect(l.issues.filter((i) => /overlap/i.test(i.message))).toEqual([]);
  });

  // Fix round 2 (coordinator review): the original fixture (Treated rises at
  // index 0, Control falls at index 1) made this tautological — default
  // per-series colouring already gives index 0 and index 1 different inks,
  // so the assertion passed whether or not direction colouring existed. This
  // fixture puts index and direction at odds — index 0 FALLS, index 1 and 2
  // both RISE — so only grouping by rise/fall (not position) can satisfy it.
  test("color_by direction groups by rise/fall, not by series index", () => {
    const l = slope({
      color_by: "direction",
      series: [
        { name: "A", values: [16, 10] }, // index 0, falls
        { name: "B", values: [10, 16] }, // index 1, rises
        { name: "C", values: [9, 20] }, // index 2, rises
      ],
    });
    const strokes = flattenDrawables(l.drawables).filter((d) => d.kind === "stroke") as StrokeDrawable[];
    const colorOf = (id: string) => strokes.find((d) => d.id === id)!.style.color;
    const a = colorOf("line_1__l"), b = colorOf("line_2__l"), c = colorOf("line_3__l");
    expect(b).toBe(c); // both rise, share an ink despite different indices
    expect(a).not.toBe(b); // falls, so differs from the rising pair
  });

  test("more than two values per series draws the refusal note", () => {
    const l = slope({ series: [{ name: "A", values: [1, 2, 3] }] });
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as TextDrawable | undefined;
    expect(note?.text).toMatch(/slope/i);
    expect(note?.text).toMatch(/two/i);
  });

  // Fix round: the placeholder promise — the editor lints BEFORE the script
  // has run, so a still-unresolved "{code.var}" token must lay out as a
  // quiet placeholder, never an error state. The exactly-two-values check
  // must exempt a token-fed series exactly as the limits scan already does
  // (Finding P), so a slope chart fed by a script draws its frame (two
  // columns, the captions) with no connector, not the refusal note, before
  // the script has had any chance to run.
  test("a still-unresolved values token draws the frame with no connector, not the refusal note", () => {
    const l = layoutSpec({
      template: "line_chart",
      params: { slope: true, x: ["Before", "After"], values: "{sim.pairs}" },
    } as Spec);
    expect(flattenDrawables(l.drawables).find((d) => d.id === "note")).toBeUndefined();
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(l.order).toEqual(["axes", "line_1"]);
    const drawables = flattenDrawables(l.drawables);
    expect(drawables.some((d) => d.id === "axes__col0")).toBe(true);
    expect(drawables.some((d) => d.id === "axes__col1")).toBe(true);
    expect((drawables.find((d) => d.id === "line_1__l") as StrokeDrawable).pts).toEqual([]);
    expect(drawables.some((d) => d.id === "line_1__t0" || d.id === "line_1__t1")).toBe(false);
  });

  // Fix round 2 (coordinator review, minor): "the two columns' values may
  // change per stage" was a named constraint on this feature, but nothing
  // exercised staging through the slope branch — slopeValue() reuses the
  // shared at()/k0/k1/t machinery, so a fractional stage should interpolate
  // both ends exactly like the rest of the chart does.
  test("a staged slope interpolates both ends at a fractional stage", () => {
    const l = slope({
      series: [{ name: "Treated", values: [[10, 16], [20, 24]] }],
      stage: 0.5,
    });
    const texts = flattenDrawables(l.drawables).filter((d) => d.kind === "text") as TextDrawable[];
    const t0 = texts.find((t) => t.id === "line_1__t0")!;
    const t1 = texts.find((t) => t.id === "line_1__t1")!;
    // Stage 0: [10, 16]; stage 1: [20, 24]; halfway: [15, 20].
    expect(t0.text).toBe("Treated 15");
    expect(t1.text).toBe("Treated 20");
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

  // Fix: constant data must not collapse onto the axis. A degenerate range
  // (hi - lo < 1e-9) around a non-zero v expands to [min(0, 2v), max(0, 2v)]
  // BEFORE the snap/headroom logic runs, so the dots land in the MIDDLE of
  // an axis that starts (or ends) at 0, not on the axis line itself.
  // y: 5,5,5 -> lo=hi=5 -> expands to [0, 10] -> snaps to zero (0 <= 0.25 *
  // 10) -> + 8 % headroom on the top only -> yMin = 0, yMax = 10 * 1.08 =
  // 10.8. axes__y1 names the data's own extreme (Finding I3), which is the
  // EXPANDED range's own hi = 10 (an integer, so it prints bare).
  test("constant y is centred on the axis, not drawn on it", () => {
    const l = sc({ x: [1, 2, 3], y: [5, 5, 5] });
    const lo = plot.y0 + 0.3 * (plot.y1 - plot.y0);
    const hi = plot.y0 + 0.7 * (plot.y1 - plot.y0);
    for (const id of ["points__d1", "points__d2", "points__d3"]) {
      const d = find(l, id) as StrokeDrawable;
      const cy = d.pts.reduce((a, p) => a + p[1], 0) / d.pts.length;
      expect(cy).toBeGreaterThan(lo);
      expect(cy).toBeLessThan(hi);
    }
    expect((find(l, "axes__y1") as TextDrawable).text).toBe("10");
  });

  // x: 4,4,4 -> lo=hi=4 -> expands to [0, 8] -> snaps to zero -> + 6 %
  // headroom -> xMin = 0, xMax = 8 * 1.06 = 8.48. X(4) = x0 + (4 / 8.48) *
  // width ~= x0 + 0.472 * width, comfortably inside the middle 40 %.
  test("constant x is centred on the axis, not drawn on it", () => {
    const l = sc({ x: [4, 4, 4], y: [1, 2, 3] });
    const lo = plot.x0 + 0.3 * (plot.x1 - plot.x0);
    const hi = plot.x0 + 0.7 * (plot.x1 - plot.x0);
    for (const id of ["points__d1", "points__d2", "points__d3"]) {
      const d = find(l, id) as StrokeDrawable;
      const cx = d.pts.reduce((a, p) => a + p[0], 0) / d.pts.length;
      expect(cx).toBeGreaterThan(lo);
      expect(cx).toBeLessThan(hi);
    }
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
  //
  // Finding I3 changed the two HIGH marks: they now name the data's own
  // extreme at that extreme's position instead of the padded limit under the
  // arrowhead. Both LOW ends here snapped to 0 (x: 0 <= 0.25*50; y: 0.05 <=
  // 0.25*0.2415 = 0.0604), so they still name the frame at the axis end.
  // x1: "53" (= 50 + 6 %) -> "50" at X(50) = x0 + (50/53) * width.
  // y1: "0.26" (= 0.2415 + 8 %) -> "0.24" (decY = 2) at Y(0.2415).
  test("sub-unit y and integer x each get their own axis-label precision, on all four axis ends", () => {
    const l = sc({ x: [0, 50], y: [0.05, 0.2415] });
    const y1 = find(l, "axes__y1") as TextDrawable;
    expect(y1.text).toBe("0.24");
    expect(y1.pos[1]).toBeCloseTo(plot.y0 + (0.2415 / (0.2415 * 1.08)) * (plot.y1 - plot.y0), 6);
    expect((find(l, "axes__y0") as TextDrawable).text).toBe("0");
    expect((find(l, "axes__y0") as TextDrawable).pos[1]).toBeCloseTo(plot.y0, 6);
    const x1 = find(l, "axes__x1") as TextDrawable;
    expect(x1.text).toBe("50");
    expect(x1.pos[0]).toBeCloseTo(plot.x0 + (50 / 53) * (plot.x1 - plot.x0), 6);
    expect((find(l, "axes__x0") as TextDrawable).text).toBe("0");
    expect((find(l, "axes__x0") as TextDrawable).pos[0]).toBeCloseTo(plot.x0, 6);
  });

  // Finding I2: data-range axes. Scores that live at 44…93 no longer waste
  // the bottom half of the plot on empty space — the axis runs from the data
  // minus 8 % headroom to the data plus 8 %, and BOTH end marks name data.
  test("an axis whose data sit far from the origin runs over the data range, marks and all", () => {
    const l = sc({ x: [10, 20], y: [44.2, 93.4] });
    const pad = (93.4 - 44.2) * 0.08;
    const y0 = find(l, "axes__y0") as TextDrawable;
    expect(y0.text).toBe("44.2");
    expect(y0.pos[1]).toBeCloseTo(plot.y0 + (pad / (93.4 - 44.2 + 2 * pad)) * (plot.y1 - plot.y0), 6);
    expect((find(l, "axes__y1") as TextDrawable).text).toBe("93.4");
    // x: 10 > 0.25 * 20, so no snap there either — 6 % headroom on both sides.
    expect((find(l, "axes__x0") as TextDrawable).text).toBe("10");
    expect((find(l, "axes__x1") as TextDrawable).text).toBe("20");
  });

  // Ruling I: same collision as line_chart's numeric axes__x1 — a stacked
  // x_label drops below the mark row instead of the example's content
  // changing to dodge it.
  test("a long x_label drops below axes__x1 with no overlap lint", () => {
    const l = sc({ x: [1, 2, 3], y: [1, 2, 3], x_label: "Hours studied" });
    expect(l.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
  });

  // Finding I1: the fit segment is CLIPPED to the plot rectangle, not clamped
  // at its endpoints. Clamping kept each endpoint's x and moved its y, so
  // this very fixture captioned "y = 2.00x + 1.00" and drew slope 0.63.
  test("a fit line outside the ylim is clipped, so the drawn slope is the slope the caption states", () => {
    const l = sc({ x: [0, 1, 2, 3], y: [1, 3, 5, 7], fit: true, ylim: [0, 3] });
    const seg = (find(l, "fit_line__l") as StrokeDrawable).pts;
    expect(seg).toHaveLength(2);
    // x: 0..3 snaps to the origin, +6 % headroom -> [0, 3.18]; ylim is verbatim.
    const xOf = (px: number) => ((px - plot.x0) / (plot.x1 - plot.x0)) * 3.18;
    const yOf = (py: number) => ((py - plot.y0) / (plot.y1 - plot.y0)) * 3;
    expect((yOf(seg[1][1]) - yOf(seg[0][1])) / (xOf(seg[1][0]) - xOf(seg[0][0]))).toBeCloseTo(2, 6);
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 2.00x + 1.00");
    for (const [px, py] of seg) {
      expect(px).toBeGreaterThanOrEqual(plot.x0 - 1e-6);
      expect(px).toBeLessThanOrEqual(plot.x1 + 1e-6);
      expect(py).toBeGreaterThanOrEqual(plot.y0 - 1e-6);
      expect(py).toBeLessThanOrEqual(plot.y1 + 1e-6);
    }
  });

  // Findings S2/I7: the equation caption tries four spots around the
  // segment's ends and takes the first that clears every dot, the title and
  // the axis captions. The hours example (with the smoke's resolved values)
  // is the case that used to put it on a dot.
  test("the fit caption finds a clear spot: no overlap and no label-on-stroke in the hours example", () => {
    const l = sc({
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      y: [44.2, 56.2, 59.3, 52.9, 58.2, 60.8, 71.4, 71.7, 80.5, 68.9, 93.4, 87.4],
      fit: [3.73, 42.84],
      ylim: [0, 100],
      x_label: "Hours studied",
      y_label: "Score",
      box: { x: 470, y: 95, w: 460, h: 560 },
    });
    expect(l.issues.filter((i) => i.rule.includes("overlap"))).toEqual([]);
    expect(l.issues).toEqual([]);
  });

  test("the fit caption also clears the title", () => {
    const l = sc({ x: [0, 1, 2, 3], y: [1, 3, 5, 7], fit: true, title: "T" });
    const cap = find(l, "fit_line__t") as TextDrawable;
    const t = find(l, "title") as TextDrawable;
    expect(l.issues.filter((i) => i.rule === "overlap-label-label" && i.ids.includes(cap.id) && i.ids.includes(t.id))).toEqual([]);
  });

  // Fix: the caption candidate picker now also rejects a spot the fit
  // SEGMENT ITSELF crosses. A negative slope through (0,7)..(3,1) puts
  // "above the right end" (the picker's first-tried spot) right on the
  // line — the old obstacle set never checked the line, only dots/title/
  // axis captions, so it picked that spot and the lint flagged the label
  // sitting on the stroke.
  test("a negative-slope fit's caption avoids sitting on the fit line itself", () => {
    const l = sc({ x: [0, 1, 2, 3], y: [7, 5, 3, 1], fit: true });
    expect(l.issues.filter((i) => i.rule === "overlap-label-stroke")).toEqual([]);
  });

  // Fix: the caption candidate picker now also treats every named point's
  // label (point_i__t) as an obstacle, built from the same numbers the
  // label is drawn with (fontSize 16, anchor start, pos [p0+10, p1+12]).
  test("the fit caption avoids a named point's label", () => {
    const l = sc({ x: [0, 1, 2, 3], y: [1, 3, 5, 7], labels: ["", "", "", "D"], fit: true });
    const cap = find(l, "fit_line__t") as TextDrawable;
    const lbl = find(l, "point_4__t") as TextDrawable;
    expect(l.issues.filter((i) => i.rule === "overlap-label-label" && i.ids.includes(cap.id) && i.ids.includes(lbl.id))).toEqual([]);
  });

  // Fix (rule b), and this fixture actually discriminates: pre-fix, the
  // picker only knew about the two axis CAPTIONS, not the four end marks —
  // this fit's caption landed squarely on axes__x1 ("11"), and the real
  // lint reported `overlap-label-label` between "axes__x1" and
  // "fit_line__t". Post-fix, axes__x0/x1/y0/y1 are obstacles too, so the
  // picker moves on to a clear spot.
  test("the fit caption avoids the axis end marks, not just the axis captions", () => {
    const l = sc({ x: [10, 11], y: [60, 50], fit: true });
    expect(l.issues.filter((i) => i.rule.includes("overlap") && i.ids.includes("fit_line__t"))).toEqual([]);
  });

  // Fix (rule c), and this fixture actually discriminates: pre-fix, the
  // picker's first-tried spot ("above the right end": the right endpoint of
  // fit_line__l plus an 18-unit offset, anchor end) was accepted because
  // nothing in the old obstacle set (dots/title/axis captions) sat there —
  // even though the fit segment itself ran straight through that box. The
  // real caption ended up 18 units above the line at that x. Post-fix, the
  // new segment-vs-box check rejects that spot and the picker falls through
  // to "below the right end" instead — a 2 x 18 = 36-unit jump (measured:
  // 440.95 -> 404.95). Recheck both claims directly: the caption is not at
  // the rejected spot, and the segment genuinely does not cross the box the
  // caption actually got, using the same point-in-box + edge-crossing test
  // the layout body uses (box = kit.textWidth-equivalent width x fontSize *
  // 1.25, matching the lint's own measure).
  test("the fit caption skips a spot the fit segment itself would cross", () => {
    const l = sc({ x: [0, 5, 10], y: [10, 1, 9], fit: true });
    const line = find(l, "fit_line__l") as StrokeDrawable;
    const cap = find(l, "fit_line__t") as TextDrawable;
    const [a, b] = line.pts;
    const CAP_DY = 18;
    const aboveRightEnd: [number, number] = [b[0], b[1] + CAP_DY];
    expect(cap.pos).not.toEqual(aboveRightEnd);

    const w = heuristicMeasure(cap.text, cap.fontSize).w;
    const h = cap.fontSize * 1.25;
    const box = {
      x: cap.anchor === "end" ? cap.pos[0] - w : cap.anchor === "start" ? cap.pos[0] : cap.pos[0] - w / 2,
      y: cap.pos[1] - h / 2,
      w,
      h,
    };
    const pointInBox = (p: [number, number]) => p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h;
    const cross = (u: [number, number], v: [number, number], p: [number, number]) => (p[0] - u[0]) * (v[1] - u[1]) - (p[1] - u[1]) * (v[0] - u[0]);
    const segsCross = (p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]) => {
      const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    const tl: [number, number] = [box.x, box.y], tr: [number, number] = [box.x + box.w, box.y];
    const br: [number, number] = [box.x + box.w, box.y + box.h], bl: [number, number] = [box.x, box.y + box.h];
    const segCrossesBox = pointInBox(a) || pointInBox(b) || segsCross(a, b, tl, tr) || segsCross(a, b, tr, br) || segsCross(a, b, br, bl) || segsCross(a, b, bl, tl);
    expect(segCrossesBox).toBe(false);
  });

  // Finding O (amends Ruling A): a labelled point keeps its beat at EVERY
  // stage, so a later highlight: {target: ["point_3"]} resolves against stage
  // 0's order. Nothing is drawn before it appears — an empty-pts stroke.
  test("a labelled point that appears later still has its point_i beat at stage 0", () => {
    const l = sc({ x: [0, 1, 2], y: [[1, 2], [1, 2, 3]], labels: ["", "", "C"], stage: 0 });
    expect(l.order).toEqual(["axes", "points", "point_3"]);
    expect(find(l, "point_3__t")).toBeUndefined();
    expect((find(l, "point_3__d") as StrokeDrawable).pts).toEqual([]);
    const shown = sc({ x: [0, 1, 2], y: [[1, 2], [1, 2, 3]], labels: ["", "", "C"], stage: 1 });
    const d = find(shown, "point_3__d") as StrokeDrawable;
    const cx = d.pts.reduce((a, p) => a + p[0], 0) / d.pts.length;
    const cy = d.pts.reduce((a, p) => a + p[1], 0) / d.pts.length;
    // x: 0..2 snaps to the origin, +6 % -> [0, 2.12]; y: 1..3 does not snap
    // (1 > 0.25 * 3), so 8 % of the range on both sides -> [0.84, 3.16].
    expect(cx).toBeCloseTo(plot.x0 + (2 / 2.12) * (plot.x1 - plot.x0), 6);
    expect(cy).toBeCloseTo(plot.y0 + ((3 - 0.84) / (3.16 - 0.84)) * (plot.y1 - plot.y0), 6);
    expect((find(shown, "point_3__t") as TextDrawable).text).toBe("C");
  });

  // Finding I4: labels take a token like every other data param — the body
  // already degrades a string to [] (no named beats until the script runs).
  test("labels accepts a {id.var} token", () => {
    expect(templateParamErrors("scatter_plot", { x: [1, 2], y: [1, 2], labels: "{sim.names}" })).toEqual([]);
    expect(templateParamErrors("scatter_plot", { x: [1, 2], y: [1, 2], labels: ["a", "b"] })).toEqual([]);
    expect(templateParamErrors("scatter_plot", { x: [1, 2], y: [1, 2], labels: 7 }).length).toBeGreaterThan(0);
  });
});
