// Where a press on the figure lands, and what it does (2026-10-04 reports:
// "it was a bit difficult to draw the line"; "the marker did not match the
// people that were marked").
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";
import { guessParts, guessSetup, personAt, pointFor, startValues, strokeEntries, strokeStart, valueAt } from "../src/guess/handles";
import { svgFrame } from "../src/ui/dom";

beforeAll(() => {
  registerPack("data", dataYaml);
});

function setupFor(spec: Spec, on: string, from?: number) {
  const s = expandSpec(spec);
  const layout = layoutSpec(s);
  return { layout, setup: guessSetup(s, s.params ?? {}, layout, guessParts(s, on), { from }) };
}

describe("svgFrame — the pointer ↔ drawing mapping every gate shares (ui/dom.ts)", () => {
  const vb = { x: 0, y: 0, width: 1000, height: 750 };
  test("a box of the canvas's shape: a plain scale", () => {
    expect(svgFrame({ left: 10, top: 20, width: 500, height: 375 }, vb)).toEqual({ sx: 0.5, sy: 0.5, ox: 10, oy: 20 });
  });
  test("a box wider than the canvas (a squeezed stage): the drawing is centred, letterboxed left and right", () => {
    const f = svgFrame({ left: 0, top: 0, width: 800, height: 375 }, vb);
    expect(f.sx).toBe(0.5);
    expect(f.ox).toBe(150);
    expect(f.oy).toBe(0);
  });
  test("a taller box: letterboxed top and bottom", () => {
    const f = svgFrame({ left: 0, top: 0, width: 500, height: 600 }, vb);
    expect(f.sy).toBe(0.5);
    expect(f.oy).toBeCloseTo((600 - 375) / 2);
  });
  test("preserveAspectRatio none stretches", () => {
    expect(svgFrame({ left: 0, top: 0, width: 800, height: 375 }, vb, "none")).toEqual({ sx: 0.8, sy: 0.5, ox: 0, oy: 0 });
  });
});

describe("a crowd filled row by row: a press marks up to the person under it", () => {
  const crowd = {
    commands: [],
    elements: [{ id: "today", type: "population", count: 100, states: { healthy: 90, sick: 10 }, order: "rows", fit: { x: 540, y: 200, w: 400, h: 440 } }],
  } as unknown as Spec;

  test("the people are read back where the layout drew them, in reading order", () => {
    const h = setupFor(crowd, "today_sick").setup.handles[0];
    expect(h.people?.centres).toHaveLength(100);
    expect(h.people?.seq?.slice(0, 3)).toEqual([0, 1, 2]);
    // Row 1 runs left to right; row 2 is below it (y-up).
    const c = h.people!.centres;
    expect(c[1][0]).toBeGreaterThan(c[0][0]);
    expect(c[10][1]).toBeLessThan(c[0][1]);
  });

  test("pointing at the 4th person of the 6th row marks 54 — the marks end under the pointer", () => {
    const h = setupFor(crowd, "today_sick").setup.handles[0];
    const c = h.people!.centres;
    expect(personAt(h, c[53])).toBe(53);
    expect(valueAt(h, c[53], [0])).toEqual([54]);
    // The pill stands level with the last person marked.
    expect(pointFor(h, [54])![0]).toBeCloseTo(c[53][0]);
  });

  test("left of the people: none", () => {
    const h = setupFor(crowd, "today_sick").setup.handles[0];
    const c = h.people!.centres;
    expect(valueAt(h, [c[0][0] - h.people!.h * 2, c[0][1]], [30])).toEqual([0]);
  });

  test("a spread crowd still sweeps — across the people, not their legend", () => {
    const spread = { ...crowd, elements: [{ ...crowd.elements![0], order: "spread" }] } as unknown as Spec;
    const h = setupFor(spread, "today_sick").setup.handles[0];
    expect(h.people?.seq).toBeNull();
    const b = h.people!.box;
    expect(valueAt(h, [b.x + b.w / 2, b.y], [0])).toEqual([50]);
  });
});

