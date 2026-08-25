// Task 5: two_by_two_table, timeline, and generic_axes_diagram promoted from
// stub to ready. This file pins the promotion itself (manifest status +
// registered layout) plus the geometry guarantees the brief calls out.
//
// Task 6 (below): markov_model and cost_effectiveness_plane promoted the
// same way.

import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { flattenDrawables, type AreaDrawable, type StrokeDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";
import { layoutTwoByTwoTable, type TwoByTwoParams } from "../src/scenes/two_by_two_table/layout";
import { layoutTimeline } from "../src/scenes/timeline/layout";
import { layoutGenericAxes, type GenericAxesParams } from "../src/scenes/generic_axes_diagram/layout";
import { layoutMarkovModel, type MarkovParams } from "../src/scenes/markov_model/layout";
import { layoutCostEffectivenessPlane, type CEParams } from "../src/scenes/cost_effectiveness_plane/layout";

const PROMOTED_IDS = ["two_by_two_table", "timeline", "generic_axes_diagram", "markov_model", "cost_effectiveness_plane"];

describe("promoted scene manifests", () => {
  for (const id of PROMOTED_IDS) {
    test(`${id} is registered as ready with a layout function`, () => {
      const mod = scenes[id];
      expect(mod).toBeDefined();
      expect(mod.manifest.status).toBe("ready");
      expect(mod.layout).toBeTypeOf("function");
    });

    test(`${id} has at least two manifest examples`, () => {
      expect(scenes[id].manifest.examples.length).toBeGreaterThanOrEqual(2);
    });

    test(`${id}: every manifest example lays out to a rich, well-formed scene`, () => {
      const mod = scenes[id];
      for (const ex of mod.manifest.examples) {
        const layout = mod.layout!(ex.params);
        const flat = flattenDrawables(layout.drawables);
        const ctx = `${id} — "${ex.request}"`;

        // Labels (curve/point/milestone captions) are LabelRequest objects,
        // not yet Drawables — placeLabels() only turns them into text once
        // the full layoutSpec pipeline runs — so richness counts both.
        expect(flat.length + layout.labels.length, ctx).toBeGreaterThan(5);
        expect(new Set(layout.order).size, `${ctx} (duplicate order ids)`).toBe(layout.order.length);

        for (const d of flat) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(Number.isFinite(x), ctx).toBe(true);
              expect(Number.isFinite(y), ctx).toBe(true);
            }
          } else if (d.kind === "text") {
            expect(Number.isFinite(d.pos[0]), ctx).toBe(true);
            expect(Number.isFinite(d.pos[1]), ctx).toBe(true);
          }
        }
        for (const l of layout.labels) {
          expect(Number.isFinite(l.anchor[0]), ctx).toBe(true);
          expect(Number.isFinite(l.anchor[1]), ctx).toBe(true);
        }
        for (const [id2, p] of Object.entries(layout.anchors)) {
          expect(Number.isFinite(p[0]), `${ctx} anchor ${id2}`).toBe(true);
          expect(Number.isFinite(p[1]), `${ctx} anchor ${id2}`).toBe(true);
        }
      }
    });

    test(`${id}: every manifest example's strokes/areas/text stay inside the logical canvas`, () => {
      const mod = scenes[id];
      for (const ex of mod.manifest.examples) {
        const layout = mod.layout!(ex.params);
        for (const d of flattenDrawables(layout.drawables)) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(x).toBeGreaterThanOrEqual(-1);
              expect(x).toBeLessThanOrEqual(CANVAS.w + 1);
              expect(y).toBeGreaterThanOrEqual(-1);
              expect(y).toBeLessThanOrEqual(CANVAS.h + 1);
            }
          }
        }
      }
    });
  }
});

