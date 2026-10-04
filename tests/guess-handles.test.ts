import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";
import { scaleGeometry } from "../src/spec/scale";
import {
  countPillPoint,
  decodeGuess,
  defaultGuess,
  encodeGuess,
  guessParts,
  guessSetup,
  nudge,
  patchFor,
  startValues,
  valueAt,
} from "../src/guess/handles";
import { readParam, withOverrides } from "../src/render/params";

beforeAll(() => {
  registerPack("data", dataYaml);
});

function setupFor(spec: Spec, on: string | string[], from?: number) {
  const s = expandSpec(spec);
  const layout = layoutSpec(s);
  const parts = guessParts(s, on);
  return { s, layout, parts, setup: guessSetup(s, s.params ?? {}, layout, parts, { from }) };
}

const bars: Spec = {
  template: "bar_chart",
  params: { labels: ["Norway", "Sweden", "Denmark"], values: [87, 52, 58], y_label: "USD" },
  commands: [],
} as Spec;

describe("bar_chart handles", () => {
  test("one bar: truth, bounds from the axes, path and pin", () => {
    const { setup, layout } = setupFor(bars, "bar_2");
    expect(setup.warnings).toEqual([]);
    expect(setup.handles).toHaveLength(1);
    const h = setup.handles[0];
    expect(h.kind).toBe("height");
    expect(h.truth).toEqual([52]);
    expect(h.paths).toEqual(["values.1"]);
    expect(h.label).toBe("Sweden");
    expect(h.min).toBe(layout.frame!.y[0]);
    expect(h.max).toBe(layout.frame!.y[1]);
    expect(setup.pin).toEqual({ ylim: [layout.frame!.y[0], layout.frame!.y[1]] });
  });

  test("the pointer maps through the chart's frame to a value", () => {
    const { setup, layout } = setupFor(bars, "bar_1");
    const h = setup.handles[0];
    const f = layout.frame!;
    // Halfway up the plot (no fit on a plain chart page).
    const midY = (f.box.y0 + f.box.y1) / 2;
    const v = valueAt(h, [(f.box.x0 + f.box.x1) / 2, midY], startValues(h))[0];
    expect(Math.abs(v - (f.y[0] + f.y[1]) / 2)).toBeLessThanOrEqual(h.step);
  });

  test("all = every bar; the patch writes each value and pins the y range", () => {
    const { setup, s } = setupFor(bars, "all");
    expect(setup.handles.map((h) => h.part)).toEqual(["bar_1", "bar_2", "bar_3"]);
    const patch = patchFor(s, setup, [[10], [20], [30]]);
    expect(patch.params["values.0"]).toBe(10);
    expect(patch.params["values.2"]).toBe(30);
    expect(patch.params["ylim"]).toBeDefined();
    const painted = withOverrides(s.params, patch.params);
    expect(readParam(painted, "values.1")).toBe(20);
  });

  test("staged values guess the current stage's row", () => {
    const { setup } = setupFor({ ...bars, params: { ...bars.params, values: [[1, 2, 3], [4, 5, 6]], stage: 1 } } as Spec, "bar_3");
    expect(setup.handles[0].paths).toEqual(["values.1.2"]);
    expect(setup.handles[0].truth).toEqual([6]);
  });

  test("grouped bars are refused with a reason", () => {
    const { setup } = setupFor({ ...bars, params: { labels: ["A", "B"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] } } as Spec, "bar_1");
    expect(setup.handles).toHaveLength(0);
    expect(setup.warnings[0]).toMatch(/grouped/);
  });

  test("an unknown part warns", () => {
    const { setup } = setupFor(bars, "bar_9");
    expect(setup.handles).toHaveLength(0);
    expect(setup.warnings).toHaveLength(1);
  });
});