describe("drawing the rest of a line: a press anywhere right of the given line joins on", () => {
  const line: Spec = {
    template: "line_chart",
    params: { x: [2000, 2005, 2010, 2015, 2020], values: [100, 120, 150, 190, 240] },
    commands: [],
  } as Spec;

  test("the first press (at 2016) fills from the given line's end", () => {
    const { setup, layout } = setupFor(line, "line_1", 2010);
    const h = setup.handles[0];
    const f = layout.frame!;
    const X = (x: number) => f.box.x0 + ((x - f.x[0]) / (f.x[1] - f.x[0])) * (f.box.x1 - f.box.x0);
    const Y = (y: number) => f.box.y0 + ((y - f.y[0]) / (f.y[1] - f.y[0])) * (f.box.y1 - f.box.y0);
    const v0 = startValues(h);
    const p: [number, number] = [X(2016), Y(220)];
    const start = strokeStart(h, v0, new Set(), p);
    expect(start).not.toBeNull();
    const v = valueAt(h, p, v0, start);
    // 2010 lies between the given end (2005, 120) and the press: on the joining line.
    expect(v[0]).toBeGreaterThan(130);
    expect(v[0]).toBeLessThan(200);
    expect(v[1]).toBeCloseTo(220, -1);
    expect(strokeEntries(h, p, start).sort()).toEqual([0, 1]);
  });

  test("a later press starts from the nearest drawn point to its left, so nothing drawn is wiped", () => {
    const { setup, layout } = setupFor(line, "line_1", 2010);
    const h = setup.handles[0];
    const f = layout.frame!;
    const X = (x: number) => f.box.x0 + ((x - f.x[0]) / (f.x[1] - f.x[0])) * (f.box.x1 - f.box.x0);
    const Y = (y: number) => f.box.y0 + ((y - f.y[0]) / (f.y[1] - f.y[0])) * (f.box.y1 - f.box.y0);
    const v = [160, 200, 120];
    const start = strokeStart(h, v, new Set([0, 1]), [X(2020), Y(260)]);
    expect(start![0]).toBeCloseTo(X(2015));
  });
});

describe("a staged series: the rest of the line is in a later row", () => {
  const staged: Spec = {
    template: "line_chart",
    params: {
      x: [1900, 1950, 1975, 2000, 2025, 2050],
      series: [{ name: "World", values: [[1.6, 2.5, null, null, null, null], [1.6, 2.5, 4, 6.1, 8.1, null]] }],
      stage: 0,
    },
    commands: [],
  } as Spec;
  test("every point a later row holds is drawn, with its number as truth", () => {
    const h = setupFor(staged, "line_1", 1950).setup.handles[0];
    expect(h.xs).toEqual([1950, 1975, 2000, 2025]);
    expect(h.truth).toEqual([2.5, 4, 6.1, 8.1]);
    expect(h.paths).toEqual(["series.0.values.0.1", "series.0.values.0.2", "series.0.values.0.3", "series.0.values.0.4"]);
  });
  test("running on past the last point leaves it where the stroke crossed it", () => {
    const { setup, layout } = setupFor(staged, "line_1", 1950);
    const h = setup.handles[0];
    const f = layout.frame!;
    const X = (x: number) => f.box.x0 + ((x - f.x[0]) / (f.x[1] - f.x[0])) * (f.box.x1 - f.box.x0);
    const Y = (y: number) => f.box.y0 + ((y - f.y[0]) / (f.y[1] - f.y[0])) * (f.box.y1 - f.box.y0);
    let v = startValues(h);
    v = valueAt(h, [X(2020), Y(7)], v, [X(2010), Y(6)]);
    v = valueAt(h, [X(2040), Y(9)], v, [X(2020), Y(7)]);
    expect(v[3]).toBeCloseTo(7.5, 0);
  });
});