describe("layoutTwoByTwoTable", () => {
  const base: TwoByTwoParams = {
    row_label: "Test",
    col_label: "Disease",
    row_values: ["Positive", "Negative"],
    col_values: ["Present", "Absent"],
    cells: [
      ["TP", "FP"],
      ["FN", "TN"],
    ],
  };

  test("produces the grid and all four cell groups", () => {
    const r = layoutTwoByTwoTable(base);
    for (const id of ["grid", "cell_0_0", "cell_0_1", "cell_1_0", "cell_1_1", "row_header_0", "row_header_1", "col_header_0", "col_header_1", "row_title", "col_title"]) {
      expect(r.order, id).toContain(id);
    }
  });

  test("highlight adds a shaded area behind the named cell", () => {
    const r = layoutTwoByTwoTable({ ...base, highlight: [[0, 0]] });
    const hl = flattenDrawables(r.drawables).find((d) => d.id === "hl_0_0");
    expect(hl).toBeDefined();
    expect(hl!.kind).toBe("area");
  });

  test("no highlight means no hl_ elements", () => {
    const r = layoutTwoByTwoTable(base);
    expect(r.order.some((id) => id.startsWith("hl_"))).toBe(false);
  });

  test("cell_notes adds a second, smaller text drawable inside the cell group", () => {
    const r = layoutTwoByTwoTable({ ...base, cell_notes: [["n=42", null], [null, null]] });
    const cell = flattenDrawables(r.drawables).find((d) => d.id === "cell_0_0__note");
    expect(cell).toBeDefined();
    expect(cell!.kind).toBe("text");
  });
});

describe("layoutGenericAxes", () => {
  test("an explicit expression 'x' produces a rising polyline in y-up logical coordinates", () => {
    const params: GenericAxesParams = { x_label: "X", y_label: "Y", curves: [{ expression: "x" }] };
    const r = layoutGenericAxes(params);
    const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve_0") as StrokeDrawable;
    expect(curve).toBeDefined();
    expect(curve.pts.length).toBeGreaterThan(10);
    const first = curve.pts[0];
    const last = curve.pts[curve.pts.length - 1];
    expect(last[1]).toBeGreaterThan(first[1]);
  });

  test("every canned shape samples to a valid, finite curve", () => {
    const shapes = ["linear_up", "linear_down", "convex_up", "concave_down", "s_curve", "u_shape", "bell"] as const;
    for (const shape of shapes) {
      const r = layoutGenericAxes({ x_label: "X", y_label: "Y", curves: [{ shape }] });
      const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve_0") as StrokeDrawable;
      expect(curve.pts.length, shape).toBeGreaterThan(20);
      for (const [x, y] of curve.pts) {
        expect(Number.isFinite(x), shape).toBe(true);
        expect(Number.isFinite(y), shape).toBe(true);
      }
    }
  });

  test("x_label/y_label are their own top-level elements, distinct from axes", () => {
    const r = layoutGenericAxes({ x_label: "Quantity", y_label: "Price", curves: [{ shape: "linear_up" }] });
    expect(r.order).toContain("axes");
    expect(r.order).toContain("x_label");
    expect(r.order).toContain("y_label");
  });

  test("shade under a single curve adds an area element", () => {
    const r = layoutGenericAxes({
      x_label: "X",
      y_label: "Y",
      curves: [{ shape: "concave_down" }],
      shade: { under: 0, x_from: 10, x_to: 60 },
    });
    const shade = flattenDrawables(r.drawables).find((d) => d.id === "shade");
    expect(shade).toBeDefined();
    expect(shade!.kind).toBe("area");
  });
});

describe("layoutTimeline", () => {
  test("3 milestones are spaced evenly along the line", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B" }, { label: "C" }] });
    const xs = [0, 1, 2].map((i) => r.anchors[`dot_${i}`][0]);
    const gap0 = xs[1] - xs[0];
    const gap1 = xs[2] - xs[1];
    expect(gap0).toBeGreaterThan(0);
    expect(gap1).toBeCloseTo(gap0, 6);
  });

  test("emphasized milestone renders a visibly larger dot", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B", emphasize: true }] });
    const dotA = flattenDrawables(r.drawables).find((d) => d.id === "dot_0") as StrokeDrawable;
    const dotB = flattenDrawables(r.drawables).find((d) => d.id === "dot_1") as StrokeDrawable;
    const radius = (d: StrokeDrawable, c: [number, number]): number => Math.max(...d.pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    expect(radius(dotB, r.anchors["dot_1"])).toBeGreaterThan(radius(dotA, r.anchors["dot_0"]));
  });

  test("every milestone gets a label with a valid side", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] });
    expect(r.labels.length).toBe(4);
    for (const l of r.labels) expect(["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"]).toContain(l.side);
  });

  test("caps at 8 milestones", () => {
    const r = layoutTimeline({ milestones: Array.from({ length: 10 }, (_, i) => ({ label: `M${i}` })) });
    expect(r.order.filter((id) => id.startsWith("dot_")).length).toBe(8);
  });
});