describe("line_chart handles", () => {
  const line: Spec = {
    template: "line_chart",
    params: { x: [2000, 2005, 2010, 2015, 2020], values: [100, 120, 150, 190, 240] },
    commands: [],
  } as Spec;

  test("the sketch starts at from; earlier points are given", () => {
    const { setup } = setupFor(line, "line_1", 2010);
    const h = setup.handles[0];
    expect(h.kind).toBe("curve");
    expect(h.xs).toEqual([2010, 2015, 2020]);
    expect(h.truth).toEqual([150, 190, 240]);
    expect(h.given).toEqual([
      { x: 2000, v: 100 },
      { x: 2005, v: 120 },
    ]);
    expect(startValues(h)).toEqual([120, 120, 120]);
    expect(h.paths).toEqual(["values.2", "values.3", "values.4"]);
  });

  test("default from is the middle", () => {
    const { setup } = setupFor(line, "line_1");
    expect(setup.handles[0].xs).toEqual([2015, 2020]);
  });

  test("a stroke sets every point it crosses", () => {
    const { setup, layout } = setupFor(line, "line_1", 2010);
    const h = setup.handles[0];
    const f = layout.frame!;
    const X = (x: number) => f.box.x0 + ((x - f.x[0]) / (f.x[1] - f.x[0])) * (f.box.x1 - f.box.x0);
    const Y = (y: number) => f.box.y0 + ((y - f.y[0]) / (f.y[1] - f.y[0])) * (f.box.y1 - f.box.y0);
    let v = startValues(h);
    v = valueAt(h, [X(2009), Y(200)], v, null);
    v = valueAt(h, [X(2021), Y(200)], v, [X(2009), Y(200)]);
    for (const n of v) expect(n).toBeCloseTo(200, -1);
  });
});

describe("population handles", () => {
  const crowd: Spec = {
    commands: [],
    elements: [{ id: "crowd", type: "population", count: 100, states: { healthy: 90, sick: 10 } }],
  } as Spec;

  test("a state's count, patched on the element", () => {
    const { setup, s } = setupFor(crowd, "crowd_sick");
    const h = setup.handles[0];
    expect(h.kind).toBe("count");
    expect(h.truth).toEqual([10]);
    expect(h.max).toBe(100);
    expect(h.population).toEqual({ id: "crowd", state: "sick" });
    const patch = patchFor(s, setup, [[37]]);
    expect(patch.elements!.find((e) => e.id === "crowd")!.states).toEqual({ healthy: 90, sick: 37 });
  });

  test("the first state is the remainder and cannot be guessed", () => {
    const { setup } = setupFor(crowd, "crowd_healthy");
    expect(setup.handles).toHaveLength(0);
    expect(setup.warnings[0]).toMatch(/remainder/);
  });

  test("dragging across the crowd sets the count", () => {
    const { setup } = setupFor(crowd, "crowd_sick");
    const h = setup.handles[0];
    const b = h.box!;
    expect(valueAt(h, [b.x + b.w / 2, b.y], [0])).toEqual([50]);
    expect(valueAt(h, [b.x + b.w * 2, b.y], [0])).toEqual([100]);
  });

  test("the value pill hangs under the people AND their legend (W25)", () => {
    const { setup, layout } = setupFor(crowd, "crowd_sick");
    const h = setup.handles[0];
    const legendYs = layout.drawables.filter((d) => /^crowd_legend/.test((d as { id?: string }).id ?? "")).length;
    expect(legendYs).toBeGreaterThan(0);
    const p = countPillPoint(h, [10])!;
    // Its top edge under the lowest drawn thing: the legend is under the people.
    expect(h.under).toBeDefined();
    expect(p[1]).toBe(h.under);
    expect(h.under!).toBeLessThan(h.people!.box.y);
  });
});

