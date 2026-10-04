// W27/W28: `label_size` on bar_chart, line_chart and pie_chart — the chart's
// labels at the author's size, for a chart beside large cards.
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { leafDrawables } from "../src/layout/model";
import { expandSpec } from "../src/spec/expand";
import { guessParts, guessSetup, pieGeometry } from "../src/guess/handles";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  registerPack("data", dataYaml);
});

const sizes = (s: Spec, re: RegExp): number[] =>
  leafDrawables(layoutSpec(s).drawables)
    .filter((d) => d.kind === "text" && re.test(d.id))
    .map((d) => (d as { fontSize: number }).fontSize);

const bars = (extra: Record<string, unknown> = {}): Spec =>
  ({ template: "bar_chart", params: { labels: ["Norway", "Chile"], values: [87, 52], value_labels: true, legend: false, ...extra }, commands: [] }) as unknown as Spec;
const lines = (extra: Record<string, unknown> = {}): Spec =>
  ({ template: "line_chart", params: { x: [2000, 2010, 2020], series: [{ name: "Oslo", values: [1, 2, 3] }, { name: "Bergen", values: [2, 2.5, 2.8] }], ...extra }, commands: [] }) as unknown as Spec;
const pie = (extra: Record<string, unknown> = {}): Spec =>
  ({ template: "pie_chart", params: { labels: ["A", "B", "C"], values: [50, 30, 20], ...extra }, commands: [] }) as unknown as Spec;

describe("chart label_size", () => {
  test("the defaults are unchanged without it", () => {
    expect(JSON.stringify(layoutSpec(bars()).drawables)).toBe(JSON.stringify(layoutSpec(bars({ label_size: undefined })).drawables));
  });

  test("bar_chart: names, values and y ticks at the size given", () => {
    const s = bars({ label_size: 30 });
    expect(validateSpec(s).errors ?? []).toEqual([]);
    expect(sizes(s, /^bar_\d+__l$/)).toEqual([30, 30]);
    expect(sizes(s, /^bar_\d+__v\d+$/)).toEqual([30, 30]);
    const ticks = sizes(s, /^axes__yt\d+$/);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t).toBe(30);
    // Larger than the engine's own.
    expect(Math.max(...sizes(bars(), /^bar_\d+__l$/))).toBeLessThan(30);
  });

  test("line_chart: the lines' names and the ticks at the size given", () => {
    const s = lines({ label_size: 28 });
    expect(validateSpec(s).errors ?? []).toEqual([]);
    const all = sizes(s, /.*/);
    expect(all.filter((f) => f === 28).length).toBeGreaterThanOrEqual(4);
    expect(sizes(lines(), /.*/).includes(28)).toBe(false);
  });

  test("pie_chart: the slices' names at the size given, the pie making room; the guess agrees", () => {
    const s = pie({ label_size: 34 });
    expect(validateSpec(s).errors ?? []).toEqual([]);
    expect(sizes(s, /^slice_\d+__l$/)).toEqual([34, 34, 34]);
    const e = expandSpec(s);
    const layout = layoutSpec(e);
    const h = guessSetup(e, e.params ?? {}, layout, guessParts(e, "slice_1")).handles[0];
    const wedge = leafDrawables(layout.drawables).find((d) => d.id === "slice_1__f") as unknown as { pts: [number, number][] };
    const r = Math.hypot(wedge.pts[1][0] - wedge.pts[0][0], wedge.pts[1][1] - wedge.pts[0][1]);
    expect(h.radius).toBeCloseTo(r, 3);
    // The template-only mirror (no drawing to read) agrees too.
    expect(pieGeometry(e.params ?? {}).radius).toBeCloseTo(r, 3);
  });

  test("out of range is held to 18–40", () => {
    expect(sizes(bars({ label_size: 8 }), /^bar_\d+__l$/)).toEqual([18, 18]);
    expect(sizes(pie({ label_size: 80 }), /^slice_\d+__l$/)).toEqual([40, 40, 40]);
  });
});