describe("layoutMarkovModel", () => {
  const wellSickDead: MarkovParams = {
    states: ["Well", "Sick", "Dead"],
    transitions: [
      { from: "Well", to: "Sick", label: "0.10" },
      { from: "Sick", to: "Well", label: "0.30" },
      { from: "Sick", to: "Dead", label: "0.05" },
      { from: "Well", to: "Dead", label: "0.01" },
    ],
    self_loops: ["Well", "Sick"],
  };

  test("3 states default to a circle layout with 3 distinct, well-separated ellipse strokes", () => {
    const r = layoutMarkovModel(wellSickDead);
    const centers = ["state_well", "state_sick", "state_dead"].map((id) => r.anchors[id]);
    for (const c of centers) expect(c).toBeDefined();
    for (const s of ["state_well", "state_sick", "state_dead"]) {
      const d = flattenDrawables(r.drawables).find((dd) => dd.id === s) as StrokeDrawable;
      expect(d, s).toBeDefined();
      expect(d.kind).toBe("stroke");
      expect(d.closed).toBe(true);
    }
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const dist = Math.hypot(centers[i][0] - centers[j][0], centers[i][1] - centers[j][1]);
        expect(dist, `${i}-${j}`).toBeGreaterThanOrEqual(120);
      }
    }
  });

  test("transition arrows are shortened well clear of both state centers", () => {
    const r = layoutMarkovModel(wellSickDead);
    const t0 = flattenDrawables(r.drawables).find((d) => d.id === "t_0") as StrokeDrawable;
    expect(t0).toBeDefined();
    const from = r.anchors["state_well"];
    const to = r.anchors["state_sick"];
    const first = t0.pts[0];
    const last = t0.pts[t0.pts.length - 1];
    expect(Math.hypot(first[0] - from[0], first[1] - from[1])).toBeGreaterThanOrEqual(60);
    expect(Math.hypot(last[0] - to[0], last[1] - to[1])).toBeGreaterThanOrEqual(60);
  });

  test("self-loop drawables are present for every state named in self_loops", () => {
    const r = layoutMarkovModel(wellSickDead);
    expect(r.order).toContain("loop_well");
    expect(r.order).toContain("loop_sick");
    expect(r.order.some((id) => id.startsWith("loop_dead"))).toBe(false);
  });

  test("a state with no outgoing transition (Dead) is absorbing — drawn in plain ink, not accent", () => {
    const r = layoutMarkovModel(wellSickDead);
    const dead = flattenDrawables(r.drawables).find((d) => d.id === "state_dead") as StrokeDrawable;
    const well = flattenDrawables(r.drawables).find((d) => d.id === "state_well") as StrokeDrawable;
    expect(dead.style.color).not.toBe(well.style.color);
  });

  test("highlight_state adds an accent-tinted area behind that state, and only that state", () => {
    const r = layoutMarkovModel({ ...wellSickDead, highlight_state: "Sick" });
    const hl = flattenDrawables(r.drawables).find((d) => d.id === "hl_sick") as AreaDrawable;
    expect(hl).toBeDefined();
    expect(hl.kind).toBe("area");
    expect(r.order.some((id) => id.startsWith("hl_") && id !== "hl_sick")).toBe(false);
  });

  test("2 states default to a chain layout", () => {
    const r = layoutMarkovModel({ states: ["A", "B"], transitions: [{ from: "A", to: "B" }] });
    const a = r.anchors["state_a"];
    const b = r.anchors["state_b"];
    expect(a[1]).toBeCloseTo(b[1], 6); // chain: same row
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(120);
  });

  test("a reverse-edge pair (A->B and B->A) bows instead of overlapping a straight edge", () => {
    const r = layoutMarkovModel({
      states: ["A", "B", "C"],
      transitions: [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
        { from: "A", to: "C" },
      ],
    });
    const ab = flattenDrawables(r.drawables).find((d) => d.id === "t_0") as StrokeDrawable;
    const ac = flattenDrawables(r.drawables).find((d) => d.id === "t_2") as StrokeDrawable;
    // The bowed edge has more than 2 points (kit.smooth expands a curved
    // path); the straight edge (no reverse) is exactly 2 points.
    expect(ab.pts.length).toBeGreaterThan(2);
    expect(ac.pts.length).toBe(2);
  });

  test("state name slugs are deterministic: lowercase, non-alphanumeric -> _", () => {
    const r = layoutMarkovModel({ states: ["State A!", "b"], transitions: [{ from: "State A!", to: "b" }] });
    expect(r.order).toContain("state_state_a_");
    expect(r.order).toContain("state_b");
  });
});