describe("scale handles", () => {
  const mozart = {
    commands: [],
    elements: [{ id: "born", type: "scale", min: 1700, max: 1800, value: 1756, label: "Mozart is born" }],
  } as unknown as Spec;

  test("the scale's truth and marker part", () => {
    const { setup } = setupFor(mozart, "born");
    const h = setup.handles[0];
    expect(h.kind).toBe("point");
    expect(h.part).toBe("born_answer");
    expect(h.truth).toEqual([1756]);
    expect(h.format(1756)).toBe("1756");
    expect(startValues(h)).toEqual([1750]);
  });

  test("the pointer's x is the value; the patch moves the marker and its number", () => {
    const { setup, s } = setupFor(mozart, "born");
    const h = setup.handles[0];
    // Placed by the page (spec 2026-10-04-page-frame W3): read the line's ends back.
    const { x0, x1, y } = scaleGeometry(h.scale!);
    expect(valueAt(h, [x0 + (x1 - x0) * 0.3, y], [1750])).toEqual([1730]);
    const patch = patchFor(s, setup, [[1730]]);
    const text = patch.elements!.find((e) => e.id === "born_answer_num")!;
    expect(text.text).toBe("1730");
    expect(text.x).toBeCloseTo(x0 + (x1 - x0) * 0.3);
  });
});

describe("pie_chart handles", () => {
  const pie: Spec = {
    template: "pie_chart",
    params: { labels: ["Top 1 %", "Next 9 %", "Rest"], values: [30, 30, 40] },
    commands: [],
  } as Spec;

  test("one slice: percent truth; the patch keeps the others' proportions", () => {
    const { setup, s } = setupFor(pie, "slice_1");
    const h = setup.handles[0];
    expect(h.kind).toBe("angle");
    expect(h.truth[0]).toBeCloseTo(30);
    const patch = patchFor(s, setup, [[50]]);
    expect(patch.params["values.0"]).toBeCloseTo(50);
    expect(patch.params["values.1"]).toBeCloseTo(50 * (30 / 70));
    expect(patch.params["values.2"]).toBeCloseTo(50 * (40 / 70));
  });

  test("whole pie: dividers move between neighbours", () => {
    const { setup } = setupFor(pie, "all");
    const h = setup.handles[0];
    expect(h.truth.map(Math.round)).toEqual([30, 30, 40]);
    const v = nudge(h, [33, 33, 34], 0, 1);
    expect(v[0] + v[1]).toBeCloseTo(66);
    expect(v[0]).toBeGreaterThan(33);
  });
});

describe("encoding", () => {
  test("round trip and defaults", () => {
    const { setup } = setupFor(bars, "all");
    const vals = [[1], [2.5], [3]];
    expect(decodeGuess(encodeGuess(vals), setup.handles)).toEqual(vals);
    expect(decodeGuess("1;2", setup.handles)).toBeNull();
    expect(defaultGuess("40", setup.handles)).toEqual([[40], [40], [40]]);
    expect(defaultGuess("1, 2, 3", setup.handles)).toEqual([[1], [2], [3]]);
    expect(defaultGuess("x", setup.handles)).toBeNull();
  });
});

describe("line chart: year ticks and the draw-in path", () => {
  test("each data x gets a tick and its number when they fit", () => {
    const l = layoutSpec(expandSpec({ template: "line_chart", params: { x: [1900, 1925, 1950, 1970, 1990, 2010, 2019], values: [32, 37, 46, 56, 64, 70, 73] }, commands: [] } as Spec));
    const texts = JSON.stringify(l.drawables);
    for (const y of ["1925", "1950", "1970", "1990", "2010"]) expect(texts).toContain(`"${y}"`);
  });
  test("x_ticks: false keeps the ends only", () => {
    const l = layoutSpec(expandSpec({ template: "line_chart", params: { x: [1900, 1925, 1950, 1970], values: [1, 2, 3, 4], x_ticks: false }, commands: [] } as Spec));
    expect(JSON.stringify(l.drawables)).not.toContain('"1925"');
  });
  test("an unstaged series gives the draw-in its values path", () => {
    const { setup } = setupFor({ template: "line_chart", params: { x: [2000, 2005, 2010, 2015], series: [{ name: "a", values: [1, 2, 3, 4] }] }, commands: [] } as Spec, "line_1", 2010);
    expect(setup.handles[0].rowPath).toBe("series.0.values");
  });
});