describe("layoutCostEffectivenessPlane", () => {
  test("both axes cross exactly at the fixed origin (500, 400)", () => {
    const r = layoutCostEffectivenessPlane({ points: [{ label: "A", effect: 1, cost: 1000 }] });
    const xLine = flattenDrawables(r.drawables).find((d) => d.id === "x_axis__line") as StrokeDrawable;
    const yLine = flattenDrawables(r.drawables).find((d) => d.id === "y_axis__line") as StrokeDrawable;
    expect(xLine).toBeDefined();
    expect(yLine).toBeDefined();
    for (const [, y] of xLine.pts) expect(y).toBeCloseTo(400, 6);
    expect(Math.min(...xLine.pts.map((p) => p[0]))).toBeLessThanOrEqual(500);
    expect(Math.max(...xLine.pts.map((p) => p[0]))).toBeGreaterThanOrEqual(500);
    for (const [x] of yLine.pts) expect(x).toBeCloseTo(500, 6);
    expect(Math.min(...yLine.pts.map((p) => p[1]))).toBeLessThanOrEqual(400);
    expect(Math.max(...yLine.pts.map((p) => p[1]))).toBeGreaterThanOrEqual(400);
  });

  test("a point with positive effect and negative cost lands in the SE quadrant (y-up: x > 500, y < 400)", () => {
    const params: CEParams = {
      points: [
        { label: "Dominant", effect: 2, cost: -500 },
        { label: "Comparator", effect: 0, cost: 0 },
      ],
    };
    const r = layoutCostEffectivenessPlane(params);
    const c = r.anchors["pt_0"];
    expect(c[0]).toBeGreaterThan(500);
    expect(c[1]).toBeLessThan(400);
  });

  test("the WTP line and its label are present only when wtp_threshold is given", () => {
    const withThreshold = layoutCostEffectivenessPlane({ wtp_threshold: 30000, points: [{ label: "A", effect: 1, cost: 20000 }] });
    expect(withThreshold.order).toContain("wtp_line");
    expect(withThreshold.order).toContain("wtp_label");

    const withoutThreshold = layoutCostEffectivenessPlane({ points: [{ label: "A", effect: 1, cost: 20000 }] });
    expect(withoutThreshold.order).not.toContain("wtp_line");
    expect(withoutThreshold.order).not.toContain("wtp_label");
  });

  test("a point below the WTP line gets a region2 (cost-effective) halo; above gets regionLoss", () => {
    const r = layoutCostEffectivenessPlane({
      wtp_threshold: 10000,
      points: [
        { label: "Below", effect: 1, cost: 5000 }, // cost 5000 < 10000*1 -> cost-effective
        { label: "Above", effect: 1, cost: 50000 }, // cost 50000 > 10000*1 -> not cost-effective
      ],
    });
    const belowHalo = flattenDrawables(r.drawables).find((d) => d.id === "pt_0__halo") as AreaDrawable;
    const aboveHalo = flattenDrawables(r.drawables).find((d) => d.id === "pt_1__halo") as AreaDrawable;
    expect(belowHalo.style.fill).not.toBe(aboveHalo.style.fill);
  });

  test("quadrant_labels: false removes the four corner captions", () => {
    const r = layoutCostEffectivenessPlane({ points: [{ label: "A", effect: 1, cost: 1 }], quadrant_labels: false });
    for (const id of ["q_ne", "q_nw", "q_se", "q_sw"]) expect(r.order).not.toContain(id);
  });

  test("defaults x_label and y_label when not given", () => {
    const r = layoutCostEffectivenessPlane({ points: [{ label: "A", effect: 1, cost: 1 }] });
    const label = flattenDrawables(r.drawables).find((d) => d.id === "x_axis__label");
    expect(label && label.kind === "text" ? label.text : undefined).toBe("Incremental effect (QALYs)");
  });
});
